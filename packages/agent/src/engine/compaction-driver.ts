// 压缩编排（docs/subsystems/context.md#压缩）：摘要请求、提交 compaction 条目与重建对话记录、熔断，以及三个触发点——手动（/compact）、
// 每次请求前越过阈值的自动压缩、请求以上下文溢出失败后的一次压缩与重试。运行时只在 prepareRequest 与 compact() 处接线。
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core'
import {
  createInitialSystemMessage,
  getCurrentTools,
  isContextOverflow,
  normalizeContext,
  type AssistantMessage,
  type Model,
  type Tool,
} from '@earendil-works/pi-ai'
import {
  createCompactionBreaker,
  estimateCompactedTokens,
  formatCompactionSummary,
  isFailedReply,
  planCompaction,
  SUMMARY_MAX_TOKENS,
  summaryRequest,
  type CompactionPlan,
} from '../context/compaction/index.ts'
import { charsToTokens, contextBudget, estimateContextTokens, estimateMessageChars, toolDefinitionChars } from '../context/usage/index.ts'
import { effectiveEntries, modelContext, type EntryLike } from '../entries/index.ts'
import type { CompactionPayload, CompactionTrigger, RequestUsage } from '../session-entries/index.ts'
import type { CompactInfo, CompactVerdict, ProgressEvent, RunEntry, RunError, RunStatus, RuntimeCompaction } from './types.ts'

/** 手动压缩时没有可摘要的较早内容（宿主通常在开始 Run 之前就拒绝）。 */
export const NOTHING_TO_COMPACT_TEXT = 'Nothing to compact: the conversation only has recent messages'

/** 压缩读写的 Run 状态（运行时的 RunState 的一部分）。 */
export interface CompactionRun {
  runId: string
  trigger: string
  aborted: boolean
  paused: boolean
  rejected: boolean
  commitError?: Error
  /** 进行中的手动或溢出压缩（不在 agent 循环内）；abort() 一并停止。 */
  compacting?: AbortController
  /** 本 Run 已经因溢出压缩并重试过一次。 */
  overflowRetried: boolean
}

export interface CompactionDriverOptions {
  compaction: RuntimeCompaction
  /** 与对话请求共用的流（同样的重试策略与 retry 进度）。 */
  stream: StreamFn
  commit: (entry: RunEntry) => Promise<void>
  /** 摘要请求结束后（成功或失败）提交它的 model_request（purpose compaction）。 */
  recordRequest?: (run: CompactionRun) => Promise<void>
  progress: (event: ProgressEvent) => void
  /** agent 的状态：当前模型与对话记录（压缩后替换）。 */
  state: { model: Model<any>; messages: AgentMessage[] }
  /** 当前提供给模型的工具；原生传输的历史声明由共享估算器按 pi 规则计入。 */
  tools: () => readonly Tool[]
  /** 当前 Run（溢出恢复在 drive 之后读取）。 */
  current: () => CompactionRun | undefined
  /** 继续 agent 循环（溢出压缩之后重试）。 */
  resume: () => Promise<void>
  /** 提交失败时停止 agent 循环。 */
  abortAgent: () => void
  /** 溢出恢复的摘要请求之前的宿主检查（预算）：false 时不压缩、不重试（宿主已停止本 Run）。 */
  admit: (run: CompactionRun) => Promise<boolean>
  /** 手动与自动压缩有可摘要的内容时、摘要请求之前（RuntimeContext.beforeCompact）；溢出恢复不调用。 */
  beforeCompact?: (info: CompactInfo) => Promise<void | CompactVerdict>
  /** 自动或溢出压缩已提交并重建上下文后，在下一次请求之前补发当前状态。手动压缩不调用。 */
  afterCompact?: (run: CompactionRun) => Promise<void>
}

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** 摘要请求的 usage 只保留 token 与费用（pi-ai 的 Usage 另有 provider 相关字段）；缺失或非法的值记 0。 */
export function requestUsage(usage: Partial<RequestUsage> | undefined): RequestUsage {
  const cost = usage?.cost
  return {
    input: amount(usage?.input),
    output: amount(usage?.output),
    cacheRead: amount(usage?.cacheRead),
    cacheWrite: amount(usage?.cacheWrite),
    totalTokens: amount(usage?.totalTokens),
    cost: {
      input: amount(cost?.input),
      output: amount(cost?.output),
      cacheRead: amount(cost?.cacheRead),
      cacheWrite: amount(cost?.cacheWrite),
      total: amount(cost?.total),
    },
  }
}

type CompactOutcome =
  | { kind: 'compacted' }
  | { kind: 'nothing' }
  | { kind: 'aborted' }
  | { kind: 'failed'; message: string }
  /** beforeCompact 返回 block：没有发出摘要请求。 */
  | { kind: 'blocked'; reason: string }

class SummaryAborted extends Error {}

export interface CompactionDriver {
  /** 手动压缩（trigger compact 的 Run 的 drive）：结束状态取决于压缩结果。 */
  manual(run: CompactionRun, instructions?: string): Promise<{ status: RunStatus; error?: RunError }>
  /** 每次模型请求前：估算超过阈值时自动压缩，返回替换后的请求上下文；自动压缩失败不终止 Run（用原上下文继续）。 */
  autoCompact(run: CompactionRun, messages: readonly AgentMessage[], model: Model<any>, signal: AbortSignal | undefined): Promise<AgentMessage[] | undefined>
  /** 请求以上下文溢出失败：压缩一次再重试一次（overflow）；压缩失败或没有可压缩的内容时以原模型错误结束。 */
  recoverOverflow(drive: () => Promise<void>): () => Promise<void>
  /** 熔断状态：连续失败次数，以及自动压缩是否已暂停。 */
  readonly state: { readonly consecutiveFailures: number; readonly paused: boolean }
}

export function createCompactionDriver(options: CompactionDriverOptions): CompactionDriver {
  const { compaction, stream, commit, progress, state } = options
  const breaker = createCompactionBreaker()

  const withoutToolDeclarations = (message: AgentMessage): AgentMessage => {
    if (message.role !== 'system') return message
    const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message
    return rest
  }
  const toolTokens = (messages: readonly AgentMessage[] = state.messages) => charsToTokens(toolDefinitionChars(state.model, options.tools(), messages))
  const systemTokens = () => {
    const head = state.messages[0]
    return head?.role === 'system' ? charsToTokens(estimateMessageChars(withoutToolDeclarations(head))) : 0
  }
  const contextTokens = (messages: readonly AgentMessage[]) => {
    const estimate = estimateContextTokens(messages.map(withoutToolDeclarations))
    return estimate.usageTokens > 0 ? estimate.tokens : estimate.tokens + toolTokens(messages)
  }
  /** 可信 usage 包含当时的定义；无 usage 时按本次传输折叠规则计入工具定义。 */
  const contextTokensOf = (entries: readonly EntryLike[]) => {
    const estimate = estimateCompactedTokens(
      entries.map((entry) => (entry.kind === 'message' ? { ...entry, payload: withoutToolDeclarations(entry.payload as AgentMessage) } : entry)),
    )
    return estimate.usageTokens > 0 ? estimate.tokens : estimate.tokens + systemTokens() + toolTokens()
  }

  /**
   * 摘要请求：Session 当前模型、没有工具、maxTokens 20 000（不超过模型上限）、不写提示缓存。输入限制在窗口减去输出上限之内
   * （按 4 字符 / token 估算），超出时从最早处省略，摘要请求本身不会溢出。
   */
  const summarize = async (
    run: CompactionRun,
    plan: CompactionPlan,
    signal: AbortSignal,
    instructions?: string,
  ): Promise<{ text: string; usage: RequestUsage }> => {
    const model = state.model
    const maxTokens = Math.min(SUMMARY_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : SUMMARY_MAX_TOKENS)
    const window = model.contextWindow ?? 0
    const { systemPrompt, prompt } = summaryRequest(plan, instructions, window > maxTokens ? { maxInputChars: (window - maxTokens) * 4 } : {})
    const request = normalizeContext({ systemPrompt, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] })
    let response: AssistantMessage
    try {
      response = await (await stream(model, request, { signal, maxTokens, cacheRetention: 'none' })).result()
    } finally {
      await options.recordRequest?.(run)
    }
    if (signal.aborted || response.stopReason === 'aborted') throw new SummaryAborted()
    if (response.stopReason === 'error') throw new Error(response.errorMessage || 'Summarization failed')
    if (response.stopReason === 'length') throw new Error('Summarization hit the output limit; the summary is incomplete')
    if (response.content.some((block) => block.type === 'toolCall')) throw new Error('Summarization attempted to call a tool')
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    if (text === '') throw new Error('Summarization returned an empty summary')
    return { text, usage: requestUsage(response.usage) }
  }

  /**
   * 压缩一次：规划切点、摘要、提交 compaction 条目，再按条目重建运行时的对话记录（合成摘要消息 + firstKeptSeq 及之后，出错的回复
   * 除外；开头的系统消息不变）。摘要失败记入熔断并发 compaction_failed；停止时不提交条目、不发 failed。
   */
  const compactNow = async (run: CompactionRun, trigger: CompactionTrigger, signal: AbortSignal, instructions?: string): Promise<CompactOutcome> => {
    const entries = await compaction.entries()
    const plan = planCompaction(entries, compaction.keepRecentTokens === undefined ? {} : { keepRecentTokens: compaction.keepRecentTokens })
    if (!plan) return { kind: 'nothing' }
    if (trigger !== 'overflow' && options.beforeCompact) {
      const verdict = await options.beforeCompact({ trigger, ...(instructions === undefined ? {} : { instructions }) })
      if (verdict && 'block' in verdict) return { kind: 'blocked', reason: verdict.block }
      if (verdict && 'instructions' in verdict && verdict.instructions.trim() !== '')
        instructions = instructions === undefined || instructions.trim() === '' ? verdict.instructions : `${instructions}\n\n${verdict.instructions}`
      if (signal.aborted || run.aborted) return { kind: 'aborted' }
    }
    const tokensBefore = contextTokensOf(entries)
    progress({ type: 'compaction_start', runId: run.runId, trigger })
    let summary: string
    let usage: RequestUsage
    try {
      ;({ text: summary, usage } = await summarize(run, plan, signal, instructions))
    } catch (error) {
      if (error instanceof SummaryAborted || signal.aborted) return { kind: 'aborted' }
      const message = error instanceof Error ? error.message : String(error)
      progress({ type: 'compaction_failed', runId: run.runId, trigger, message, consecutiveFailures: breaker.failed(trigger) })
      return { kind: 'failed', message }
    }
    if (signal.aborted || run.aborted) return { kind: 'aborted' }
    const payload: CompactionPayload = {
      summary: formatCompactionSummary(summary, plan),
      firstKeptSeq: plan.firstKeptSeq,
      tokensBefore,
      trigger,
      readFiles: plan.readFiles,
      modifiedFiles: plan.modifiedFiles,
      ...(plan.invokedSkills.length > 0 ? { invokedSkills: plan.invokedSkills } : {}),
      usage,
    }
    const next = (modelContext([...entries, { seq: Number.MAX_SAFE_INTEGER, kind: 'compaction', runId: run.runId, payload }]) as AgentMessage[]).filter(
      (message) => !isFailedReply(message),
    )
    const head = state.messages[0]?.role === 'system' ? [state.messages[0]] : []
    const prefix = effectiveEntries(entries)
      .filter((entry) => entry.kind === 'message' && entry.seq < plan.firstKeptSeq)
      .map((entry) => entry.payload as AgentMessage)
    const seed = head[0] ? createInitialSystemMessage(undefined, getCurrentTools([...head, ...prefix])) : undefined
    const projectedHead = head[0] ? [{ ...head[0], toolsAdded: seed?.toolsAdded, toolsRemoved: undefined }] : []
    payload.tokensAfter =
      next.reduce((sum, message) => sum + charsToTokens(estimateMessageChars(withoutToolDeclarations(message))), 0) +
      systemTokens() +
      toolTokens([...projectedHead, ...next])
    try {
      await commit({ kind: 'compaction', runId: run.runId, payload })
    } catch (error) {
      run.commitError ??= error instanceof Error ? error : new Error(String(error))
      options.abortAgent()
      return { kind: 'aborted' }
    }
    breaker.succeeded()
    // Preserve the unpersisted head identity after the compaction commit succeeds.
    if (head[0]) {
      if (seed?.toolsAdded) head[0].toolsAdded = seed.toolsAdded
      else delete head[0].toolsAdded
      delete head[0].toolsRemoved
    }
    state.messages = [...head, ...next]
    if (trigger !== 'manual') await options.afterCompact?.(run)
    if (run.commitError || run.aborted) return { kind: 'aborted' }
    progress({ type: 'compaction_end', runId: run.runId, trigger, tokensBefore, tokensAfter: payload.tokensAfter })
    return { kind: 'compacted' }
  }

  /** 手动或溢出压缩不在 agent 循环内：登记控制器，abort() 一并停止。 */
  const tracked = async (run: CompactionRun, trigger: CompactionTrigger, instructions?: string): Promise<CompactOutcome> => {
    const controller = new AbortController()
    run.compacting = controller
    try {
      return await compactNow(run, trigger, controller.signal, instructions)
    } finally {
      run.compacting = undefined
    }
  }

  return {
    async manual(run, instructions) {
      const outcome = await tracked(run, 'manual', instructions)
      if (outcome.kind === 'compacted') return { status: 'completed' }
      if (outcome.kind === 'aborted') return { status: 'aborted' }
      if (outcome.kind === 'blocked') return { status: 'error', error: { code: 'hook_blocked', message: outcome.reason } }
      return { status: 'error', error: { code: 'model_error', message: outcome.kind === 'nothing' ? NOTHING_TO_COMPACT_TEXT : outcome.message } }
    },
    async autoCompact(run, messages, model, signal) {
      if (run.trigger === 'compact' || run.trigger === 'handoff' || run.aborted || run.commitError || breaker.paused || !compaction.autoCompact())
        return undefined
      const { threshold } = contextBudget({ contextWindow: model.contextWindow ?? 0, maxTokens: model.maxTokens ?? 0 })
      if (threshold <= 0 || contextTokens(messages) < threshold) return undefined
      // 内存中的估算可能用了压缩之前的 usage：按条目复核。
      if (contextTokensOf(await compaction.entries()) < threshold) return undefined
      const outcome = await compactNow(run, 'auto', signal ?? new AbortController().signal)
      return outcome.kind === 'compacted' ? state.messages.slice() : undefined
    },
    recoverOverflow: (drive) => async () => {
      await drive()
      const run = options.current()
      if (!run || run.overflowRetried || run.aborted || run.paused || run.rejected || run.commitError) return
      if (breaker.paused || !compaction.autoCompact()) return
      const last = state.messages.at(-1)
      if (last?.role !== 'assistant' || last.stopReason !== 'error' || !isContextOverflow(last, state.model.contextWindow)) return
      run.overflowRetried = true
      if (!(await options.admit(run))) return
      const outcome = await tracked(run, 'overflow')
      if (outcome.kind !== 'compacted' || run.aborted) return
      // 重建的上下文不含出错的回复：从最后的 user 消息或工具结果继续。
      await options.resume()
    },
    get state() {
      return { consecutiveFailures: breaker.consecutiveFailures, paused: breaker.paused }
    },
  }
}

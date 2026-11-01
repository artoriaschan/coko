import { randomUUID } from 'node:crypto'
import { Agent, type AgentEvent, type AgentMessage, type AgentState, type AgentTool } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { composeAfterToolCall, composeBeforeToolCall, type HostBlock } from '../extensions/hooks/index.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import { createToolScheduler, withScheduling, type SchedulingOptions } from '../tools/scheduler.ts'
import { withTimeout } from '../tools/timeout.ts'
import { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from './retry.ts'
import { createRequestMeter, modelRequestPayload } from './model-requests.ts'
import { createApprovalBroker } from '../policy/broker.ts'
import { createCompactionDriver, requestUsage, type CompactionDriver, type CompactionRun } from './compaction-driver.ts'
import { createSystemMessage, DEFAULT_SYSTEM_PROMPT } from './system-message.ts'
import { createPermissionWiring, type PermissionRun } from './permission-wiring.ts'
import type { ModelRequestPurpose, RunStartPayload, RunTrigger, ToolExecPayload } from '../session-entries/index.ts'
import { NoActiveRunError, NothingToContinueError, NothingToRetryError, REQUEST_WITHHELD_TEXT, RuntimeBusyError } from './errors.ts'
import type { AgentRuntime, AgentRuntimeOptions, ProgressEvent, RunEntry, RunError, RunInput, RunResult, RunStatus, RuntimeEvent } from './types.ts'

export { BASE_SYSTEM_SECTION, DEFAULT_SYSTEM_PROMPT } from './system-message.ts'
export { NOTHING_TO_COMPACT_TEXT } from './compaction-driver.ts'
export type { AgentRuntime, AgentRuntimeOptions, RuntimeCompaction, RuntimePermissions } from './types.ts'
export { NoActiveRunError, NothingToContinueError, NothingToRetryError, RuntimeBusyError } from './errors.ts'

export { PAUSED_BEFORE_APPROVAL_TEXT } from './permission-wiring.ts'

/** onStop 每个 Run 至多使 Run 继续这么多次；之后的 continue 被忽略（宿主记 warn）。 */
export const ONSTOP_CONTINUE_LIMIT = 3

/** 摘要模式的回复调用了工具或没有文本时的错误文本。 */
export const SUMMARY_TOOL_CALL_TEXT = 'The summary request attempted to call a tool'
export const SUMMARY_EMPTY_TEXT = 'The summary request returned no text'

interface RunState extends CompactionRun, PermissionRun {
  runId: string
  aborted: boolean
  /** A tool call was rejected without feedback: the Run ends after the current batch. */
  rejected: boolean
  /** pause() was called: the Run ends after the current batch with status paused. */
  paused: boolean
  /** Aborted by pause(): cancels approvals that are waiting (not running tools). */
  pauseSignal: AbortController
  /** Steering messages sent and not yet committed, in send order, with the entries to commit right before each. */
  steering: Steering[]
  commitError?: Error
  trigger: RunTrigger
  /** 由 Run 自身决定的结束状态（手动压缩）；优先于按对话记录推断。 */
  ended?: { status: RunStatus; error?: RunError }
  /** 宿主停止（stopAfterBatch 或 beforeRequest 返回 stop）：本批完成后以 paused 加该 error 结束。第一次为准。 */
  halt?: RunError
  /** 本次请求被宿主扣下：pi 为它记下的失败消息不提交，Run 结束前从对话记录中移除。 */
  withheld?: boolean
  /** 被宿主 hook 拦下的调用的结构化标记，按 toolCallId；提交其 toolResult 时写入 details.hostBlock。 */
  hostBlocks: Map<string, HostBlock>
  /** 摘要模式（trigger handoff）：只有一轮，不注册工具，消息不提交，结束后恢复对话记录。 */
  summary: boolean
  /** 摘要模式完成时的文本与请求 usage。 */
  summaryResult?: { text: string; usage: RunResult['summaryUsage'] }
}

interface Steering {
  message: AgentMessage
  /** What the user typed; returned in run_end.undeliveredSteering when not delivered. */
  text: string
  before: readonly RunEntry[]
}

/** 进入条目与进度的 error：只有 code 与 message（协议的形状）。 */
const publicError = ({ code, message }: RunError): RunError => ({ code, message })

const toInput = (input: string | RunInput): RunInput => (typeof input === 'string' ? { text: input } : input)

const userMessage = (input: RunInput): AgentMessage => ({ role: 'user', content: input.content ?? [{ type: 'text', text: input.text }], timestamp: Date.now() })

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const registry = options.tools ?? createBuiltinToolRegistry({ cwd: options.cwd, exec: options.exec ?? createLocalExecPort() })
  const listeners = new Set<(event: RuntimeEvent) => void>()
  const hooks = options.hooks ?? []
  const retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry }

  let current = undefined as RunState | undefined
  let lastStatus: RunStatus | undefined = options.lastRunStatus

  const notify = (event: RuntimeEvent) => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // A display listener must not break the Run.
      }
    }
  }
  const progress = (event: ProgressEvent) => notify({ kind: 'progress', event })

  const commit = async (entry: RunEntry) => {
    await options.commit(entry)
    notify({ kind: 'entry', entry })
  }

  // side-effect 调用取得执行槽后、执行前提交 tool_exec；提交失败时该调用不执行，Run 以 commit_failed 结束。
  const recordExecution = async (record: ToolExecPayload) => {
    const run = current
    try {
      await commit({ kind: 'tool_exec', ...(run ? { runId: run.runId } : {}), payload: record })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (run) {
        run.commitError ??= failure
        agent.abort()
      }
      throw failure
    }
  }
  // Seed the tools at construction so they are part of the leading system message; only later
  // changes are announced to the model (and committed) as a system message with toolsAdded/Removed.
  // 超时在调度之内：排队等待不计入调用的时限。
  const effectiveTools = () =>
    registry.list().map((tool) => withScheduling(withTimeout(wiring.observeSandbox(tool), options.timeouts), scheduling) as AgentTool<any>)

  const broker = createApprovalBroker((entry) => commit({ ...entry, ...(current ? { runId: current.runId } : {}) }))
  const wiring = createPermissionWiring({
    cwd: options.cwd,
    permissions: options.permissions,
    secrets: options.secrets,
    registry,
    broker,
    current: () => current,
    abortAgent: () => agent.abort(),
  })
  const scheduling: SchedulingOptions = {
    scheduler: createToolScheduler(options.toolConcurrency),
    sessionId: options.sessionId ?? randomUUID(),
    recordExecution,
    prepare: wiring.prepare,
  }

  // 权限判定位于 hook 链首：被拒绝或等待中的调用不经过其后的 hook（例如 checkpoint 备份）。
  const before = composeBeforeToolCall(wiring.beforeToolCall ? [{ beforeToolCall: wiring.beforeToolCall }, ...hooks] : hooks)
  const after = composeAfterToolCall(hooks)

  const context = options.context
  // 对话请求与摘要请求共用：同样的重试策略与 retry 进度；每次请求（含重试）由 meter 测量，结束后提交 model_request。
  const meter = createRequestMeter()
  const stream = meter.wrap(
    withRetry(
      (model, request, streamOptions) => options.models.streamSimple(model, request, streamOptions),
      retryPolicy,
      (notice) => {
        meter.retried()
        if (current) progress({ type: 'retry', runId: current.runId, ...notice })
      },
    ),
  )
  /** 提交最近结束的请求的 model_request（没有发出请求时什么都不做）；提交失败时停止本 Run。 */
  const recordRequest = async (run: { runId: string; commitError?: Error }, purpose: ModelRequestPurpose) => {
    const measured = meter.take()
    if (!measured || run.commitError) return
    try {
      await commit({ kind: 'model_request', runId: run.runId, payload: modelRequestPayload(run.runId, purpose, measured) })
    } catch (error) {
      run.commitError ??= error instanceof Error ? error : new Error(String(error))
      agent.abort()
    }
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? 'off',
      tools: effectiveTools(),
      messages: options.messages ?? [],
    },
    streamFn: (model, request, streamOptions) => stream(model, request, streamOptions),
    identity: { attribution: null },
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    beforeToolCall: async (context, signal) => {
      if (current?.commitError) return { block: true, reason: 'Run stopped: the record could not be saved' }
      // 摘要模式不注册工具：模型仍然给出的调用不经权限判定，直接拦下（该轮结束后 Run 以错误结束）。
      if (current?.summary) return { block: true, reason: SUMMARY_TOOL_CALL_TEXT }
      const result = await before(context, signal)
      if (!result?.block) return result
      const { hostBlock, ...block } = result
      if (hostBlock) current?.hostBlocks.set(context.toolCall.id, hostBlock)
      return block
    },
    afterToolCall: (context, signal) => after(context, signal),
    ...(context?.transformMessages ? { transformContext: async (messages: AgentMessage[]) => context.transformMessages!(messages) } : {}),
    prepareRequest: async ({ context: request, model }, signal) => {
      const run = current
      if (!run) return undefined
      // 宿主已要求停止（例如 Goal Round 开始前预算已耗尽）：不发出请求。
      if (run.halt) return withhold(run)
      // 宿主检查（预算）在自动压缩之前：摘要请求同样是一次模型请求，预算耗尽或未定价时不发出。压缩之后再检查一次（计入压缩的用量）。
      // 停止在 pi 开始请求之前到达时 agent.abort() 没有可停止的流：在这里扣下请求，不发出。
      if (run.aborted) return withhold(run)
      if (!(await admit(run, request.messages, model, signal))) return withhold(run)
      // 宿主检查与自动压缩中有 await：停止在这期间到达时同样不发出请求。
      if (run.aborted) return withhold(run)
      const compacted: AgentMessage[] | undefined = driver ? await driver.autoCompact(run, request.messages, model, signal) : undefined
      if (compacted && !(await admit(run, compacted, model, signal))) return withhold(run)
      if (run.aborted) return withhold(run)
      return compacted ? { context: { ...request, messages: compacted } } : undefined
    },
    // 停止、无反馈拒绝或暂停：本批完成后结束，不取追加指令、不发新请求（停止后追加指令不送达，退回宿主）。
    // 摘要模式只有一轮。
    finishTurn: () => (current?.aborted || current?.rejected || current?.paused || current?.summary ? { action: 'end' } : undefined),
    // 一次送达全部已发送的追加指令（按发送顺序）。
    steeringMode: 'all',
    // 宿主在 Run 中改变了工具组成（refreshTools，例如第一次派发后台子代理后注册 agent_wait）：下一次请求按新的工具组成，变化照常
    // 以 toolsAdded / toolsRemoved 的 system 消息告知模型。
    prepareNextTurnWithContext: ({ context: turn }) => {
      if (!toolsDirty) return undefined
      toolsDirty = false
      const next = effectiveTools()
      agent.state.tools = next
      return { context: { ...turn, tools: next } }
    },
  })
  let toolsDirty = false

  /** 宿主的请求前检查（RuntimeContext.beforeRequest）：返回 stop 时停止本 Run 并返回 false（调用方不发出请求）。 */
  const admit = async (run: RunState, messages: readonly AgentMessage[], model: AgentState['model'], signal?: AbortSignal): Promise<boolean> => {
    if (run.halt) return false
    const verdict = context?.beforeRequest ? await context.beforeRequest({ runId: run.runId, messages, model, ...(signal ? { signal } : {}) }) : undefined
    if (!verdict) return true
    halt(run, verdict.stop)
    return false
  }

  // 宿主停止：与暂停相同（本批完成后结束，等待中的审批取消），结束状态另带 error。
  const halt = (run: RunState, error: RunError) => {
    run.halt ??= error
    run.paused = true
    run.pauseSignal.abort()
  }
  // 扣下请求：抛出使 pi 结束本轮（不调用模型）；它记下的失败消息不提交（message_end），Run 结束前移除。
  const withhold = (run: RunState): never => {
    run.withheld = true
    throw new Error(REQUEST_WITHHELD_TEXT)
  }
  /** toolResult 的 details.hostBlock 只来自宿主 hook 的拦截（工具自身给出的被去掉）。 */
  const markHostBlock = (run: RunState, message: ToolResultMessage) => {
    const mark = run.hostBlocks.get(message.toolCallId)
    run.hostBlocks.delete(message.toolCallId)
    const details: unknown = message.details
    const object = details !== null && typeof details === 'object' ? (details as Record<string, unknown>) : undefined
    if (!mark && !(object && Object.hasOwn(object, 'hostBlock'))) return
    const { hostBlock: _dropped, ...rest } = object ?? {}
    message.details = (mark ? { ...rest, hostBlock: mark } : rest) as ToolResultMessage['details']
  }
  const isWithheld = (run: RunState, message: AgentMessage) =>
    run.withheld === true && message.role === 'assistant' && message.errorMessage === REQUEST_WITHHELD_TEXT

  // 宿主每个 Run 开始时给出 system sections，替换开头的系统消息（system-message.ts）。
  const systemMessage = createSystemMessage({ basePrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, restored: options.messages, state: agent.state })

  agent.subscribe(async (event: AgentEvent) => {
    const run = current
    if (!run || run.commitError) return
    switch (event.type) {
      case 'message_update': {
        const update = event.assistantMessageEvent
        if (update.type === 'text_delta' || update.type === 'thinking_delta' || update.type === 'toolcall_delta') {
          const kind = update.type === 'text_delta' ? 'text' : update.type === 'thinking_delta' ? 'thinking' : 'toolcall'
          progress({ type: 'assistant_delta', runId: run.runId, kind, contentIndex: update.contentIndex, delta: update.delta })
        }
        return
      }
      case 'message_end':
        // 摘要模式的消息不属于 Session 的对话记录：不提交（结束后恢复对话记录），只记录这次摘要请求。
        if (run.summary) {
          if (event.message.role === 'assistant') await recordRequest(run, 'summary')
          return
        }
        if (isWithheld(run, event.message)) return
        try {
          const delivered = run.steering.findIndex((s) => s.message === event.message)
          // 追加指令的 before 条目（例如 command）紧接在其 user message 之前提交。
          if (delivered >= 0) for (const entry of run.steering[delivered]!.before) await commit({ ...entry, runId: run.runId } as RunEntry)
          if (event.message.role === 'toolResult') markHostBlock(run, event.message)
          await commit({ kind: 'message', runId: run.runId, payload: event.message })
          // 追加指令送达：提交成功后才不算未送达。
          if (delivered >= 0) run.steering.splice(delivered, 1)
        } catch (error) {
          run.commitError = error instanceof Error ? error : new Error(String(error))
          agent.abort()
          return
        }
        if (event.message.role === 'assistant') {
          await recordRequest(run, 'turn')
          if (run.commitError) return
          const usage = event.message.usage
          const tokens = usage ? usage.input + usage.cacheRead + usage.cacheWrite + usage.output : 0
          progress({ type: 'context_usage', runId: run.runId, tokens, contextWindow: agent.state.model.contextWindow ?? 0 })
        }
        return
      case 'tool_execution_start':
        progress({ type: 'tool_start', runId: run.runId, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args })
        return
      case 'tool_execution_update':
        progress({ type: 'tool_update', runId: run.runId, toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult })
        return
      case 'tool_execution_end':
        progress({
          type: 'tool_end',
          runId: run.runId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          result: event.result,
          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        })
        return
      default:
        return
    }
  })

  // ---- 压缩（compaction-driver.ts）：省略 compaction 选项时没有自动压缩，compact() 拒绝 ----
  const driver: CompactionDriver | undefined = options.compaction
    ? createCompactionDriver({
        compaction: options.compaction,
        stream,
        commit,
        recordRequest: (run) => recordRequest(run, 'compaction'),
        progress,
        state: agent.state,
        current: () => current,
        resume: () => agent.continue(),
        abortAgent: () => agent.abort(),
        admit: (run) => admit(run as RunState, agent.state.messages, agent.state.model),
        ...(context?.beforeCompact ? { beforeCompact: (info) => context.beforeCompact!(info) } : {}),
      })
    : undefined
  const recoverOverflow = (drive: () => Promise<void>) => (driver ? driver.recoverOverflow(drive) : drive)

  const outcome = (run: RunState): { status: RunStatus; error?: RunError } => {
    if (run.commitError) return { status: 'error', error: { code: 'commit_failed', message: run.commitError.message } }
    if (run.ended) return run.ended
    const last = agent.state.messages.at(-1)
    if (run.summary) {
      if (run.aborted) return { status: 'aborted' }
      if (run.halt) return { status: 'paused', error: run.halt }
    }
    if (run.aborted || run.rejected || (last?.role === 'assistant' && last.stopReason === 'aborted')) return { status: 'aborted' }
    if (run.halt) return { status: 'paused', error: run.halt }
    if (last?.role === 'assistant' && last.stopReason === 'error') {
      return { status: 'error', error: { code: 'model_error', message: last.errorMessage ?? 'Model request failed' } }
    }
    // 暂停在只有文本的最后一轮：工作已经完成，没有可继续的内容。
    if (run.paused && !(last?.role === 'assistant' && last.stopReason === 'stop')) return { status: 'paused' }
    return { status: 'completed' }
  }

  /** The trailing assistant message ended with a model error: it is what retry() runs again. */
  const failedTurn = () => {
    const last = agent.state.messages.at(-1)
    return last?.role === 'assistant' && last.stopReason === 'error'
  }

  /**
   * One Run around `drive`: run_start progress (synchronously, so the host learns the runId), the run_start entry
   * before the first model request, the agent loop, the run_end entry, then the run_end progress.
   */
  /** Run 正常结束（最后一轮只有文本，没有停止、暂停、拒绝或宿主停止）。 */
  const normalStop = (run: RunState) => {
    if (run.aborted || run.rejected || run.paused || run.halt || run.commitError || run.ended) return false
    const last = agent.state.messages.at(-1)
    return last?.role === 'assistant' && last.stopReason === 'stop'
  }

  /**
   * 对话 Run 正常结束之前调用 onStop：返回 continue 时以该 user message 再请求一次（同样经过 beforeRequest 与溢出恢复）。
   * 每个 Run 至多继续 ONSTOP_CONTINUE_LIMIT 次；之后仍调用 onStop（宿主据 continuations 记录），但忽略其 continue。
   */
  const withStop = (drive: () => Promise<void>) => async () => {
    await drive()
    const onStop = context?.onStop
    const run = current
    if (!onStop || !run) return
    let continuations = 0
    while (normalStop(run)) {
      const verdict = await onStop({ runId: run.runId, trigger: run.trigger, continuations, stopHookActive: continuations > 0 })
      if (!verdict || continuations >= ONSTOP_CONTINUE_LIMIT || !normalStop(run)) return
      continuations++
      await recoverOverflow(() => agent.prompt({ role: 'user', content: verdict.continue, timestamp: Date.now() }))()
    }
  }

  /** 摘要模式：一次请求（有效上下文 + 调用方的提示），没有工具；结束后恢复对话记录与工具。 */
  const summaryDrive = (input: RunInput) => async () => {
    const run = current!
    // 复制：pi 在原数组上追加本轮的消息。
    const saved = { messages: agent.state.messages.slice(), tools: agent.state.tools.slice() }
    agent.state.tools = []
    try {
      await agent.prompt(userMessage(input))
      if (run.aborted || run.halt || run.commitError) return
      const replies = agent.state.messages.slice(saved.messages.length).filter((m) => m.role === 'assistant')
      const reply = replies[0]
      if (!reply || reply.role !== 'assistant') return
      if (reply.stopReason === 'aborted') return
      if (reply.stopReason === 'error') {
        run.ended = { status: 'error', error: { code: 'model_error', message: reply.errorMessage ?? 'Model request failed' } }
        return
      }
      if (reply.content.some((block) => block.type === 'toolCall')) {
        run.ended = { status: 'error', error: { code: 'model_error', message: SUMMARY_TOOL_CALL_TEXT } }
        return
      }
      const text = reply.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim()
      if (text === '') {
        run.ended = { status: 'error', error: { code: 'model_error', message: SUMMARY_EMPTY_TEXT } }
        return
      }
      run.summaryResult = { text, usage: requestUsage(reply.usage) }
      run.ended = { status: 'completed' }
    } finally {
      agent.state.messages = saved.messages
      agent.state.tools = saved.tools
    }
  }

  const execute = async (
    trigger: RunTrigger,
    drive: () => Promise<void>,
    before: readonly RunEntry[] = [],
    start: Omit<RunStartPayload, 'trigger'> = {},
  ): Promise<RunResult> => {
    if (current || agent.state.isStreaming) throw new RuntimeBusyError()
    const run: RunState = {
      runId: randomUUID(),
      aborted: false,
      rejected: false,
      paused: false,
      pauseSignal: new AbortController(),
      steering: [],
      trigger,
      overflowRetried: false,
      hostBlocks: new Map(),
      summary: trigger === 'handoff',
    }
    current = run
    let result: RunResult
    try {
      agent.state.tools = effectiveTools()
      progress({ type: 'run_start', runId: run.runId })
      let internal: RunError | undefined
      try {
        await commit({ kind: 'run_start', runId: run.runId, payload: { trigger, ...start } })
      } catch (error) {
        run.commitError = error instanceof Error ? error : new Error(String(error))
      }
      try {
        if (!run.commitError) {
          if (context?.systemSections) systemMessage.apply(await context.systemSections())
          for (const entry of before) {
            try {
              await commit({ ...entry, runId: run.runId } as RunEntry)
            } catch (error) {
              run.commitError = error instanceof Error ? error : new Error(String(error))
              break
            }
          }
        }
        if (!run.commitError) await drive()
        // 被扣下的请求在对话记录中留下的失败消息：不属于对话（没有提交），之后的 continue 从此前的消息接着做。
        const last = agent.state.messages.at(-1)
        if (last && isWithheld(run, last)) agent.state.messages = agent.state.messages.slice(0, -1)
      } catch (error) {
        internal = { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      }
      // 未送达的追加指令退回宿主，不留到下一个 Run。
      agent.clearSteeringQueue()
      const undelivered = run.steering.map((s) => s.text)
      const ended: { status: RunStatus; error?: RunError; undeliveredSteering?: string[] } = internal ? { status: 'error', error: internal } : outcome(run)
      if (undelivered.length > 0) ended.undeliveredSteering = undelivered
      result = { runId: run.runId, ...ended }
      if (run.summaryResult && ended.status === 'completed')
        result = { ...result, summary: run.summaryResult.text, ...(run.summaryResult.usage ? { summaryUsage: run.summaryResult.usage } : {}) }
      if (!run.commitError) {
        try {
          // 条目与进度只带 code 与 message：dimension 只交给宿主（RunResult），不进入协议。
          await commit({ kind: 'run_end', runId: run.runId, payload: ended.error ? { ...ended, error: publicError(ended.error) } : ended })
        } catch (error) {
          result = { runId: run.runId, status: 'error', error: { code: 'commit_failed', message: error instanceof Error ? error.message : String(error) } }
        }
      }
      lastStatus = result.status
    } finally {
      current = undefined
      // 批准后未执行（被后续 hook 拦下或 Run 停止）的提权、复核目标与沙箱拒绝记录不延续到下一个 Run。
      wiring.reset()
    }
    progress({ type: 'run_end', runId: result.runId, status: result.status, ...(result.error ? { error: publicError(result.error) } : {}) })
    return result
  }

  return {
    run(raw) {
      const input = toInput(raw)
      const trigger = input.trigger ?? 'submit'
      const start = {
        ...(input.goal ? { goal: input.goal } : {}),
        ...(input.schedule ? { schedule: input.schedule } : {}),
        ...(input.subagent ? { subagent: input.subagent } : {}),
      }
      if (trigger === 'handoff') return execute(trigger, summaryDrive(input), input.before ?? [], start)
      return execute(trigger, withStop(recoverOverflow(() => agent.prompt(userMessage(input)))), input.before ?? [], start)
    },
    async retry() {
      if (current || agent.state.isStreaming) throw new RuntimeBusyError()
      if (!failedTurn()) throw new NothingToRetryError()
      return execute(
        'retry',
        withStop(
          recoverOverflow(async () => {
            const messages = agent.state.messages
            let end = messages.length
            while (end > 0 && messages[end - 1]?.role === 'assistant' && (messages[end - 1] as { stopReason?: string }).stopReason === 'error') end--
            agent.state.messages = messages.slice(0, end)
            await agent.continue()
          }),
        ),
      )
    },
    continue() {
      if (current || agent.state.isStreaming) return Promise.reject(new RuntimeBusyError())
      const last = agent.state.messages.at(-1)
      // 上一 Run 须为 paused / interrupted；模型请求要从用户消息或工具结果继续。
      if ((lastStatus !== 'paused' && lastStatus !== 'interrupted') || !last || last.role === 'assistant' || last.role === 'system')
        return Promise.reject(new NothingToContinueError())
      return execute('continue', withStop(recoverOverflow(() => agent.continue())))
    },
    steer(raw) {
      const run = current
      if (!run) throw new NoActiveRunError()
      const input = toInput(raw)
      const message = userMessage(input)
      run.steering.push({ message, text: input.text, before: input.before ?? [] })
      agent.steer(message)
    },
    pause() {
      const run = current
      if (!run) throw new NoActiveRunError()
      if (run.paused) return
      run.paused = true
      run.pauseSignal.abort()
    },
    stopAfterBatch(error) {
      const run = current
      if (!run) throw new NoActiveRunError()
      halt(run, error)
    },
    refreshTools() {
      if (current) toolsDirty = true
    },
    abort() {
      if (!current) return
      current.aborted = true
      current.compacting?.abort()
      agent.abort()
    },
    compact(instructions) {
      if (!driver) return Promise.reject(new Error('Compaction is not configured for this runtime'))
      return execute('compact', async () => {
        const run = current!
        // 摘要请求也是一次模型请求：与对话请求、自动压缩一样先过宿主的请求前检查（预算）；返回 stop 时以 paused 加该 error 结束。
        if (!(await admit(run, agent.state.messages, agent.state.model))) return
        run.ended = await driver.manual(run, instructions)
      })
    },
    get compaction() {
      return driver?.state ?? { consecutiveFailures: 0, paused: false }
    },
    answerApproval(requestId, answer) {
      return broker.answer(requestId, answer)
    },
    get pendingApprovals() {
      return broker.pending()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setModel(model) {
      if (current) throw new RuntimeBusyError()
      agent.state.model = model
    },
    setThinkingLevel(level) {
      if (current) throw new RuntimeBusyError()
      agent.state.thinkingLevel = level
    },
    get isRunning() {
      return current !== undefined
    },
    get messages() {
      return agent.state.messages
    },
  }
}

import { randomUUID } from 'node:crypto'
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import { composeAfterToolCall, composeBeforeToolCall } from '../extensions/hooks.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import { createToolScheduler, withScheduling, type SchedulingOptions } from '../tools/scheduler.ts'
import { withTimeout } from '../tools/timeout.ts'
import { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from './retry.ts'
import { createApprovalBroker } from '../policy/broker.ts'
import { createCompactionDriver, type CompactionDriver, type CompactionRun } from './compaction-driver.ts'
import { createSystemMessage, DEFAULT_SYSTEM_PROMPT } from './system-message.ts'
import { createPermissionWiring, type PermissionRun } from './permission-wiring.ts'
import type { RunStartPayload, RunTrigger, ToolExecPayload } from '../session-entries/index.ts'
import { NoActiveRunError, NothingToContinueError, NothingToRetryError, REQUEST_WITHHELD_TEXT, RuntimeBusyError } from './errors.ts'
import type { AgentRuntime, AgentRuntimeOptions, ProgressEvent, RunEntry, RunError, RunInput, RunResult, RunStatus, RuntimeEvent } from './types.ts'

export { BASE_SYSTEM_SECTION, DEFAULT_SYSTEM_PROMPT } from './system-message.ts'
export { NOTHING_TO_COMPACT_TEXT } from './compaction-driver.ts'
export type { AgentRuntime, AgentRuntimeOptions, RuntimeCompaction, RuntimePermissions } from './types.ts'
export { NoActiveRunError, NothingToContinueError, NothingToRetryError, RuntimeBusyError } from './errors.ts'

export { PAUSED_BEFORE_APPROVAL_TEXT } from './permission-wiring.ts'

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
}

interface Steering {
  message: AgentMessage
  /** What the user typed; returned in run_end.undeliveredSteering when not delivered. */
  text: string
  before: readonly RunEntry[]
}

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
  // 对话请求与摘要请求共用：同样的重试策略与 retry 进度。
  const stream = withRetry(
    (model, request, streamOptions) => options.models.streamSimple(model, request, streamOptions),
    retryPolicy,
    (notice) => {
      if (current) progress({ type: 'retry', runId: current.runId, ...notice })
    },
  )

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
      return before(context, signal)
    },
    afterToolCall: (context, signal) => after(context, signal),
    ...(context?.transformMessages ? { transformContext: async (messages: AgentMessage[]) => context.transformMessages!(messages) } : {}),
    prepareRequest: async ({ context: request, model }, signal) => {
      const run = current
      if (!run) return undefined
      // 宿主已要求停止（例如 Goal Round 开始前预算已耗尽）：不发出请求。
      if (run.halt) return withhold(run)
      // 自动压缩在宿主钩子之前：钩子看到的是将要发出的上下文（压缩的用量也已计入）。
      const compacted: AgentMessage[] | undefined = driver ? await driver.autoCompact(run, request.messages, model, signal) : undefined
      const messages = compacted ?? request.messages
      const verdict = context?.beforeRequest ? await context.beforeRequest({ runId: run.runId, messages, model, ...(signal ? { signal } : {}) }) : undefined
      if (verdict) {
        halt(run, verdict.stop)
        return withhold(run)
      }
      return compacted ? { context: { ...request, messages: compacted } } : undefined
    },
    // 停止、无反馈拒绝或暂停：本批完成后结束，不取追加指令、不发新请求（停止后追加指令不送达，退回宿主）。
    finishTurn: () => (current?.aborted || current?.rejected || current?.paused ? { action: 'end' } : undefined),
    // 一次送达全部已发送的追加指令（按发送顺序）。
    steeringMode: 'all',
  })

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
        if (isWithheld(run, event.message)) return
        try {
          const delivered = run.steering.findIndex((s) => s.message === event.message)
          // 追加指令的 before 条目（例如 command）紧接在其 user message 之前提交。
          if (delivered >= 0) for (const entry of run.steering[delivered]!.before) await commit({ ...entry, runId: run.runId } as RunEntry)
          await commit({ kind: 'message', runId: run.runId, payload: event.message })
          // 追加指令送达：提交成功后才不算未送达。
          if (delivered >= 0) run.steering.splice(delivered, 1)
        } catch (error) {
          run.commitError = error instanceof Error ? error : new Error(String(error))
          agent.abort()
          return
        }
        if (event.message.role === 'assistant') {
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
        progress,
        state: agent.state,
        current: () => current,
        resume: () => agent.continue(),
        abortAgent: () => agent.abort(),
      })
    : undefined
  const recoverOverflow = (drive: () => Promise<void>) => (driver ? driver.recoverOverflow(drive) : drive)

  const outcome = (run: RunState): { status: RunStatus; error?: RunError } => {
    if (run.commitError) return { status: 'error', error: { code: 'commit_failed', message: run.commitError.message } }
    if (run.ended) return run.ended
    const last = agent.state.messages.at(-1)
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
  const execute = async (
    trigger: RunTrigger,
    drive: () => Promise<void>,
    before: readonly RunEntry[] = [],
    goal?: RunStartPayload['goal'],
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
    }
    current = run
    let result: RunResult
    try {
      agent.state.tools = effectiveTools()
      progress({ type: 'run_start', runId: run.runId })
      let internal: RunError | undefined
      try {
        await commit({ kind: 'run_start', runId: run.runId, payload: goal ? { trigger, goal } : { trigger } })
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
      if (!run.commitError) {
        try {
          await commit({ kind: 'run_end', runId: run.runId, payload: ended })
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
    progress({ type: 'run_end', runId: result.runId, status: result.status, ...(result.error ? { error: result.error } : {}) })
    return result
  }

  return {
    run(raw) {
      const input = toInput(raw)
      return execute(
        input.trigger ?? 'submit',
        recoverOverflow(() => agent.prompt(userMessage(input))),
        input.before ?? [],
        input.goal,
      )
    },
    async retry() {
      if (current || agent.state.isStreaming) throw new RuntimeBusyError()
      if (!failedTurn()) throw new NothingToRetryError()
      return execute(
        'retry',
        recoverOverflow(async () => {
          const messages = agent.state.messages
          let end = messages.length
          while (end > 0 && messages[end - 1]?.role === 'assistant' && (messages[end - 1] as { stopReason?: string }).stopReason === 'error') end--
          agent.state.messages = messages.slice(0, end)
          await agent.continue()
        }),
      )
    },
    continue() {
      if (current || agent.state.isStreaming) return Promise.reject(new RuntimeBusyError())
      const last = agent.state.messages.at(-1)
      // 上一 Run 须为 paused / interrupted；模型请求要从用户消息或工具结果继续。
      if ((lastStatus !== 'paused' && lastStatus !== 'interrupted') || !last || last.role === 'assistant' || last.role === 'system')
        return Promise.reject(new NothingToContinueError())
      return execute(
        'continue',
        recoverOverflow(() => agent.continue()),
      )
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

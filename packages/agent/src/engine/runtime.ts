import { randomUUID } from 'node:crypto'
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Model, Models, SystemMessage } from '@earendil-works/pi-ai'
import { composeAfterToolCall, composeBeforeToolCall, type ToolHooks } from '../extensions/hooks.ts'
import type { ExecPort } from '../ports/exec.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { resolveSecrets, type SecretProvider } from '../ports/secrets.ts'
import { readDenial } from '../policy/decide.ts'
import { realLocation } from '../policy/paths.ts'
import { sandboxModeFor, sandboxPolicyFor, widerSandbox } from '../policy/sandbox.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { createToolScheduler, withScheduling, type SchedulingOptions } from '../tools/scheduler.ts'
import { withTimeout, type TimeoutOptions } from '../tools/timeout.ts'
import { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from './retry.ts'
import { createApprovalBroker, type ApprovalAnswer } from '../policy/broker.ts'
import { createPermissionGate, OPERATION_ABORTED_TEXT, ToolCallBlockedError } from '../policy/gate.ts'
import type { ApprovalRequestPayload, PermissionMode, PermissionRule, RunTrigger, SandboxMode, ToolExecPayload } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ProgressEvent, RunEntry, RunError, RunInput, RunResult, RunStatus, RuntimeContext, RuntimeEvent, SystemSection } from './types.ts'

export const DEFAULT_SYSTEM_PROMPT =
  "You are Coko, a coding agent working in the user's Workspace. Use the tools to inspect and change files and to run commands. Keep answers concise."

/** Name of the base prompt's section when host sections are present (the first section, ahead of every contribution). */
export const BASE_SYSTEM_SECTION = 'coko.base'

export class RuntimeBusyError extends Error {
  override readonly name = 'RuntimeBusyError'
  constructor() {
    super('A Run is already in progress')
  }
}

export class NothingToRetryError extends Error {
  override readonly name = 'NothingToRetryError'
  constructor() {
    super('The last turn did not fail; there is nothing to retry')
  }
}

export class NoActiveRunError extends Error {
  override readonly name = 'NoActiveRunError'
  constructor() {
    super('There is no Run in progress')
  }
}

export class NothingToContinueError extends Error {
  override readonly name = 'NothingToContinueError'
  constructor() {
    super('The last Run was not paused or interrupted; there is nothing to continue')
  }
}

/** 等待审批时被暂停的调用交给模型的文本（未执行）。 */
export const PAUSED_BEFORE_APPROVAL_TEXT = 'Not run: the user paused the run before this call was approved.'

export interface AgentRuntimeOptions {
  /** pi-ai collection that owns the model's Provider (see createModelRegistry). */
  models: Models
  model: Model<any>
  /** Workspace directory. */
  cwd: string
  /**
   * Persist one entry. Awaited before the Run continues: a toolResult or the next request only
   * proceeds after the previous message was committed. A rejection stops the Run with `commit_failed`.
   */
  commit: (entry: RunEntry) => Promise<void>
  /** Default: built-in tools for `cwd` using `exec`. Read again at the start of every Run. */
  tools?: ToolRegistry
  /** Default: local shell. Only used when `tools` is omitted. */
  exec?: ExecPort
  systemPrompt?: string
  /** Transcript to continue, usually the committed message entries of the Session. */
  messages?: AgentMessage[]
  thinkingLevel?: ThinkingLevel
  hooks?: ToolHooks[]
  retry?: Partial<RetryPolicy>
  timeouts?: TimeoutOptions
  /**
   * At most this many tool calls execute at once (default 10). Read calls share the slots; a side-effect call
   * runs alone, after every earlier call of the batch finished and before any later one starts.
   */
  toolConcurrency?: number
  /** Session of the transcript; the first part of every idempotency key. Omitted: a random id per runtime. */
  sessionId?: string
  /**
   * Permission decision and approvals (ADR 0005), first in the hook chain. Read on every call, so mode and rule
   * changes apply to the next call. Omitted: no permission check (library callers without an answer channel).
   */
  permissions?: RuntimePermissions
  /** Resolves the secrets a tool declares (`CokoTool.secrets`), once per call. Omitted: tools declaring secrets fail. */
  secrets?: SecretProvider
  /**
   * Status of the Session's last ended Run (its run_end entry), for a runtime restored from committed entries.
   * continue() is allowed only after `paused` or `interrupted`. Omitted: no earlier Run.
   */
  lastRunStatus?: RunStatus
  /** Host contributions to the model context (system sections, request-only message transform, pre-request hook). */
  context?: RuntimeContext
}

export interface RuntimePermissions {
  mode: () => PermissionMode
  rules: () => readonly PermissionRule[]
  /** 额外读取根（例如 Skill 目录）：其下的 read 组调用与 Workspace 内读取同样处理。每次判定现取。 */
  readRoots?: () => readonly string[]
}

export interface AgentRuntime {
  /**
   * Submit a user message and resolve when the Run ended and its run_end entry was committed. `before` entries of a RunInput
   * are committed after run_start and before the user message.
   */
  run(input: string | RunInput): Promise<RunResult>
  /**
   * Run the failed last turn again as a new Run, without a new user message: the trailing failed assistant
   * message is dropped from the model context and the model continues from the user message or tool results
   * before it. The failed message stays in the committed record. Throws NothingToRetryError when the last turn
   * did not end with a model error.
   */
  retry(): Promise<RunResult>
  /**
   * Continue the last Run after it was paused or interrupted, as a new Run (`run_start { trigger: continue }`) without a
   * new user message. Throws NothingToContinueError when the last Run ended otherwise, RuntimeBusyError while a Run is in progress.
   */
  continue(): Promise<RunResult>
  /**
   * Send a message into the current Run (Steering). It is delivered after the current tool batch finishes, before the
   * next model request, and committed then as a user message. Messages not delivered when the Run ends are returned in
   * `run_end.undeliveredSteering`. Throws NoActiveRunError when no Run is in progress.
   */
  steer(input: string | RunInput): void
  /**
   * Pause the current Run: the current tool batch completes, no new model request starts, pending approvals end as
   * cancelled (those calls do not run), and the Run ends with status `paused`. Throws NoActiveRunError when no Run is in progress.
   */
  pause(): void
  /**
   * Cancel the current Run; pending approvals end as cancelled, undelivered steering is returned in run_end, and the Run
   * ends with status `aborted` after tools have stopped.
   */
  abort(): void
  /**
   * Answer a pending approval request. Resolves after the approval_decision entry was committed. Throws
   * ApprovalNotPendingError when the request is not waiting (already answered, cancelled, or unknown).
   * A denial without feedback ends the Run as `aborted` after the current tool batch.
   */
  answerApproval(requestId: string, answer: ApprovalAnswer): Promise<void>
  /** Approval requests waiting for an answer, in request order. */
  readonly pendingApprovals: readonly ApprovalRequestPayload[]
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  /** Model for later Runs. Throws while a Run is in progress. */
  setModel(model: Model<any>): void
  readonly isRunning: boolean
  readonly messages: readonly AgentMessage[]
}

interface RunState {
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
  const permissions = options.permissions
  /** 已批准的单次提权，按 toolCallId；执行时取用并删除，Run 结束时清空。 */
  const escalations = new Map<string, SandboxMode>()
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= realLocation(options.cwd))

  /**
   * 执行前的准备（取得执行槽之后、执行记录之前，ADR 0005）：文件写入的目标按执行时的真实路径复核；沙箱档位按执行时的模式现算，
   * 已批准的提权取两者中较宽者；目录工具拿到 Read 拒绝规则的过滤；声明的密钥只为这一次调用解析，缺失时调用失败且不提交执行记录。
   * 没有权限判定时不设沙箱与过滤（库调用方，命令不受限）。
   */
  const prepare: SchedulingOptions['prepare'] = async ({ toolCallId, tool, params, signal }) => {
    const extra: { sandbox?: Awaited<ReturnType<typeof sandboxPolicyFor>>; secrets?: Record<string, string>; readDenied?: (path: string) => boolean } = {}
    if (permissions && gate) {
      await recheck(toolCallId, tool.name, params, signal)
      const granted = escalations.get(toolCallId)
      escalations.delete(toolCallId)
      const current = sandboxModeFor(permissions.mode())
      const root = await realWorkspace()
      extra.sandbox = await sandboxPolicyFor(granted ? widerSandbox(granted, current) : current, root)
      const denied = readDenial(permissions.rules(), root)
      if (denied) extra.readDenied = denied
    }
    const secrets = await resolveSecrets(tool.name, tool.secrets, options.secrets)
    if (secrets) extra.secrets = secrets
    return extra
  }

  /** 复核期间暂停：等待中的复核审批与 beforeToolCall 中的一样以"暂停前未批准"结束。 */
  const recheck = async (toolCallId: string, toolName: string, params: unknown, signal: AbortSignal | undefined) => {
    const run = current
    const paused = run?.pauseSignal.signal
    const combined = paused ? (signal ? AbortSignal.any([signal, paused]) : paused) : signal
    try {
      await gate!.recheck(toolCallId, toolName, params, combined)
    } catch (error) {
      if (error instanceof ToolCallBlockedError && error.message === OPERATION_ABORTED_TEXT && run?.paused && !signal?.aborted)
        throw new ToolCallBlockedError(PAUSED_BEFORE_APPROVAL_TEXT)
      throw error
    }
  }

  /** 记录被沙箱拒绝的命令（结果带 details.sandbox.denied）：之后同一命令才能带提权参数重试。 */
  const observeSandbox = (tool: CokoTool): CokoTool =>
    !gate || !tool.sandboxRequest
      ? tool
      : {
          ...tool,
          async execute(toolCallId, params, signal, onUpdate, context) {
            const result = await tool.execute(toolCallId, params, signal, onUpdate, context)
            const details = result.details as { sandbox?: { denied?: boolean } } | undefined
            const command = tool.permissionSubject?.(params)
            if (details?.sandbox?.denied && command !== undefined) gate.recordSandboxDenial(command)
            return result
          },
        }

  // Seed the tools at construction so they are part of the leading system message; only later
  // changes are announced to the model (and committed) as a system message with toolsAdded/Removed.
  // 超时在调度之内：排队等待不计入调用的时限。
  const effectiveTools = () => registry.list().map((tool) => withScheduling(withTimeout(observeSandbox(tool), options.timeouts), scheduling) as AgentTool<any>)

  const broker = createApprovalBroker((entry) => commit({ ...entry, ...(current ? { runId: current.runId } : {}) }))
  const gate = permissions
    ? createPermissionGate({
        cwd: options.cwd,
        tool: (name) => registry.get(name),
        permissionClass: (name) => registry.permissionClass(name),
        ...(permissions.readRoots ? { readRoots: permissions.readRoots } : {}),
        broker,
        mode: permissions.mode,
        rules: permissions.rules,
        rejected: () => current?.rejected ?? false,
        reject: () => {
          if (current) current.rejected = true
        },
        commitFailed: (error) => {
          if (!current) return
          current.commitError ??= error
          agent.abort()
        },
        grantEscalation: (toolCallId, mode) => void escalations.set(toolCallId, mode),
      })
    : undefined
  const scheduling: SchedulingOptions = {
    scheduler: createToolScheduler(options.toolConcurrency),
    sessionId: options.sessionId ?? randomUUID(),
    recordExecution,
    prepare,
  }

  // 暂停只取消等待中的审批（不中断执行中的工具）：权限 gate 收到的 signal 另加上本 Run 的暂停信号。只有被暂停取消的审批
  // 改写为"暂停前未批准"；规则拒绝、参数错误与跳过保留原文。
  const pausableGate = gate
    ? async (context: Parameters<typeof gate.beforeToolCall>[0], signal?: AbortSignal) => {
        const run = current
        const paused = run?.pauseSignal.signal
        const combined = paused ? (signal ? AbortSignal.any([signal, paused]) : paused) : signal
        const result = await gate.beforeToolCall(context, combined)
        if (result?.block && result.reason === OPERATION_ABORTED_TEXT && run?.paused && !signal?.aborted)
          return { block: true, reason: PAUSED_BEFORE_APPROVAL_TEXT }
        return result
      }
    : undefined

  // 权限判定位于 hook 链首：被拒绝或等待中的调用不经过其后的 hook（例如 checkpoint 备份）。
  const before = composeBeforeToolCall(pausableGate ? [{ beforeToolCall: pausableGate }, ...hooks] : hooks)
  const after = composeAfterToolCall(hooks)

  const context = options.context

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? 'off',
      tools: effectiveTools(),
      messages: options.messages ?? [],
    },
    streamFn: withRetry(
      (model, context, streamOptions) => options.models.streamSimple(model, context, streamOptions),
      retryPolicy,
      (notice) => {
        if (current) progress({ type: 'retry', runId: current.runId, ...notice })
      },
    ),
    identity: { attribution: null },
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    beforeToolCall: async (context, signal) => {
      if (current?.commitError) return { block: true, reason: 'Run stopped: the record could not be saved' }
      return before(context, signal)
    },
    afterToolCall: (context, signal) => after(context, signal),
    ...(context?.transformMessages ? { transformContext: async (messages: AgentMessage[]) => context.transformMessages!(messages) } : {}),
    ...(context?.beforeRequest
      ? {
          prepareRequest: async ({ context: request, model }, signal) => {
            if (current) await context.beforeRequest!({ runId: current.runId, messages: request.messages, model, ...(signal ? { signal } : {}) })
          },
        }
      : {}),
    // 停止、无反馈拒绝或暂停：本批完成后结束，不取追加指令、不发新请求（停止后追加指令不送达，退回宿主）。
    finishTurn: () => (current?.aborted || current?.rejected || current?.paused ? { action: 'end' } : undefined),
    // 一次送达全部已发送的追加指令（按发送顺序）。
    steeringMode: 'all',
  })

  // 宿主每个 Run 开始时给出 system sections：替换开头的系统消息（它不是已提交的条目，每次构造运行时都按基础提示重建）。
  // 没有宿主段落时保持基础提示原样，模型请求与 M2 相同。
  const basePrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  // 只替换运行时自己建立的开头消息；恢复的对话记录本身以系统消息开头时不动它。
  let leading: SystemMessage | undefined =
    options.messages?.[0]?.role !== 'system' && agent.state.messages[0]?.role === 'system' ? (agent.state.messages[0] as SystemMessage) : undefined
  const applySystemSections = (sections: readonly SystemSection[]) => {
    const messages = agent.state.messages
    const index = leading ? messages.indexOf(leading) : -1
    if (!leading || index !== 0) return
    const { sections: _previous, ...rest } = leading
    const extra = sections.filter((section) => section.text.length > 0)
    const next: SystemMessage =
      extra.length === 0
        ? { ...rest, content: basePrompt }
        : { ...rest, content: '', sections: Object.fromEntries([[BASE_SYSTEM_SECTION, basePrompt], ...extra.map((s) => [s.name, s.text] as const)]) }
    leading = next
    agent.state.messages = [next, ...messages.slice(1)]
  }

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

  const outcome = (run: RunState): { status: RunStatus; error?: RunError } => {
    if (run.commitError) return { status: 'error', error: { code: 'commit_failed', message: run.commitError.message } }
    const last = agent.state.messages.at(-1)
    if (run.aborted || run.rejected || (last?.role === 'assistant' && last.stopReason === 'aborted')) return { status: 'aborted' }
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
  const execute = async (trigger: RunTrigger, drive: () => Promise<void>, before: readonly RunEntry[] = []): Promise<RunResult> => {
    if (current || agent.state.isStreaming) throw new RuntimeBusyError()
    const run: RunState = { runId: randomUUID(), aborted: false, rejected: false, paused: false, pauseSignal: new AbortController(), steering: [] }
    current = run
    let result: RunResult
    try {
      agent.state.tools = effectiveTools()
      progress({ type: 'run_start', runId: run.runId })
      let internal: RunError | undefined
      try {
        await commit({ kind: 'run_start', runId: run.runId, payload: { trigger } })
      } catch (error) {
        run.commitError = error instanceof Error ? error : new Error(String(error))
      }
      try {
        if (!run.commitError) {
          if (context?.systemSections) applySystemSections(await context.systemSections())
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
      escalations.clear()
      gate?.reset()
    }
    progress({ type: 'run_end', runId: result.runId, status: result.status, ...(result.error ? { error: result.error } : {}) })
    return result
  }

  return {
    run(raw) {
      const input = toInput(raw)
      return execute('submit', () => agent.prompt(userMessage(input)), input.before ?? [])
    },
    async retry() {
      if (current || agent.state.isStreaming) throw new RuntimeBusyError()
      if (!failedTurn()) throw new NothingToRetryError()
      return execute('retry', async () => {
        const messages = agent.state.messages
        let end = messages.length
        while (end > 0 && messages[end - 1]?.role === 'assistant' && (messages[end - 1] as { stopReason?: string }).stopReason === 'error') end--
        agent.state.messages = messages.slice(0, end)
        await agent.continue()
      })
    },
    continue() {
      if (current || agent.state.isStreaming) return Promise.reject(new RuntimeBusyError())
      const last = agent.state.messages.at(-1)
      // 上一 Run 须为 paused / interrupted；模型请求要从用户消息或工具结果继续。
      if ((lastStatus !== 'paused' && lastStatus !== 'interrupted') || !last || last.role === 'assistant' || last.role === 'system')
        return Promise.reject(new NothingToContinueError())
      return execute('continue', () => agent.continue())
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
    abort() {
      if (!current) return
      current.aborted = true
      agent.abort()
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
    get isRunning() {
      return current !== undefined
    },
    get messages() {
      return agent.state.messages
    },
  }
}

import { randomUUID } from 'node:crypto'
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Model, Models } from '@earendil-works/pi-ai'
import { composeAfterToolCall, composeBeforeToolCall, type ToolHooks } from '../extensions/hooks.ts'
import type { ExecPort } from '../ports/exec.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { withTimeout, type TimeoutOptions } from '../tools/timeout.ts'
import { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from './retry.ts'
import type { ProgressEvent, RunEntry, RunError, RunResult, RunStatus, RuntimeEvent } from './types.ts'

export const DEFAULT_SYSTEM_PROMPT =
  "You are Coko, a coding agent working in the user's Workspace. Use the tools to inspect and change files and to run commands. Keep answers concise."

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
  sessionId?: string
}

export interface AgentRuntime {
  /** Submit a user message and resolve when the Run ended and its run_end entry was committed. */
  run(text: string): Promise<RunResult>
  /**
   * Run the failed last turn again as a new Run, without a new user message: the trailing failed assistant
   * message is dropped from the model context and the model continues from the user message or tool results
   * before it. The failed message stays in the committed record. Throws NothingToRetryError when the last turn
   * did not end with a model error.
   */
  retry(): Promise<RunResult>
  /** Cancel the current Run; it ends with status `aborted` after tools have stopped. */
  abort(): void
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  /** Model for later Runs. Throws while a Run is in progress. */
  setModel(model: Model<any>): void
  readonly isRunning: boolean
  readonly messages: readonly AgentMessage[]
}

interface RunState {
  runId: string
  aborted: boolean
  commitError?: Error
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const registry = options.tools ?? createBuiltinToolRegistry({ cwd: options.cwd, exec: options.exec ?? createLocalExecPort() })
  const listeners = new Set<(event: RuntimeEvent) => void>()
  const hooks = options.hooks ?? []
  const retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry }

  let current = undefined as RunState | undefined

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

  // Seed the tools at construction so they are part of the leading system message; only later
  // changes are announced to the model (and committed) as a system message with toolsAdded/Removed.
  const effectiveTools = () => registry.list().map((tool) => withTimeout(tool, options.timeouts) as AgentTool<any>)

  const before = composeBeforeToolCall(hooks)
  const after = composeAfterToolCall(hooks)

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
  })

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
          await commit({ kind: 'message', runId: run.runId, message: event.message })
        } catch (error) {
          run.commitError = error instanceof Error ? error : new Error(String(error))
          agent.abort()
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
    if (run.aborted || (last?.role === 'assistant' && last.stopReason === 'aborted')) return { status: 'aborted' }
    if (last?.role === 'assistant' && last.stopReason === 'error') {
      return { status: 'error', error: { code: 'model_error', message: last.errorMessage ?? 'Model request failed' } }
    }
    return { status: 'completed' }
  }

  /** The trailing assistant message ended with a model error: it is what retry() runs again. */
  const failedTurn = () => {
    const last = agent.state.messages.at(-1)
    return last?.role === 'assistant' && last.stopReason === 'error'
  }

  /** One Run around `drive`: run_start, the agent loop, the run_end entry, then the run_end progress. */
  const execute = async (drive: () => Promise<void>): Promise<RunResult> => {
    if (current || agent.state.isStreaming) throw new RuntimeBusyError()
    const run: RunState = { runId: randomUUID(), aborted: false }
    current = run
    let result: RunResult
    try {
      agent.state.tools = effectiveTools()
      progress({ type: 'run_start', runId: run.runId })
      let internal: RunError | undefined
      try {
        await drive()
      } catch (error) {
        internal = { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      }
      const ended = internal ? { status: 'error' as const, error: internal } : outcome(run)
      result = { runId: run.runId, ...ended }
      if (!run.commitError) {
        try {
          await commit({ kind: 'run_end', runId: run.runId, ...ended })
        } catch (error) {
          result = { runId: run.runId, status: 'error', error: { code: 'commit_failed', message: error instanceof Error ? error.message : String(error) } }
        }
      }
    } finally {
      current = undefined
    }
    progress({ type: 'run_end', runId: result.runId, status: result.status, ...(result.error ? { error: result.error } : {}) })
    return result
  }

  return {
    run(text) {
      return execute(() => agent.prompt(text))
    },
    async retry() {
      if (current || agent.state.isStreaming) throw new RuntimeBusyError()
      if (!failedTurn()) throw new NothingToRetryError()
      return execute(async () => {
        const messages = agent.state.messages
        let end = messages.length
        while (end > 0 && messages[end - 1]?.role === 'assistant' && (messages[end - 1] as { stopReason?: string }).stopReason === 'error') end--
        agent.state.messages = messages.slice(0, end)
        await agent.continue()
      })
    },
    abort() {
      if (!current) return
      current.aborted = true
      agent.abort()
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

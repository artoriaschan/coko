import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Model, UserMessage } from '@earendil-works/pi-ai'
import type { CompactionTrigger, RunStatus, SessionEntryKind, SessionEntryPayloads } from '../session-entries/index.ts'

export type { RunStatus } from '../session-entries/index.ts'

export type RunErrorCode =
  /** The model stream ended with an error (after retries, if retryable). */
  | 'model_error'
  /** The host's commit rejected; the Run stopped because its record would be incomplete. */
  | 'commit_failed'
  /** Unexpected failure inside the runtime. */
  | 'internal'

export interface RunError {
  code: RunErrorCode
  message: string
}

/**
 * Committed fact of a Run, in commit order: one Session Entry whose payload is registered for its kind
 * (see session-entries). The host persists each one before the Run proceeds; new kinds need no host mapping.
 * Every Run starts with `run_start` and ends with `run_end`. Message entries mirror the transcript the model
 * sees, so restoring a Session means passing their payloads back as `messages`.
 */
export type RunEntry = { [K in SessionEntryKind]: { kind: K; runId?: string; payload: SessionEntryPayloads[K] } }[SessionEntryKind]

export interface RunResult {
  runId: string
  status: RunStatus
  error?: RunError
  /** Steering messages that were sent but not delivered before the Run ended (also in the run_end entry). */
  undeliveredSteering?: string[]
}

/** Temporary display state. Never persisted; a client that reconnects rebuilds from entries. */
export type ProgressEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'assistant_delta'; runId: string; kind: 'text' | 'thinking' | 'toolcall'; contentIndex: number; delta: string }
  | { type: 'tool_start'; runId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update'; runId: string; toolCallId: string; toolName: string; partialResult: AgentToolResult<unknown> }
  /** In tool completion order; the committed toolResult entries keep the model's call order. */
  | { type: 'tool_end'; runId: string; toolCallId: string; toolName: string; isError: boolean; result: AgentToolResult<unknown>; durationMs?: number }
  | { type: 'retry'; runId: string; attempt: number; maxRetries: number; delayMs: number; errorMessage: string }
  /** After every committed assistant message: its usage (input + cacheRead + cacheWrite + output) and the model's context window. */
  | { type: 'context_usage'; runId: string; tokens: number; contextWindow: number }
  | { type: 'compaction_start'; runId: string; trigger: CompactionTrigger }
  | { type: 'compaction_end'; runId: string; trigger: CompactionTrigger; tokensBefore: number; tokensAfter?: number }
  | { type: 'compaction_failed'; runId: string; trigger: CompactionTrigger; message: string; consecutiveFailures: number }
  /**
   * Last event of every Run, after its run_end entry was committed or the commit failed. A client that missed the
   * run_end entry (the commit failed) still learns that the Run is over.
   */
  | { type: 'run_end'; runId: string; status: RunStatus; error?: RunError }

/** One named part of the system prompt (pi `SystemMessage.sections`). Keep the text self-delimiting (a tag or heading). */
export interface SystemSection {
  /** Stable, not integer-like (JSON objects reorder those), unique per runtime. */
  name: string
  text: string
}

/**
 * Input of run() and steer(). `text` is what the user typed (returned in run_end.undeliveredSteering when not delivered);
 * `content` replaces the user message content (e.g. an expanded command or attached file references); `before` entries are
 * committed after run_start (for steer: right before the user message) and before the user message.
 */
export interface RunInput {
  text: string
  content?: Exclude<UserMessage['content'], string>
  before?: RunEntry[]
}

/** State passed to `RuntimeContext.beforeRequest` immediately before every model request of a Run. */
export interface BeforeRequestState {
  runId: string
  /** The context about to be sent (before `transformMessages`); do not mutate. */
  messages: readonly AgentMessage[]
  model: Model<any>
  signal?: AbortSignal
}

/**
 * Host contributions to the model context (M3). `systemSections` is read once at the start of every Run and becomes the
 * leading system message's sections after the base prompt; `transformMessages` changes only the request, never the committed
 * entries; `beforeRequest` runs before every model request (usage checks, compaction).
 */
export interface RuntimeContext {
  systemSections?(): Promise<SystemSection[]>
  transformMessages?(messages: AgentMessage[]): AgentMessage[]
  beforeRequest?(state: BeforeRequestState): Promise<void>
}

/** `entry` is emitted after the host's commit resolved; `progress` is fire-and-forget. */
export type RuntimeEvent = { kind: 'entry'; entry: RunEntry } | { kind: 'progress'; event: ProgressEvent }

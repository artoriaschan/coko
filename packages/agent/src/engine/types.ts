import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { RunStatus, SessionEntryKind, SessionEntryPayloads } from '../session-entries/index.ts'

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
  /**
   * Last event of every Run, after its run_end entry was committed or the commit failed. A client that missed the
   * run_end entry (the commit failed) still learns that the Run is over.
   */
  | { type: 'run_end'; runId: string; status: RunStatus; error?: RunError }

/** `entry` is emitted after the host's commit resolved; `progress` is fire-and-forget. */
export type RuntimeEvent = { kind: 'entry'; entry: RunEntry } | { kind: 'progress'; event: ProgressEvent }

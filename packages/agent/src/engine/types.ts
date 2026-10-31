import type { AgentMessage, AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Model, Models, TextContent, UserMessage } from '@earendil-works/pi-ai'
import type { EntryLike } from '../entries/index.ts'
import type { ToolHooks } from '../extensions/hooks/index.ts'
import type { ApprovalAnswer } from '../policy/broker.ts'
import type { PermissionHookPort } from '../policy/gate.ts'
import type { ExecPort } from '../ports/exec.ts'
import type { SecretProvider } from '../ports/secrets.ts'
import type {
  ApprovalRequestPayload,
  CompactionTrigger,
  PermissionMode,
  PermissionRule,
  RequestUsage,
  RunStatus,
  RunTrigger,
  SessionEntryKind,
  SessionEntryPayloads,
} from '../session-entries/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { TimeoutOptions } from '../tools/timeout.ts'
import type { RetryPolicy } from './retry.ts'

export type { RunStatus } from '../session-entries/index.ts'

export type RunErrorCode =
  /** The model stream ended with an error (after retries, if retryable). */
  | 'model_error'
  /** The host's commit rejected; the Run stopped because its record would be incomplete. */
  | 'commit_failed'
  /** Unexpected failure inside the runtime. */
  | 'internal'
  /** Stopped by the host (stopAfterBatch, or a beforeRequest stop) because a budget is used up. */
  | 'budget_exhausted'
  /** Stopped by the host before a request: a cost limit is set but the model has no price. */
  | 'cost_unpriced'
  /** Stopped by a hook (continue: false), or a manual compaction a hook blocked. */
  | 'hook_stopped'
  /** A subagent used up its turn limit. */
  | 'max_turns'

export interface RunError {
  code: RunErrorCode
  message: string
  /** budget_exhausted: the budget dimension that is used up (for example `tokens`), so the host never parses `message`. */
  dimension?: string
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
  /** Summary mode (trigger handoff), completed: the reply's text. */
  summary?: string
  /** Summary mode: usage of the one summary request (the host counts it in the Goal budget). */
  summaryUsage?: RequestUsage
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
  /**
   * run() only. Default submit; goal marks a Goal Round started by the host, schedule a due scheduled task, subagent a child
   * Session's Run. handoff is summary mode: one request with the effective context plus this input, no tools, nothing but
   * run_start / run_end committed, the transcript unchanged; the reply text is RunResult.summary. Written to run_start.
   */
  trigger?: Extract<RunTrigger, 'submit' | 'goal' | 'schedule' | 'subagent' | 'handoff'>
  /** run() only: the Goal and round of a Goal Round, written to run_start. */
  goal?: { goalId: string; round: number }
  /** run() only: the scheduled task and its occurrence (UTC ms) of a trigger schedule Run, written to run_start. */
  schedule?: { scheduleId: string; occurrence: number }
}

/** State passed to `RuntimeContext.onStop`. */
export interface StopInfo {
  runId: string
  trigger: RunTrigger
  /** Continuations already made in this Run (0 on the first stop). */
  continuations: number
  /** The Run already continued because of onStop (claude-code's stop_hook_active). */
  stopHookActive: boolean
}

/** Returned by `RuntimeContext.onStop`: request again with this user message. */
export interface StopContinue {
  continue: TextContent[]
}

/** State passed to `RuntimeContext.beforeCompact` (manual and automatic compaction, never overflow recovery). */
export interface CompactInfo {
  trigger: 'auto' | 'manual'
  /** Manual /compact: the user's extra instructions. */
  instructions?: string
}

/** `{ block }` skips an automatic compaction (the request proceeds) or ends a manual one; `{ instructions }` are appended to the summary requirements. */
export type CompactVerdict = { block: string } | { instructions: string }

/** Returned by `RuntimeContext.beforeRequest` to withhold the request: the Run ends paused with this error (see stopAfterBatch). */
export interface RequestStop {
  stop: RunError
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
 * entries; `beforeRequest` runs before every model request, after automatic compaction (budget checks). Returning `{ stop }`
 * withholds that request: nothing is sent, and the Run ends as after stopAfterBatch(stop).
 */
export interface RuntimeContext {
  systemSections?(): Promise<SystemSection[]>
  transformMessages?(messages: AgentMessage[]): AgentMessage[]
  beforeRequest?(state: BeforeRequestState): Promise<void | RequestStop>
  /** Before a manual or automatic compaction that has something to summarize; not called for overflow recovery. */
  beforeCompact?(info: CompactInfo): Promise<void | CompactVerdict>
  /**
   * Before a conversation Run (not compact, not handoff) ends normally (its last turn is text only). Returning `{ continue }`
   * requests again with that user message; the runtime allows ONSTOP_CONTINUE_LIMIT continuations per Run and ignores later
   * ones. The continuation's request passes beforeRequest like any other.
   */
  onStop?(info: StopInfo): Promise<void | StopContinue>
}

/** `entry` is emitted after the host's commit resolved; `progress` is fire-and-forget. */
export type RuntimeEvent = { kind: 'entry'; entry: RunEntry } | { kind: 'progress'; event: ProgressEvent }

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
  /** 压缩：省略时没有自动压缩，compact() 拒绝。 */
  compaction?: RuntimeCompaction
}

/**
 * 压缩的宿主部分：已提交的条目（带 seq，切点与重建上下文用）与 context.autoCompact。每次模型请求前估算超过阈值时自动压缩；
 * 请求以上下文溢出失败时压缩一次再重试一次；连续 3 次自动失败后暂停（运行时内存，成功的压缩复位）。
 */
export interface RuntimeCompaction {
  /** Session 的全部已提交条目（按 seq）；压缩时读取一次。 */
  entries: () => Promise<readonly EntryLike[]>
  /** 自动压缩（含溢出后压缩）是否开启；每次请求前现取。 */
  autoCompact: () => boolean
  /** 压缩后保留的最近消息的估算 token 数；缺省 20 000。 */
  keepRecentTokens?: number
}

export interface RuntimePermissions {
  mode: () => PermissionMode
  rules: () => readonly PermissionRule[]
  /** 额外读取根（例如 Skill 目录）：其下的 read 组调用与 Workspace 内读取同样处理。每次判定现取。 */
  readRoots?: () => readonly string[]
  /** 外部 Hook 的 PreToolUse / PermissionRequest（ADR 0013）；缺省无。 */
  hooks?: PermissionHookPort
}

export interface AgentRuntime {
  /** The host changed the tool registry during a Run: the next request of that Run uses the new tools (no-op when idle). */
  refreshTools(): void
  /**
   * Submit a user message and resolve when the Run ended and its run_end entry was committed. `before` entries of a RunInput
   * are committed after run_start and before the user message; `trigger` and `goal` go into run_start.
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
   * Host stop (Goal budgets): like pause(), the current tool batch completes, no new model request starts and pending approvals
   * end as cancelled; the Run then ends with status `paused` and `error`, even when its last turn was text only. The first
   * stop of a Run wins. Throws NoActiveRunError when no Run is in progress.
   */
  stopAfterBatch(error: RunError): void
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
  /**
   * Thinking Level for later Runs ('off' sends the protocol's default way of turning reasoning off). pi-ai clamps a
   * level the model does not support. Throws while a Run is in progress.
   */
  setThinkingLevel(level: ThinkingLevel): void
  /**
   * 手动压缩（/compact）：一个 trigger compact 的 Run，只提交 compaction 条目（或以失败的 run_end 结束）；instructions 追加为摘要的
   * 额外要求。停止时不提交条目。没有 compaction 选项时 reject；Run 进行中抛 RuntimeBusyError。
   */
  compact(instructions?: string): Promise<RunResult>
  /** 熔断状态：连续失败次数，以及自动压缩是否已暂停。 */
  readonly compaction: { readonly consecutiveFailures: number; readonly paused: boolean }
  readonly isRunning: boolean
  readonly messages: readonly AgentMessage[]
}

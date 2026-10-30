import { Type, type Static } from 'typebox'
import { ErrorCode } from './errors.ts'
import { SessionEntryRecord } from './entries.ts'
import { CompactionTrigger } from './context-entries.ts'
import { JobSnapshot } from './jobs.ts'
import { RunStatus } from './runs.ts'

// WebSocket 消息（JSON 文本帧）。entry 是已提交的 Session Entry，带 seq，可在重连时以 afterSeq 补齐；
// progress 是不持久化的临时显示状态，带 runId，断线丢失后由 entry 重建。job_update / job_output 不属于 Run 的进度：runId 为发起该 Job
// 的 Run，Job 可以比该 Run 活得更久；客户端不据此进入运行中状态。

const strict = { additionalProperties: false } as const

/** 订阅 Session：先补发 seq > afterSeq 的已提交条目，再推送后续 entry 与 progress。 */
export const SubscribeMessage = Type.Object(
  { type: Type.Literal('subscribe'), sessionId: Type.String({ minLength: 1 }), afterSeq: Type.Integer({ minimum: 0 }) },
  strict,
)
export const UnsubscribeMessage = Type.Object({ type: Type.Literal('unsubscribe'), sessionId: Type.String({ minLength: 1 }) }, strict)

export const ClientMessage = Type.Union([SubscribeMessage, UnsubscribeMessage])
export type ClientMessage = Static<typeof ClientMessage>

/** 补发完成；lastSeq 为已发送的最大 seq，running 表示此刻是否有 Run 在进行。 */
export const SubscribedMessage = Type.Object(
  { type: Type.Literal('subscribed'), sessionId: Type.String(), lastSeq: Type.Integer({ minimum: 0 }), running: Type.Boolean() },
  strict,
)
export const EntryMessage = Type.Object({ type: Type.Literal('entry'), sessionId: Type.String(), entry: SessionEntryRecord }, strict)

/** Run 的临时进度；工具结果的最终内容以 toolResult 条目为准。 */
export const ProgressEvent = Type.Union([
  Type.Object({ type: Type.Literal('run_start') }, strict),
  Type.Object(
    {
      type: Type.Literal('assistant_delta'),
      kind: Type.Union([Type.Literal('text'), Type.Literal('thinking'), Type.Literal('toolcall')]),
      contentIndex: Type.Integer({ minimum: 0 }),
      delta: Type.String(),
    },
    strict,
  ),
  Type.Object({ type: Type.Literal('tool_start'), toolCallId: Type.String(), toolName: Type.String(), args: Type.Unknown() }, strict),
  Type.Object({ type: Type.Literal('tool_update'), toolCallId: Type.String(), toolName: Type.String(), partialResult: Type.Unknown() }, strict),
  Type.Object(
    {
      type: Type.Literal('tool_end'),
      toolCallId: Type.String(),
      toolName: Type.String(),
      isError: Type.Boolean(),
      result: Type.Unknown(),
      durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal('retry'),
      attempt: Type.Integer({ minimum: 1 }),
      maxRetries: Type.Integer({ minimum: 0 }),
      delayMs: Type.Number({ minimum: 0 }),
      errorMessage: Type.String(),
    },
    strict,
  ),
  /** 每条 assistant 消息提交后：该消息的 usage（input + cacheRead + cacheWrite + output）与模型的上下文窗口。 */
  Type.Object({ type: Type.Literal('context_usage'), tokens: Type.Integer({ minimum: 0 }), contextWindow: Type.Integer({ minimum: 0 }) }, strict),
  Type.Object({ type: Type.Literal('compaction_start'), trigger: CompactionTrigger }, strict),
  Type.Object(
    {
      type: Type.Literal('compaction_end'),
      trigger: CompactionTrigger,
      tokensBefore: Type.Integer({ minimum: 0 }),
      tokensAfter: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
  ),
  Type.Object(
    { type: Type.Literal('compaction_failed'), trigger: CompactionTrigger, message: Type.String(), consecutiveFailures: Type.Integer({ minimum: 1 }) },
    strict,
  ),
  /** 后台任务的公开快照（状态变化时）。 */
  Type.Object({ type: Type.Literal('job_update'), job: JobSnapshot }, strict),
  /** 后台任务的输出：offset 为该块在日志中的字节偏移；每个 Job 每 100 ms 至多一帧，已按值脱敏。 */
  Type.Object({ type: Type.Literal('job_output'), jobId: Type.String({ minLength: 1 }), offset: Type.Integer({ minimum: 0 }), chunk: Type.String() }, strict),
  /** 每个 Run 的最后一个进度：run_end 条目已提交或提交失败之后发出；提交失败时客户端据此结束运行中状态。 */
  Type.Object(
    {
      type: Type.Literal('run_end'),
      status: RunStatus,
      error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() }, strict)),
    },
    strict,
  ),
])
export type ProgressEvent = Static<typeof ProgressEvent>

/** 不属于 Run 生命周期的进度（后台任务）：不使客户端进入运行中状态。 */
export const isJobProgress = (event: ProgressEvent): event is Extract<ProgressEvent, { type: 'job_update' | 'job_output' }> =>
  event.type === 'job_update' || event.type === 'job_output'

export const ProgressMessage = Type.Object({ type: Type.Literal('progress'), sessionId: Type.String(), runId: Type.String(), event: ProgressEvent }, strict)

export const StreamErrorMessage = Type.Object(
  { type: Type.Literal('error'), code: ErrorCode, message: Type.String(), sessionId: Type.Optional(Type.String()) },
  strict,
)

export const ServerMessage = Type.Union([SubscribedMessage, EntryMessage, ProgressMessage, StreamErrorMessage])
export type ServerMessage = Static<typeof ServerMessage>

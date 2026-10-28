import { Type, type Static } from 'typebox'
import { ErrorCode } from './errors.ts'
import { SessionEntryRecord } from './entries.ts'
import { CompactionTrigger } from './context-entries.ts'
import { RunStatus } from './runs.ts'

// WebSocket 消息（JSON 文本帧）。entry 是已提交的 Session Entry，带 seq，可在重连时以 afterSeq 补齐；
// progress 是不持久化的临时显示状态，带 runId，断线丢失后由 entry 重建。

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

export const ProgressMessage = Type.Object({ type: Type.Literal('progress'), sessionId: Type.String(), runId: Type.String(), event: ProgressEvent }, strict)

export const StreamErrorMessage = Type.Object(
  { type: Type.Literal('error'), code: ErrorCode, message: Type.String(), sessionId: Type.Optional(Type.String()) },
  strict,
)

export const ServerMessage = Type.Union([SubscribedMessage, EntryMessage, ProgressMessage, StreamErrorMessage])
export type ServerMessage = Static<typeof ServerMessage>

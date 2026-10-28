import { Type, type Static } from 'typebox'

/** HTTP 与 WebSocket 共用的错误码。 */
export const ErrorCode = Type.Union([
  Type.Literal('bad-request'),
  Type.Literal('unauthorized'),
  Type.Literal('forbidden'),
  Type.Literal('not-found'),
  /** Session 已有 Run 在进行。 */
  Type.Literal('run-in-progress'),
  /** 上一轮没有以模型错误结束，没有可重试的内容。 */
  Type.Literal('nothing-to-retry'),
  /** Session 没有可用模型（未配置 Provider 或模型不存在）。 */
  Type.Literal('model-not-configured'),
  /** 审批请求不在等待中（已回答、已取消或不存在）。 */
  Type.Literal('approval-not-pending'),
  /** 设置的 expectedRevision 与当前 revision 不一致。 */
  Type.Literal('revision-conflict'),
  /** 存储不可继续使用（租约丢失、状态未知等）。 */
  Type.Literal('storage-unavailable'),
  Type.Literal('internal'),
])
export type ErrorCode = Static<typeof ErrorCode>

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: ErrorCode,
      message: Type.String(),
      details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
  },
  { additionalProperties: false },
)
export type ErrorResponse = Static<typeof ErrorResponse>

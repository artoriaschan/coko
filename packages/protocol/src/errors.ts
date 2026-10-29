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
  /** Session 的模型字段为空（例如其 Provider 已被删除）：运行前需要重新选择模型。 */
  Type.Literal('model-required'),
  /** 没有进行中的 Run（追加指令、暂停）。 */
  Type.Literal('no-active-run'),
  /** 上一 Run 不是 paused 或 interrupted，没有可继续的内容。 */
  Type.Literal('nothing-to-continue'),
  /** Run 进行中或等待审批：不能回退或分叉。 */
  Type.Literal('session-busy'),
  /** 有未回答的结果确认（恢复时结果不明的调用）。 */
  Type.Literal('confirmation-pending'),
  /** 启动恢复没能处理该 Session 中被中断的 Run：在恢复成功之前不能开始 Run、回退或分叉。 */
  Type.Literal('recovery-failed'),
  /** 审批请求不在等待中（已回答、已取消或不存在）。 */
  Type.Literal('approval-not-pending'),
  /** 要创建的对象的 ID 已被使用（例如 Provider ID）。 */
  Type.Literal('already-exists'),
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

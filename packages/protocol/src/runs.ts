import { Type, type Static } from 'typebox'

// Run 生命周期、模型可见消息、执行记录与恢复确认的条目 payload，以及 Session 的运行状态。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const RunStatus = Type.Union([
  Type.Literal('completed'),
  Type.Literal('aborted'),
  Type.Literal('error'),
  Type.Literal('paused'),
  Type.Literal('interrupted'),
])
export type RunStatus = Static<typeof RunStatus>

/** Session 的派生运行状态。Session DTO 仍保留 running（是否有 Run 在进行）。 */
export const SessionActivity = Type.Union([
  Type.Literal('idle'),
  Type.Literal('running'),
  Type.Literal('awaiting-approval'),
  Type.Literal('awaiting-confirmation'),
  Type.Literal('paused'),
  Type.Literal('interrupted'),
])
export type SessionActivity = Static<typeof SessionActivity>

export const RunTrigger = Type.Union([Type.Literal('submit'), Type.Literal('retry'), Type.Literal('continue')])
export type RunTrigger = Static<typeof RunTrigger>

export const RunStartPayload = Type.Object({ trigger: RunTrigger }, strict)
export type RunStartPayload = Static<typeof RunStartPayload>

export const RunEndPayload = Type.Object(
  {
    status: RunStatus,
    error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() }, strict)),
    undeliveredSteering: Type.Optional(Type.Array(Type.String())),
  },
  strict,
)
export type RunEndPayload = Static<typeof RunEndPayload>

const ContentBlocks = Type.Array(Type.Object({ type: Type.String() }))

/** 模型可见消息：按 role 判别；其余字段沿用 Agent 消息，原样传递。 */
export const MessagePayload = Type.Union([
  Type.Object({ role: Type.Literal('user'), content: Type.Union([Type.String(), ContentBlocks]) }),
  Type.Object({ role: Type.Literal('assistant'), content: ContentBlocks, stopReason: Type.String(), errorMessage: Type.Optional(Type.String()) }),
  Type.Object({
    role: Type.Literal('toolResult'),
    toolCallId: Id,
    toolName: Type.String(),
    content: ContentBlocks,
    isError: Type.Boolean(),
    details: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ role: Type.Literal('system'), content: Type.Union([Type.String(), ContentBlocks]) }),
])
export type MessagePayload = Static<typeof MessagePayload>

export const ToolExecPayload = Type.Object({ toolCallId: Id, toolName: Type.String(), idempotencyKey: Id }, strict)
export type ToolExecPayload = Static<typeof ToolExecPayload>

export const ConfirmationRequestPayload = Type.Object({ toolCallId: Id }, strict)
export type ConfirmationRequestPayload = Static<typeof ConfirmationRequestPayload>

/** 用户对结果不明的调用的回答：已生效 / 未生效 / 不确定（让 Agent 自行核实）。 */
export const ConfirmationAnswer = Type.Union([Type.Literal('applied'), Type.Literal('not-applied'), Type.Literal('unknown')])
export type ConfirmationAnswer = Static<typeof ConfirmationAnswer>

export const ConfirmationAnswerPayload = Type.Object({ toolCallId: Id, answer: ConfirmationAnswer }, strict)
export type ConfirmationAnswerPayload = Static<typeof ConfirmationAnswerPayload>

/** POST …/confirmations/:toolCallId 的请求体。 */
export const AnswerConfirmationRequest = Type.Object({ answer: ConfirmationAnswer }, strict)
export type AnswerConfirmationRequest = Static<typeof AnswerConfirmationRequest>

// ---- 运行控制（Steering、暂停、继续） ----

/** 追加指令：当前工具批次结束后送达，送达时提交为 user message。 */
export const SteerRequest = Type.Object({ text: Type.String({ minLength: 1 }) }, strict)
export type SteerRequest = Static<typeof SteerRequest>

/** 运行控制路由。 */
export const runPaths = {
  /** POST SteerRequest，204；没有进行中的 Run 时 409 no-active-run。 */
  sessionSteer: (id: string) => `/api/sessions/${encodeURIComponent(id)}/steer`,
  /** POST，204：当前批次完成后停下，Run 以 paused 结束；没有进行中的 Run 时 409 no-active-run。 */
  sessionPause: (id: string) => `/api/sessions/${encodeURIComponent(id)}/pause`,
  /** POST，202 { runId }：接着 paused / interrupted 的上一 Run；否则 409 nothing-to-continue（有待确认结果时 confirmation-pending）。 */
  sessionContinue: (id: string) => `/api/sessions/${encodeURIComponent(id)}/continue`,
  /**
   * POST AnswerConfirmationRequest，204：回答恢复时结果不明的调用，提交 confirmation_answer 与补齐的 toolResult。
   * 该调用没有待回答的确认（不存在或已回答）时 404 not-found。
   */
  sessionConfirmation: (id: string, toolCallId: string) => `/api/sessions/${encodeURIComponent(id)}/confirmations/${encodeURIComponent(toolCallId)}`,
} as const

/** 本领域的 kind → payload schema；entries.ts 据此组成 SessionEntry。 */
export const runEntryPayloadSchemas = {
  run_start: RunStartPayload,
  message: MessagePayload,
  run_end: RunEndPayload,
  tool_exec: ToolExecPayload,
  confirmation_request: ConfirmationRequestPayload,
  confirmation_answer: ConfirmationAnswerPayload,
}

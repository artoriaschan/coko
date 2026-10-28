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

export const ConfirmationAnswerPayload = Type.Object(
  { toolCallId: Id, answer: Type.Union([Type.Literal('applied'), Type.Literal('not-applied'), Type.Literal('unknown')]) },
  strict,
)
export type ConfirmationAnswerPayload = Static<typeof ConfirmationAnswerPayload>

/** 本领域的 kind → payload schema；entries.ts 据此组成 SessionEntry。 */
export const runEntryPayloadSchemas = {
  run_start: RunStartPayload,
  message: MessagePayload,
  run_end: RunEndPayload,
  tool_exec: ToolExecPayload,
  confirmation_request: ConfirmationRequestPayload,
  confirmation_answer: ConfirmationAnswerPayload,
}

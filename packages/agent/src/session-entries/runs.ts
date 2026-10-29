// Run 生命周期、模型可见消息与恢复确认的条目 payload。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** submit：用户消息；retry：重新执行出错的上一轮；continue：接着暂停或中断的 Run；compact：手动 /compact（只提交 compaction）。 */
export const runTriggerSchema = Type.Union([Type.Literal('submit'), Type.Literal('retry'), Type.Literal('continue'), Type.Literal('compact')])
export type RunTrigger = Static<typeof runTriggerSchema>

export const runStatusSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('aborted'),
  Type.Literal('error'),
  Type.Literal('paused'),
  Type.Literal('interrupted'),
])
export type RunStatus = Static<typeof runStatusSchema>

export const runStartPayloadSchema = Type.Object({ trigger: runTriggerSchema }, strict)
export type RunStartPayload = Static<typeof runStartPayloadSchema>

export const runEndPayloadSchema = Type.Object(
  {
    status: runStatusSchema,
    error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() }, strict)),
    /** Run 结束时尚未送达的追加指令，按提交顺序退回输入区。 */
    undeliveredSteering: Type.Optional(Type.Array(Type.String())),
  },
  strict,
)
export type RunEndPayload = Static<typeof runEndPayloadSchema>

const contentBlocks = Type.Array(Type.Object({ type: Type.String() }))

/** 模型可见消息（pi AgentMessage）。只约束各 role 的判别字段，其余字段随 pi 演进，原样保存。 */
export const messagePayloadSchema = Type.Union([
  Type.Object({ role: Type.Literal('user'), content: Type.Union([Type.String(), contentBlocks]) }),
  Type.Object({ role: Type.Literal('assistant'), content: contentBlocks, stopReason: Type.String(), errorMessage: Type.Optional(Type.String()) }),
  Type.Object({
    role: Type.Literal('toolResult'),
    toolCallId: Id,
    toolName: Type.String(),
    content: contentBlocks,
    isError: Type.Boolean(),
    details: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ role: Type.Literal('system'), content: Type.Union([Type.String(), contentBlocks]) }),
])

/** 恢复时结果不明的副作用调用，等待用户确认。 */
export const confirmationRequestPayloadSchema = Type.Object({ toolCallId: Id }, strict)
export type ConfirmationRequestPayload = Static<typeof confirmationRequestPayloadSchema>

export const confirmationAnswerPayloadSchema = Type.Object(
  { toolCallId: Id, answer: Type.Union([Type.Literal('applied'), Type.Literal('not-applied'), Type.Literal('unknown')]) },
  strict,
)
export type ConfirmationAnswerPayload = Static<typeof confirmationAnswerPayloadSchema>

export interface RunEntryPayloads {
  run_start: RunStartPayload
  message: AgentMessage
  run_end: RunEndPayload
  confirmation_request: ConfirmationRequestPayload
  confirmation_answer: ConfirmationAnswerPayload
}

export const runEntryPayloads = definePayloads({
  run_start: [{ schema: runStartPayloadSchema }],
  message: [{ schema: messagePayloadSchema }],
  run_end: [{ schema: runEndPayloadSchema }],
  confirmation_request: [{ schema: confirmationRequestPayloadSchema }],
  confirmation_answer: [{ schema: confirmationAnswerPayloadSchema }],
} satisfies Record<keyof RunEntryPayloads, unknown>)

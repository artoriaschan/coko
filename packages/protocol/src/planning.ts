import { Type, type Static } from 'typebox'

// Plan Mode 提交的计划（ADR 0005 的 plan 模式）。entries.ts 据 planningEntryPayloadSchemas 组成 SessionEntry。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const PlanStatus = Type.Union([Type.Literal('proposed'), Type.Literal('approved'), Type.Literal('rejected')])
export type PlanStatus = Static<typeof PlanStatus>

/** plan v1：一次提交或审阅的结果；同一 planId 的 revision 递增。 */
export const PlanPayload = Type.Object(
  { planId: Id, revision: Type.Integer({ minimum: 1 }), markdown: Type.String(), status: PlanStatus, feedback: Type.Optional(Type.String()) },
  strict,
)
export type PlanPayload = Static<typeof PlanPayload>

/** 本领域的 kind → payload schema。 */
export const planningEntryPayloadSchemas = {
  plan: PlanPayload,
}

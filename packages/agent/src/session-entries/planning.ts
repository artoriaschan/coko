// Plan Mode 提交的计划（与 @coko/protocol 的 planning.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const planStatusSchema = Type.Union([Type.Literal('proposed'), Type.Literal('approved'), Type.Literal('rejected')])
export type PlanStatus = Static<typeof planStatusSchema>

export const planPayloadSchema = Type.Object(
  { planId: Id, revision: Type.Integer({ minimum: 1 }), markdown: Type.String(), status: planStatusSchema, feedback: Type.Optional(Type.String()) },
  strict,
)
export type PlanPayload = Static<typeof planPayloadSchema>

export interface PlanningEntryPayloads {
  plan: PlanPayload
}

export const planningEntryPayloads = definePayloads({
  plan: [{ schema: planPayloadSchema }],
} satisfies Record<keyof PlanningEntryPayloads, unknown>)

// Plan Mode 提交的计划与 Session 的计划阶段（与 @coko/protocol 的 planning.ts 一致；ADR 0028）。
import { Type, type Static } from 'typebox'
import { definePayloads, type EntryJson } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

const planFields = { planId: Id, revision: Type.Integer({ minimum: 1 }), markdown: Type.String() }

/** plan v1：proposed / approved / rejected。 */
const planV1Schema = Type.Object(
  {
    ...planFields,
    status: Type.Union([Type.Literal('proposed'), Type.Literal('approved'), Type.Literal('rejected')]),
    feedback: Type.Optional(Type.String()),
  },
  strict,
)

export const planStatusSchema = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('completed'),
  Type.Literal('abandoned'),
])
export type PlanStatus = Static<typeof planStatusSchema>

/** plan v2：另有 completed（带完成报告 report）与 abandoned（v1 原样迁移）。 */
export const planPayloadSchema = Type.Object(
  { ...planFields, status: planStatusSchema, feedback: Type.Optional(Type.String()), report: Type.Optional(Type.String()) },
  strict,
)
export type PlanPayload = Static<typeof planPayloadSchema>

/** Session 的计划阶段：无、规划中、执行中。 */
export const planPhaseSchema = Type.Union([Type.Literal('none'), Type.Literal('planning'), Type.Literal('executing')])
export type PlanPhase = Static<typeof planPhaseSchema>

/** plan_phase v1：计划阶段的一次转换；executing 带被执行计划的 planId。 */
export const planPhasePayloadSchema = Type.Union([
  Type.Object({ phase: Type.Literal('none') }, strict),
  Type.Object({ phase: Type.Literal('planning') }, strict),
  Type.Object({ phase: Type.Literal('executing'), planId: Id }, strict),
])
export type PlanPhasePayload = Static<typeof planPhasePayloadSchema>

export interface PlanningEntryPayloads {
  plan: PlanPayload
  plan_phase: PlanPhasePayload
}

export const planningEntryPayloads = definePayloads({
  plan: [{ schema: planV1Schema }, { schema: planPayloadSchema, migrate: (previous: EntryJson) => previous }],
  plan_phase: [{ schema: planPhasePayloadSchema }],
} satisfies Record<keyof PlanningEntryPayloads, unknown>)

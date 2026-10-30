// Goal 的条目 payload（ADR 0011：每次变化提交一条完整快照；与 @coko/protocol 的 goal.ts 一致，server 的 entry-payloads.ts 编译期比对）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const goalPhaseSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('waiting-input'),
  Type.Literal('waiting-external'),
  Type.Literal('paused'),
  Type.Literal('blocked'),
  Type.Literal('failed'),
  Type.Literal('budget-exhausted'),
  Type.Literal('complete'),
  Type.Literal('cancelled'),
])
export type GoalPhase = Static<typeof goalPhaseSchema>

export const goalCriterionSchema = Type.Object({ id: Id, text: Type.String({ minLength: 1 }) }, strict)
export type GoalCriterion = Static<typeof goalCriterionSchema>

export const goalBudgetSchema = Type.Object(
  {
    maxRounds: Type.Optional(Type.Integer({ minimum: 1 })),
    maxToolCalls: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maxCost: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    maxDurationMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  strict,
)
export type GoalBudget = Static<typeof goalBudgetSchema>

export const goalEvidenceSchema = Type.Object({ criterionId: Id, text: Type.String({ minLength: 1 }), toolCallIds: Type.Optional(Type.Array(Id)) }, strict)
export type GoalEvidence = Static<typeof goalEvidenceSchema>

export const goalPayloadSchema = Type.Object(
  {
    id: Id,
    revision: Type.Integer({ minimum: 1 }),
    objective: Type.String({ minLength: 1 }),
    constraints: Type.Optional(Type.String()),
    criteria: Type.Array(goalCriterionSchema, { minItems: 1, maxItems: 10 }),
    budget: goalBudgetSchema,
    phase: goalPhaseSchema,
    reason: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() }, strict)),
    /** waiting-external：等待结束的 Job。 */
    waitingFor: Type.Optional(Type.Object({ jobIds: Type.Array(Id) }, strict)),
    /** 最近一次恢复时的轮次（blocked 的最少轮数从这里起算）。 */
    resumedAtRound: Count,
    evidence: Type.Optional(Type.Array(goalEvidenceSchema)),
    completedBy: Type.Optional(Type.Union([Type.Literal('model'), Type.Literal('user')])),
    /** 取消时的停止传播结果；失败项不阻止取消。 */
    cleanup: Type.Optional(Type.Object({ runsAborted: Count, jobsKilled: Count, failures: Type.Array(Type.String()) }, strict)),
    source: Type.Union([Type.Literal('model'), Type.Literal('user'), Type.Literal('system')]),
  },
  strict,
)
export type GoalPayload = Static<typeof goalPayloadSchema>

export interface GoalEntryPayloads {
  goal: GoalPayload
}

export const goalEntryPayloads = definePayloads({
  goal: [{ schema: goalPayloadSchema }],
} satisfies Record<keyof GoalEntryPayloads, unknown>)

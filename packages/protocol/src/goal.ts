import { Type, type Static } from 'typebox'

// Goal 的条目 payload（ADR 0011：Goal 状态是 Session Entry，每次变化提交一条完整快照）。entries.ts 据 goalEntryPayloadSchemas 组成 SessionEntry。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** 九个阶段：running、waiting-input、waiting-external、paused、blocked、failed、budget-exhausted 与终态 complete、cancelled。 */
export const GoalPhase = Type.Union([
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
export type GoalPhase = Static<typeof GoalPhase>

/** 成功条件：创建时记下，完成时逐条给出证据。 */
export const GoalCriterion = Type.Object({ id: Id, text: Type.String({ minLength: 1 }) }, strict)
export type GoalCriterion = Static<typeof GoalCriterion>

/** 五维预算；省略的维度不设上限。 */
export const GoalBudget = Type.Object(
  {
    maxRounds: Type.Optional(Type.Integer({ minimum: 1 })),
    maxToolCalls: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maxCost: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    maxDurationMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  strict,
)
export type GoalBudget = Static<typeof GoalBudget>

export const GoalEvidence = Type.Object({ criterionId: Id, text: Type.String({ minLength: 1 }), toolCallIds: Type.Optional(Type.Array(Id)) }, strict)
export type GoalEvidence = Static<typeof GoalEvidence>

export const GoalSource = Type.Union([Type.Literal('model'), Type.Literal('user'), Type.Literal('system')])
export type GoalSource = Static<typeof GoalSource>

/** goal v1：Goal 的完整快照；最后一条即当前状态。 */
export const GoalPayload = Type.Object(
  {
    id: Id,
    revision: Type.Integer({ minimum: 1 }),
    objective: Type.String({ minLength: 1 }),
    constraints: Type.Optional(Type.String()),
    criteria: Type.Array(GoalCriterion, { minItems: 1, maxItems: 10 }),
    budget: GoalBudget,
    phase: GoalPhase,
    reason: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() }, strict)),
    waitingFor: Type.Optional(Type.Object({ jobIds: Type.Array(Id) }, strict)),
    resumedAtRound: Count,
    evidence: Type.Optional(Type.Array(GoalEvidence)),
    completedBy: Type.Optional(Type.Union([Type.Literal('model'), Type.Literal('user')])),
    cleanup: Type.Optional(Type.Object({ runsAborted: Count, jobsKilled: Count, failures: Type.Array(Type.String()) }, strict)),
    source: GoalSource,
  },
  strict,
)
export type GoalPayload = Static<typeof GoalPayload>

/** 本领域的 kind → payload schema。 */
export const goalEntryPayloadSchemas = {
  goal: GoalPayload,
}

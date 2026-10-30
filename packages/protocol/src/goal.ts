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

/**
 * Goal 的已用量（ADR 0011：从条目派生）。rounds 为已开始的 Goal Round 数；其余维度在预算派生实现后给出（省略表示尚未派生）。
 * costUnpriced：当前模型未定价，费用无法计算。
 */
export const GoalUsage = Type.Object(
  {
    rounds: Count,
    toolCalls: Type.Optional(Count),
    tokens: Type.Optional(Count),
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    durationMs: Type.Optional(Count),
    costUnpriced: Type.Optional(Type.Boolean()),
  },
  strict,
)
export type GoalUsage = Static<typeof GoalUsage>

/** GET / POST /api/sessions/:id/goal 的响应：当前 Goal（最新的 goal 条目；没有时 null）与已用量。 */
export const GoalResponse = Type.Object({ goal: Type.Union([GoalPayload, Type.Null()]), usage: GoalUsage }, strict)
export type GoalResponse = Static<typeof GoalResponse>

/**
 * POST /api/sessions/:id/goal：用户的动作。revision 必须是当前 revision（否则 409 revision-conflict）；当前阶段不允许时 409
 * invalid-transition；没有 Goal 时 404。edit 给出要替换的字段（criteria 为条件文本，id 按位置重新编号；budget 整体替换，maxRounds 缺省 50）。
 * cancel 在进行中的 Run 结束、该 Goal 的 Job 停止之后返回，快照带 cleanup。
 */
export const GoalActionRequest = Type.Object(
  {
    action: Type.Union([Type.Literal('pause'), Type.Literal('resume'), Type.Literal('cancel'), Type.Literal('complete'), Type.Literal('edit')]),
    revision: Type.Integer({ minimum: 1 }),
    objective: Type.Optional(Type.String({ minLength: 1 })),
    constraints: Type.Optional(Type.String()),
    criteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 })),
    budget: Type.Optional(GoalBudget),
  },
  strict,
)
export type GoalActionRequest = Static<typeof GoalActionRequest>

/** Goal 的路径。 */
export const goalPaths = {
  /** GET：GoalResponse；POST：GoalActionRequest → GoalResponse。 */
  sessionGoal: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/goal`,
} as const

/** 本领域的 kind → payload schema。 */
export const goalEntryPayloadSchemas = {
  goal: GoalPayload,
}

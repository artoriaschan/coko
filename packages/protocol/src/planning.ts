import { Type, type Static } from 'typebox'

// Plan Mode 提交的计划与 Session 的计划阶段（ADR 0005、ADR 0028）。entries.ts 据 planningEntryPayloadSchemas 组成 SessionEntry。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

const planFields = { planId: Id, revision: Type.Integer({ minimum: 1 }), markdown: Type.String() }

export const PlanStatus = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('completed'),
  Type.Literal('abandoned'),
])
export type PlanStatus = Static<typeof PlanStatus>

/**
 * plan v2：一次提交、审阅或结束的结果；同一 planId 的 revision 递增。completed 带完成报告 report（Markdown），completed 与 abandoned
 * 沿用被执行计划的 planId、revision 与 markdown。
 */
export const PlanPayload = Type.Object(
  { ...planFields, status: PlanStatus, feedback: Type.Optional(Type.String()), report: Type.Optional(Type.String()) },
  strict,
)
export type PlanPayload = Static<typeof PlanPayload>

/** Session 的计划阶段（ADR 0028）：无、规划中、执行中。 */
export const PlanPhase = Type.Union([Type.Literal('none'), Type.Literal('planning'), Type.Literal('executing')])
export type PlanPhase = Static<typeof PlanPhase>

/** plan_phase v1：计划阶段的一次转换；executing 带被执行计划的 planId。当前阶段是有效条目中最后一条，没有时为 none。 */
export const PlanPhasePayload = Type.Union([
  Type.Object({ phase: Type.Literal('none') }, strict),
  Type.Object({ phase: Type.Literal('planning') }, strict),
  Type.Object({ phase: Type.Literal('executing'), planId: Id }, strict),
])
export type PlanPhasePayload = Static<typeof PlanPhasePayload>

/** GET / POST /api/sessions/:id/plan 的响应：当前阶段与活动的 Plan（规划中待审阅的计划、执行中被执行的计划，否则 null）。 */
export const SessionPlanResponse = Type.Object({ phase: PlanPhase, plan: Type.Union([PlanPayload, Type.Null()]) }, strict)
export type SessionPlanResponse = Static<typeof SessionPlanResponse>

/** POST /api/sessions/:id/plan：enter 进入规划，exit 退出规划；已在 / 不在规划中时不提交条目。不改变 Permission Mode（ADR 0028）。 */
export const PlanActionRequest = Type.Object({ action: Type.Union([Type.Literal('enter'), Type.Literal('exit')]) }, strict)
export type PlanActionRequest = Static<typeof PlanActionRequest>

export const planPaths = {
  /** GET：SessionPlanResponse（子 Session 返回根 Session 的阶段与计划）；POST：PlanActionRequest → SessionPlanResponse（子 Session 409 child-session）。 */
  sessionPlan: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/plan`,
}

/** exit_plan_mode 的 plan 与审阅时编辑的计划：至多这么多字符，必须以 Markdown 标题（# 开头的行）开始。 */
export const PLAN_MAX_CHARS = 64_000

/** 计划的格式检查：合格时 undefined，否则为原因（exit_plan_mode 的参数错误与审阅接口的 400 使用同一条规则）。 */
export function planMarkdownProblem(markdown: string): string | undefined {
  if (markdown.length > PLAN_MAX_CHARS) return `the plan is longer than ${PLAN_MAX_CHARS} characters`
  if (!/^#{1,6}[ \t]+\S/.test(markdown.trimStart())) return 'the plan must start with a Markdown heading (a line beginning with #)'
  return undefined
}

/** 计划的标题：第一行去掉 # 与空白（审批卡与计划卡显示）。 */
export function planTitle(markdown: string): string {
  const first = markdown.trimStart().split('\n', 1)[0] ?? ''
  return first.replace(/^#{1,6}[ \t]+/, '').trim()
}

/** 本领域的 kind → payload schema。 */
export const planningEntryPayloadSchemas = {
  plan: PlanPayload,
  plan_phase: PlanPhasePayload,
}

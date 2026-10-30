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
}

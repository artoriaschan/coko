// exit_plan_mode：Plan Mode 中提交计划交给用户审阅（ADR 0005）。权限类 plan-exit：任何模式都询问、允许规则不生效、拒绝规则生效。
// 权限 hook 在询问之前经 PlanReview.propose 提交 proposed 的 plan 条目，以 kind plan 的 Approval Request 等待回答；批准后执行本工具，
// 由宿主提交 approved 的计划与恢复的模式（PlanReview.approved），结果把最终计划交给模型。带反馈的拒绝由 hook 提交 rejected，Run 继续规划。
import { Type, type Static } from 'typebox'
import type { PermissionMode } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { PlanRef } from './state.ts'

export const EXIT_PLAN_MODE_TOOL = 'exit_plan_mode'

/** 计划的字符上限与格式（与 @coko/protocol 的 planning.ts 相同）。 */
export const PLAN_MAX_CHARS = 64_000

/** 合格时 undefined，否则为原因。 */
export function planMarkdownProblem(markdown: string): string | undefined {
  if (markdown.length > PLAN_MAX_CHARS) return `the plan is longer than ${PLAN_MAX_CHARS} characters`
  if (!/^#{1,6}[ \t]+\S/.test(markdown.trimStart())) return 'the plan must start with a Markdown heading (a line beginning with #)'
  return undefined
}

/** 第一行去掉 # 与空白（审批请求的 subject）。 */
export function planTitle(markdown: string): string {
  const first = markdown.trimStart().split('\n', 1)[0] ?? ''
  return first.replace(/^#{1,6}[ \t]+/, '').trim()
}

export const invalidPlanText = (problem: string) => `Invalid plan: ${problem}. Call exit_plan_mode again with the complete plan.`

/** 批准后交给模型的文本（契约）。 */
export const planApprovedText = (mode: PermissionMode, markdown: string) =>
  `The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions. Proceed under ${mode}.\n\n${markdown}`

/** 不在 plan 模式时调用 exit_plan_mode（例如同一 Run 中计划已批准）：不审阅。 */
export const NOT_IN_PLAN_MODE_TEXT = 'Not in plan mode: the plan was already approved or plan mode was turned off. Continue with the task.'

/** 带反馈的拒绝交给模型的文本（契约）。 */
export const planFeedbackText = (feedback: string) =>
  `The user did not approve the plan and said:\n${feedback}\n\nKeep planning: address the feedback, then call exit_plan_mode with the revised plan.`

/** 宿主对一次计划审阅的处理（每个 Session 一份）；toolCallId 关联同一次调用。 */
export interface PlanReview {
  /** 询问之前：提交 proposed 的 plan 条目，返回其位置。 */
  propose(toolCallId: string, markdown: string): Promise<PlanRef>
  /** 用户拒绝（feedback 为已截断的反馈）：提交 rejected 的 plan 条目。 */
  rejected(toolCallId: string, feedback: string | undefined): Promise<void>
  /** 用户批准、本工具执行时：提交 approved 的计划（编辑后为新 revision）与批准后的模式，返回最终计划与模式。 */
  approved(toolCallId: string, markdown: string): Promise<{ markdown: string; mode: PermissionMode }>
  /** Session 当前是否在 plan 模式；false 时不提交、不询问（工具在 Run 开始时注册，批准后同一 Run 中仍可调用）。 */
  active(): Promise<boolean>
}

const parameters = Type.Object({
  plan: Type.String({
    description: 'The complete plan as Markdown, starting with a # heading. The user reviews and may edit it before approving.',
  }),
})

const reviews = new WeakMap<CokoTool, PlanReview>()

/** 权限 hook 取用：工具是由 createExitPlanModeTool 创建的（不能由工具对象自行声明）。 */
export function planReviewOf(tool: CokoTool | undefined): PlanReview | undefined {
  return tool ? reviews.get(tool) : undefined
}

export function createExitPlanModeTool(review: PlanReview): CokoTool<typeof parameters> {
  const tool: CokoTool<typeof parameters> = {
    name: EXIT_PLAN_MODE_TOOL,
    label: 'Exit plan mode',
    description:
      'Submit the finished plan for the user to review and leave plan mode. Only call it in plan mode, once the plan is complete. The plan must be Markdown starting with a # heading.',
    parameters,
    effect: 'side-effect',
    timeoutMs: 0,
    async execute(toolCallId, params: Static<typeof parameters>) {
      const problem = planMarkdownProblem(params.plan)
      if (problem) throw new Error(invalidPlanText(problem))
      const { markdown, mode } = await review.approved(toolCallId, params.plan)
      return { content: [{ type: 'text', text: planApprovedText(mode, markdown) }], details: undefined }
    },
  }
  reviews.set(tool as CokoTool, review)
  return tool
}

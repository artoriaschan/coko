// complete_plan：执行中的 Plan 由模型提交完成报告而结束（ADR 0028）。权限类 session-state：所有模式放行，拒绝与询问规则、Hook 照常。
// 宿主（CompletePlanPort）在调用时现取计划阶段：不在执行中时抛出 NO_PLAN_IN_PROGRESS_TEXT；成功时提交 completed 的 plan 条目与计划阶段“无”。
// 宿主不校验报告结构，不运行任何验证。
import { Type, type Static } from 'typebox'
import type { CokoTool } from '../tools/types.ts'
import { PLAN_MAX_CHARS } from './exit-plan-mode.ts'

export const COMPLETE_PLAN_TOOL = 'complete_plan'

export interface CompletePlanPort {
  /** 提交完成报告；没有执行中的 Plan 时抛出 NO_PLAN_IN_PROGRESS_TEXT。 */
  complete(report: string): Promise<void>
}

export const invalidReportText = (problem: string) => `Invalid report: ${problem}. Call complete_plan again with the complete report.`

export const NO_PLAN_IN_PROGRESS_TEXT =
  'No plan is being carried out: there is no approved plan in progress (it was completed or abandoned, or none was approved). Continue with the task.'

export const PLAN_COMPLETED_TEXT = 'The plan is complete and your report was recorded; the user sees it with the plan. Continue only if the user asks for more.'

const parameters = Type.Object({
  report: Type.String({ description: 'The completion report as Markdown, following the approved plan item by item.' }),
})

export function createCompletePlanTool(port: CompletePlanPort): CokoTool<typeof parameters> {
  return {
    name: COMPLETE_PLAN_TOOL,
    label: 'Complete plan',
    description:
      'Finish the approved plan you are carrying out by submitting a completion report. Call it once, after the work is done and verified. Go through the plan item by item: what you did, how you verified it, and anything you did not do or did differently, with the reason. The user does not need to approve it.',
    parameters,
    effect: 'side-effect',
    timeoutMs: 0,
    async execute(_toolCallId, { report }: Static<typeof parameters>) {
      if (report.trim() === '') throw new Error(invalidReportText('the report is empty'))
      if (report.length > PLAN_MAX_CHARS) throw new Error(invalidReportText(`the report is longer than ${PLAN_MAX_CHARS} characters`))
      await port.complete(report)
      return { content: [{ type: 'text', text: PLAN_COMPLETED_TEXT }], details: undefined }
    },
  }
}

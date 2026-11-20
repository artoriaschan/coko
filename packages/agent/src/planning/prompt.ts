// Plan Mode 的 system section（ADR 0005、ADR 0028）：规划中开始的 Run 注入 <plan_mode>（子 Session 另一段）；已批准的计划被压缩摘要掉后注入 <approved_plan>。
import type { SystemSection } from '../engine/types.ts'

/** <approved_plan> 的正文上限（字符）；超出截断并注明。 */
export const APPROVED_PLAN_MAX_CHARS = 16_000

// 票 03 的过渡版（ADR 0028）：写入与提权由计划阶段拒绝；Permission Mode 仍为 plan，其余调用仍按 read-only 询问（票 04 改为按当前权限处理）。
export const PLAN_MODE_TEXT = [
  '<plan_mode>',
  'Plan mode is active. Research and design only: the user reviews your plan before anything in the Workspace changes.',
  '- File writes (write, edit) are refused while planning. Put the changes you intend to make in the plan instead.',
  '- Commands run in a read-only sandbox and cannot be escalated; a command that writes files fails.',
  '- Reads and searches are allowed; other calls may need the user’s approval.',
  'When the plan is ready, call exit_plan_mode with the complete plan as Markdown starting with a # heading. If the user sends feedback, keep planning and submit a revised plan. Once the user approves, plan mode ends and the tool result tells you how to proceed.',
  '</plan_mode>',
].join('\n')

/** 子 Session（根 Session 在规划中）：只讲不可改动，不提提交计划（子 Session 没有 exit_plan_mode）。 */
export const SUBAGENT_PLAN_MODE_TEXT = [
  '<plan_mode>',
  'The parent session is in plan mode, so this task must not change the Workspace. File writes (write, edit) are refused and commands run in a read-only sandbox that cannot be escalated. Research, then report your findings and the changes you would make to the parent agent.',
  '</plan_mode>',
].join('\n')

/** 规划中开始的 Run 的 <plan_mode>；child 为子 Session。 */
export function planModeSection(child = false): SystemSection {
  return { name: 'plan_mode', text: child ? SUBAGENT_PLAN_MODE_TEXT : PLAN_MODE_TEXT }
}

/** 已批准计划的再注入（压缩把它摘要掉之后）；正文超过上限时截断并注明。 */
export function approvedPlanSection(markdown: string): SystemSection {
  const truncated = markdown.length > APPROVED_PLAN_MAX_CHARS
  const body = truncated
    ? `${markdown.slice(0, APPROVED_PLAN_MAX_CHARS)}\n[truncated: the approved plan is ${markdown.length} characters; only the first ${APPROVED_PLAN_MAX_CHARS} are shown]`
    : markdown
  return {
    name: 'approved_plan',
    text: ['<approved_plan>', 'The user approved this plan earlier in the session; keep following it.', body, '</approved_plan>'].join('\n'),
  }
}

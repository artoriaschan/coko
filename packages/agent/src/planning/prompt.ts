// Plan Mode 的 system section（ADR 0005 的 plan 模式）：plan 模式的 Run 注入 <plan_mode>；已批准的计划被压缩摘要掉后注入 <approved_plan>。
import type { SystemSection } from '../engine/types.ts'

/** <approved_plan> 的正文上限（字符）；超出截断并注明。 */
export const APPROVED_PLAN_MAX_CHARS = 16_000

export const PLAN_MODE_TEXT = [
  '<plan_mode>',
  'Plan mode is active. Research and design only: read files, search and think, but do not change the Workspace',
  '(no file writes, no commands that modify files or state). Write and command calls need the user’s approval and commands run in a read-only sandbox.',
  'When the plan is ready, call exit_plan_mode with the complete plan as Markdown starting with a # heading.',
  'The user reviews it: once approved you continue under the restored permission mode; if they send feedback, keep planning and submit a revised plan.',
  '</plan_mode>',
].join('\n')

export function planModeSection(): SystemSection {
  return { name: 'plan_mode', text: PLAN_MODE_TEXT }
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

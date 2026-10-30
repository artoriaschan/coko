// Goal 的模型可见文本：每个 Run 的 <goal> system section 与 Goal Round 的 <goal_round> user message（参考 deepseek-harness goal-round-driver）。
// 文本只来自已提交的快照（入库时已替换登记明文）。
import type { SystemSection } from '../engine/types.ts'
import type { GoalPayload } from '../session-entries/goals.ts'
import { GOAL_BLOCKED_MIN_ROUNDS, isTerminalPhase, type GoalUsageSnapshot } from './state.ts'

export const GOAL_SECTION_NAME = 'goal'

const criteriaLines = (goal: GoalPayload) => goal.criteria.map((c) => `- ${c.id}: ${c.text}`)

/** 已设维度的用量 / 上限（本票只有轮次的用量；其余维度只列上限）。 */
function budgetLines(goal: GoalPayload, usage: GoalUsageSnapshot): string[] {
  const { budget } = goal
  const lines = [`- rounds: ${usage.rounds} / ${budget.maxRounds ?? 'unlimited'}`]
  if (budget.maxToolCalls !== undefined) lines.push(`- tool calls: limit ${budget.maxToolCalls}`)
  if (budget.maxTokens !== undefined) lines.push(`- tokens: limit ${budget.maxTokens}`)
  if (budget.maxCost !== undefined) lines.push(`- cost: limit ${budget.maxCost}`)
  if (budget.maxDurationMs !== undefined) lines.push(`- time: limit ${budget.maxDurationMs} ms`)
  return lines
}

/** Goal 未终结时的 <goal> section（目标、约束、条件、阶段与原因、轮次与预算、工具用法）；终结或没有 Goal 时 undefined。 */
export function goalSection(goal: GoalPayload | undefined, usage: GoalUsageSnapshot): SystemSection | undefined {
  if (!goal || isTerminalPhase(goal.phase)) return undefined
  const lines = [
    '<goal>',
    `Current goal ${goal.id} (revision ${goal.revision}), phase ${goal.phase}${goal.reason ? ` (${goal.reason.code}: ${goal.reason.message})` : ''}.`,
    'Objective: ' + JSON.stringify(goal.objective),
    ...(goal.constraints ? ['Constraints: ' + JSON.stringify(goal.constraints)] : []),
    'Success criteria:',
    ...criteriaLines(goal),
    'Budget:',
    ...budgetLines(goal, usage),
    'Coko continues this goal in automatic goal rounds while it is running. Use get_goal for the current revision. Mark it complete with ' +
      'update_goal action complete only when every success criterion is met, giving evidence for each criterion and citing the ids of ' +
      'successful tool calls that show it. Use wait_input when you need the user, wait_jobs while background jobs must finish, and ' +
      `blocked only when the same blocking condition persisted for at least ${GOAL_BLOCKED_MIN_ROUNDS} goal rounds.`,
    '</goal>',
  ]
  return { name: GOAL_SECTION_NAME, text: lines.join('\n') }
}

/** Goal Round 的输入：目标（JSON 字符串）、成功条件、"第 n / 上限 轮"与推进说明。 */
export function goalRoundText(goal: GoalPayload, round: number): string {
  return [
    '<goal_round>',
    'Objective: ' + JSON.stringify(goal.objective),
    'Success criteria:',
    ...criteriaLines(goal),
    `Round: ${round} / ${goal.budget.maxRounds ?? 'unlimited'}`,
    '',
    'Continue working toward the goal ' +
      goal.id +
      ' in this session. Treat the current workspace, tool results and committed session state as authoritative; inspect them instead of ' +
      'assuming earlier narration is still current. Make concrete progress and verify it. When every success criterion is met, call ' +
      'update_goal with action complete and evidence for each criterion (cite the ids of successful tool calls). If work remains, end ' +
      'this round and the next one will follow.',
    '</goal_round>',
  ].join('\n')
}

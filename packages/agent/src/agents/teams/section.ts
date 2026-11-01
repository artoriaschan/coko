// teammate 子 Session 的 <team> system section（ADR 0018）：自己的名字、lead 与其他成员、任务板的使用要求。名字只能是 [a-z][a-z0-9-]，
// 任务的标题来自已入库（已脱敏）的 team_task 条目。
import type { TeamTaskView } from './board.ts'
import { TEAM_LEAD_NAME } from './names.ts'

export interface TeamSectionInput {
  /** 本 teammate 的名字。 */
  name: string
  /** 其他未解散的成员（不含自己）。 */
  members: readonly { name: string; status: string }[]
  /** 当前任务板（不含已删除）。 */
  tasks: readonly TeamTaskView[]
}

const TASK_LINES_MAX = 30

export function teamSectionText({ name, members, tasks }: TeamSectionInput): string {
  const others = members.length > 0 ? members.map((m) => `${m.name} (${m.status})`).join(', ') : 'none'
  const shown = tasks.slice(0, TASK_LINES_MAX).map((t) => {
    const owner = t.owner ? ` owner=${t.owner}` : ''
    const blocked = t.blockedBy.length > 0 ? ` blockedBy=${t.blockedBy.join(',')}` : ''
    return `- ${t.taskId} r${t.revision} [${t.status}${t.ready ? ', ready' : ''}]${owner}${blocked}: ${t.subject}`
  })
  const more = tasks.length > TASK_LINES_MAX ? [`- … ${tasks.length - TASK_LINES_MAX} more; use task_list`] : []
  return [
    `<team name="${name}">`,
    `You are teammate "${name}" in an agent team led by "${TEAM_LEAD_NAME}" (the agent that created you). Other teammates: ${others}.`,
    'Coordinate through the shared task board and messages:',
    '- task_list shows every task with its revision and whether it is ready; claim a ready task with task_update { status: "in_progress", expected_revision } before working on it.',
    '- Only work on tasks you own; mark them completed with task_update when done. A stale-revision error means someone changed the task: list again and retry.',
    `- send_message { to } reaches "${TEAM_LEAD_NAME}", a teammate by name, or "*" for everyone. Messages from others arrive as <team-message> blocks.`,
    '- When you finish a turn, the lead is notified with your last reply; keep it a short report.',
    shown.length > 0 ? 'Current tasks:' : 'The task board is empty.',
    ...shown,
    ...more,
    '</team>',
  ].join('\n')
}

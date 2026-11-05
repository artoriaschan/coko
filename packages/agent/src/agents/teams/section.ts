// teammate 子 Session 的静态 <team> system section（ADR 0024）：自己的名字、lead 与任务板的使用要求。
import { TEAM_LEAD_NAME } from './names.ts'

export interface TeamSectionInput {
  /** 本 teammate 的名字。 */
  name: string
}

export function teamSectionText({ name }: TeamSectionInput): string {
  return [
    `<team name="${name}">`,
    `You are teammate "${name}" in an agent team led by "${TEAM_LEAD_NAME}" (the agent that created you).`,
    'Coordinate through the shared task board and messages:',
    '- task_list shows every task with its revision and whether it is ready; claim a ready task with task_update { status: "in_progress", expected_revision } before working on it.',
    '- Only work on tasks you own; mark them completed with task_update when done. A stale-revision error means someone changed the task: list again and retry.',
    `- send_message { to } reaches "${TEAM_LEAD_NAME}", a teammate by name, or "*" for everyone. Messages from others arrive as <team-message> blocks.`,
    '- When you finish a turn, the lead is notified with your last reply; keep it a short report.',
    'The latest team State Update contains the other teammates and current task board; use task_list for the full board.',
    '</team>',
  ].join('\n')
}

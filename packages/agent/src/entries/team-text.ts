// Browser-safe rendering of the structured team snapshot, shared by State Update consumers.
export interface TeamStateValue {
  members: readonly { name: string; status: string }[]
  tasks: readonly {
    taskId: string
    revision: number
    subject: string
    status: string
    ready: boolean
    owner?: string
    blockedBy: readonly string[]
  }[]
}

/** At most 30 body lines, including member/task headings and the overflow notice. */
export function teamStateText({ members, tasks }: TeamStateValue): string {
  const others = members.length > 0 ? members.map((m) => `${m.name} (${m.status})`).join(', ') : 'none'
  const availableTaskLines = 30 - 2 // Reserve one member line and one task heading.
  const taskLimit = tasks.length > availableTaskLines ? availableTaskLines - 1 : availableTaskLines
  const shown = tasks.slice(0, taskLimit).map((task) => {
    const owner = task.owner ? ` owner=${task.owner}` : ''
    const blocked = task.blockedBy.length > 0 ? ` blockedBy=${task.blockedBy.join(',')}` : ''
    return `- ${task.taskId} r${task.revision} [${task.status}${task.ready ? ', ready' : ''}]${owner}${blocked}: ${task.subject.replace(/[\r\n]/g, ' ')}`
  })
  return [
    `Other teammates: ${others}.`,
    shown.length > 0 ? 'Current tasks:' : 'The task board is empty.',
    ...shown,
    ...(tasks.length > taskLimit ? [`- … ${tasks.length - taskLimit} more; use task_list`] : []),
  ].join('\n')
}

import type { TeamTaskPayload } from '@coko/protocol'
import { ListTodoIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'

type TaskChange = 'created' | 'claimed' | 'completed' | 'deleted' | 'updated'

/** 由快照判断这次变更（条目只有变更后的完整快照）：第一版为创建；变为 in_progress 且变更者是 owner 为认领。 */
export function taskChange(task: TeamTaskPayload): TaskChange {
  if (task.status === 'deleted') return 'deleted'
  if (task.status === 'completed') return 'completed'
  if (task.revision === 1) return 'created'
  if (task.status === 'in_progress' && task.owner === task.by) return 'claimed'
  return 'updated'
}

/** 任务板变更的紧凑行（根 Session 的 team_task 条目）：谁做了什么，以及任务编号与标题。 */
export function TeamTaskRow({ item }: { item: Extract<TimelineItem, { kind: 'team-task' }> }) {
  const { t } = useI18n()
  const { task } = item
  const change = taskChange(task)
  return (
    <div
      data-slot="team-task"
      data-task-id={task.taskId}
      data-task-change={change}
      data-revision={task.revision}
      className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground"
    >
      <ListTodoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0">{t(`teams.task.${change}`, { by: task.by })}</span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-ui-small">{task.taskId}</span>
          <span data-user-content className="min-w-0 truncate text-foreground" title={task.subject}>
            {task.subject}
          </span>
        </span>
      </div>
    </div>
  )
}

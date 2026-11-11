import type { TimelineRootAttributes } from './timeline-projection.ts'
import type { TeamTaskPayload } from '@coko/protocol'
import { IconChecklist } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'
import { CollaborationRow } from './collaboration-row.tsx'
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
export function TeamTaskRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'team-task' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t } = useI18n()
  const { task } = item
  const change = taskChange(task)
  return (
    <CollaborationRow
      {...rootAttributes}
      data-slot="team-task"
      data-task-id={task.taskId}
      data-task-change={change}
      data-revision={task.revision}
      icon={<IconChecklist aria-hidden />}
      label={
        <>
          <span>{t(`teams.task.${change}`, { by: task.by })}</span> <span className="font-mono">{task.taskId}</span>{' '}
          <span data-user-content>{task.subject}</span>
        </>
      }
    >
      <p data-user-content>{task.description}</p>
      <p>{task.status === 'deleted' ? t('teams.task.deleted', { by: task.by }) : t(`teams.board.status.${task.status}`)}</p>
      {task.owner !== undefined && <p>{t('teams.board.owner', { owner: task.owner })}</p>}
      {task.blockedBy.length > 0 && <p>{t('teams.board.blockedBy', { tasks: task.blockedBy.join(', ') })}</p>}
      <pre data-user-content className="conversation-collaboration-source">
        {JSON.stringify(task, null, 2)}
      </pre>
    </CollaborationRow>
  )
}

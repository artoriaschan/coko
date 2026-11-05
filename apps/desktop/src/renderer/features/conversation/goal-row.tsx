import type { TimelineRootAttributes } from './timeline-projection.ts'
import { TargetIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { GoalPhaseBadge, goalReasonText } from './dock/goal-card.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 时间线的 Goal 行（goal 条目）：紧凑状态行。第一条快照为"新目标"与目标文本；之后为阶段徽标与原因（没有原因时为目标文本）。
 * 文本换行显示，不截断。
 */
export function GoalRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'goal' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t, dictionary } = useI18n()
  const { goal } = item
  const created = goal.revision === 1
  const reason = created ? undefined : goalReasonText(t, dictionary, goal.reason)
  return (
    <p
      {...rootAttributes}
      data-slot="goal-row"
      data-goal-id={goal.id}
      data-revision={goal.revision}
      data-phase={goal.phase}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 conversation-business-row text-muted-foreground"
    >
      <TargetIcon aria-hidden className="size-4 shrink-0" />
      <span className="shrink-0">{created ? t('goal.row.created') : t('goal.title')}</span>
      <GoalPhaseBadge phase={goal.phase} />
      {reason ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {reason.text}
          {reason.detail !== undefined && (
            <>
              {' · '}
              <span data-user-content>{reason.detail}</span>
            </>
          )}
        </span>
      ) : (
        <span data-user-content className="min-w-0 [overflow-wrap:anywhere]">
          {goal.objective}
        </span>
      )}
    </p>
  )
}

import type { TimelineRootAttributes } from './timeline-projection.ts'
import { AlarmClockIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { formatScheduleTime, useSchedules } from './schedules-button.tsx'
import { CollaborationRow } from './collaboration-row.tsx'
import { useTimelineSession } from './timeline-session.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 时间线的定时任务投递（schedule_fire）行：紧凑行。开始执行或已跳过（与原因）、任务标题、计划时刻与合并的错过次数。
 * 标题来自 schedules store（标题栏按钮读取会话的列表），其次取该 Run 输入包装中的标题；都没有时显示"已删除的定时任务"。
 * 定时任务 Run 的输入（<scheduled_task> 包装）不成用户气泡，这一行即是该 Run 的开头。
 */
export function ScheduleFireRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'schedule-fire' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t, locale } = useI18n()
  const { fire } = item
  const { sessionId } = useTimelineSession()
  const listed = useSchedules((s) => (sessionId === null ? undefined : s.lists[sessionId]?.schedules.find((x) => x.id === fire.scheduleId)?.title))
  // 列表中找不到（已删除或尚未读取）时，取该 Run 输入包装中的标题。
  const title = listed ?? item.title
  const skipped = fire.status === 'skipped'
  const details = [
    t('schedules.occurrence', { time: formatScheduleTime(locale, fire.occurrence) }),
    skipped ? t(`schedules.skipReasons.${fire.reason ?? 'start-failed'}`) : undefined,
    fire.missed === undefined ? undefined : t('schedules.missed', { count: fire.missed }),
  ].filter(Boolean)
  return (
    <CollaborationRow
      {...rootAttributes}
      data-slot="schedule-fire"
      data-status={fire.status}
      data-reason={fire.reason}
      data-schedule-id={fire.scheduleId}
      icon={<AlarmClockIcon aria-hidden />}
      label={
        <>
          <span className={skipped ? 'text-warning-text' : undefined}>{t(skipped ? 'schedules.fireRow.skipped' : 'schedules.fireRow.started')}</span>
          {' · '}
          <span data-user-content={title === undefined ? undefined : ''}>{title ?? t('schedules.unknownTask')}</span>
          {' · '}
          <span>{details.join(' · ')}</span>
        </>
      }
    >
      {item.prompt !== undefined && (
        <p data-user-content data-slot="schedule-prompt">
          {item.prompt}
        </p>
      )}
      <pre data-user-content className="conversation-collaboration-source">
        {JSON.stringify(fire, null, 2)}
      </pre>
    </CollaborationRow>
  )
}

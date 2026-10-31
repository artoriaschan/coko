import { AlarmClockIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { formatScheduleTime, useSchedules } from './schedules-button.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 时间线的定时任务投递（schedule_fire）行：紧凑行。开始执行或已跳过（与原因）、任务标题、计划时刻与合并的错过次数。
 * 标题来自 schedules store（标题栏按钮读取会话的列表），其次取该 Run 输入包装中的标题；都没有时显示"已删除的定时任务"。
 * 定时任务 Run 的输入（<scheduled_task> 包装）不成用户气泡，这一行即是该 Run 的开头。
 */
export function ScheduleFireRow({ item }: { item: Extract<TimelineItem, { kind: 'schedule-fire' }> }) {
  const { t, locale } = useI18n()
  const { fire } = item
  const listed = useSchedules((s) => {
    for (const list of Object.values(s.lists)) {
      const found = list.schedules.find((x) => x.id === fire.scheduleId)
      if (found) return found.title
    }
    return undefined
  })
  // 列表中找不到（已删除或尚未读取）时，取该 Run 输入包装中的标题。
  const title = listed ?? item.title
  const skipped = fire.status === 'skipped'
  const details = [
    t('schedules.occurrence', { time: formatScheduleTime(locale, fire.occurrence) }),
    skipped ? t(`schedules.skipReasons.${fire.reason ?? 'start-failed'}`) : undefined,
    fire.missed === undefined ? undefined : t('schedules.missed', { count: fire.missed }),
  ].filter(Boolean)
  return (
    <div
      data-slot="schedule-fire"
      data-status={fire.status}
      data-reason={fire.reason}
      data-schedule-id={fire.scheduleId}
      className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground"
    >
      <AlarmClockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={skipped ? 'shrink-0 text-warning-text' : 'shrink-0 text-foreground'}>
          {t(skipped ? 'schedules.fireRow.skipped' : 'schedules.fireRow.started')}
        </span>
        <span data-user-content={title === undefined ? undefined : ''} className="min-w-0 truncate" title={title}>
          {title ?? t('schedules.unknownTask')}
        </span>
        <span className="text-ui-small">{details.join(' · ')}</span>
      </p>
    </div>
  )
}

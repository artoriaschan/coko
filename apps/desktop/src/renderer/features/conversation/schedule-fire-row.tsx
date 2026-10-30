import type { TimelineItem } from './timeline.ts'

/** 时间线的定时任务投递（schedule_fire）行。定时任务的界面交付前不渲染。 */
export function ScheduleFireRow(_props: { item: Extract<TimelineItem, { kind: 'schedule-fire' }> }) {
  return null
}

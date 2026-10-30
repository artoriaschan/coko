import type { TimelineItem } from './timeline.ts'

/** 时间线的后台任务行（job_start、job_end 与 job_notification 条目）。后台任务视图交付前不渲染。 */
export function JobRow(_props: { item: Extract<TimelineItem, { kind: 'job' }> }) {
  return null
}

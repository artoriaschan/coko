import type { TimelineItem } from './timeline.ts'

/** 时间线的 Goal 行（goal 条目）。Goal 界面交付前不渲染。 */
export function GoalRow(_props: { item: Extract<TimelineItem, { kind: 'goal' }> }) {
  return null
}

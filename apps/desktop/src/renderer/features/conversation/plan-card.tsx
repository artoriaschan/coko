import type { TimelineItem } from './timeline.ts'

/** 时间线的计划卡（plan 条目）。Plan Mode 交付前不渲染。 */
export function PlanCard(_props: { item: Extract<TimelineItem, { kind: 'plan' }> }) {
  return null
}

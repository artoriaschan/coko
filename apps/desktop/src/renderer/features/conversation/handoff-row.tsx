import type { TimelineItem } from './timeline.ts'

/** 时间线的交接（handoff、handoff_origin）行。 Handoff 的界面交付前不渲染。 */
export function HandoffRow(_props: { item: Extract<TimelineItem, { kind: 'handoff' }> }) {
  return null
}

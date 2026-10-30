import type { TimelineItem } from './timeline.ts'

/** Run 结束后的用量行（Token 合计与费用）。用量界面交付前不渲染。 */
export function RunUsageRow(_props: { item: Extract<TimelineItem, { kind: 'run-usage' }> }) {
  return null
}

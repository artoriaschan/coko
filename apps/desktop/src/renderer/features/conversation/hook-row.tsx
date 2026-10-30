import type { TimelineItem } from './timeline.ts'

/** 时间线的 Hook（hook_run）行。外部 Hook 的界面交付前不渲染。 */
export function HookRow(_props: { item: Extract<TimelineItem, { kind: 'hook' }> }) {
  return null
}

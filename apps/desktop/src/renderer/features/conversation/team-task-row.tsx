import type { TimelineItem } from './timeline.ts'

/** 任务板变更的紧凑行。占位：团队界面接入前不渲染。 */
export function TeamTaskRow(_props: { item: Extract<TimelineItem, { kind: 'team-task' }> }) {
  return null
}

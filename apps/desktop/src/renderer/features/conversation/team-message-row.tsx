import type { TimelineItem } from './timeline.ts'

/** 团队消息的紧凑行（发送方 → 接收方与 summary）。占位：团队界面接入前不渲染。 */
export function TeamMessageRow(_props: { item: Extract<TimelineItem, { kind: 'team-message' }> }) {
  return null
}

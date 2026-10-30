import type { TimelineItem } from './timeline.ts'

/** 时间线的子代理结束通知（agent_notification）行。子代理的界面交付前不渲染。 */
export function AgentNotificationRow(_props: { item: Extract<TimelineItem, { kind: 'agent-notification' }> }) {
  return null
}

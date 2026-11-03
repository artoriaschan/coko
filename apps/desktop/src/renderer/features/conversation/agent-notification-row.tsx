import { BellIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { agentRecords, AgentStatusDot, useAgentStatus, useAgentsStoreApi, type AgentRecord } from './agents-button.tsx'
import { useTimelineSession } from './timeline-session.tsx'
import type { TimelineItem } from './timeline.ts'

function NotifiedAgent({ agentId, record, sessionId }: { agentId: string; record: AgentRecord | undefined; sessionId: string | null }) {
  const { t } = useI18n()
  const agents = useAgentsStoreApi()
  const status = useAgentStatus(record, sessionId)
  const label = record ? `${record.start.agentType} · ${record.start.description}` : agentId
  return (
    <li className="flex min-w-0 items-center gap-1.5" data-agent-id={agentId}>
      {status && <AgentStatusDot status={status} />}
      <button
        type="button"
        data-action="open-agent"
        aria-label={t('agents.card.openLabel', { description: record?.start.description ?? agentId })}
        disabled={sessionId === null}
        className="min-w-0 truncate rounded-sm text-ui-small text-foreground focus-ring [@media(hover:hover)]:hover:underline"
        onClick={() => sessionId !== null && agents.getState().open(sessionId, agentId)}
      >
        <span data-user-content>{label}</span>
      </button>
      {status && <span className="shrink-0 text-ui-small">{t(`agents.status.${status}`)}</span>}
    </li>
  )
}

/** 时间线的后台子代理结束通知（agent_notification）：紧凑行，"子代理已结束"与每个子代理的类型、描述与状态，点击在右栏打开。 */
export function AgentNotificationRow({ item }: { item: Extract<TimelineItem, { kind: 'agent-notification' }> }) {
  const { t } = useI18n()
  const { sessionId, entries } = useTimelineSession()
  const byId = React.useMemo(() => new Map(agentRecords(entries).map((r) => [r.start.agentId, r])), [entries])
  return (
    <div data-slot="agent-notification" className="flex min-w-0 items-start gap-2 conversation-business-row text-muted-foreground">
      <BellIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="shrink-0">{t('agents.notification')}</span>
        <ul className="flex min-w-0 flex-col">
          {item.notification.agentIds.map((agentId) => (
            <NotifiedAgent key={agentId} agentId={agentId} record={byId.get(agentId)} sessionId={sessionId} />
          ))}
        </ul>
      </div>
    </div>
  )
}

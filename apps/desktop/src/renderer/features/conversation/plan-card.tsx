import { planTitle } from '@coko/protocol'
import { ClipboardListIcon } from 'lucide-react'
import * as React from 'react'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { selectRightPanelTab } from '../right-panel/tabs.ts'
import { planHistory } from './plan-review-panel.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 时间线的计划卡（plan 条目）：标题、修订与状态，被拒绝时带反馈。proposed 的条目在同一计划有后续条目（批准、拒绝或新修订）后不再显示，
 * 时间线只留结论。点击切到右栏的 Plan tab。
 */
export function PlanCard({ item }: { item: Extract<TimelineItem, { kind: 'plan' }> }) {
  const { t } = useI18n()
  const { plan } = item
  const seq = Number(item.key)
  const sessionId = useChat((s) => s.activeSessionId)
  const superseded = useChat((s) => {
    if (plan.status !== 'proposed' || sessionId === null) return false
    const entries = s.conversations[sessionId]?.entries
    return (planHistory(entries ?? []).get(plan.planId) ?? []).some((p) => p.seq > seq)
  })
  const title = React.useMemo(() => planTitle(plan.markdown), [plan.markdown])
  if (superseded) return null
  return (
    <section
      data-slot="plan-card"
      data-plan-id={plan.planId}
      data-revision={plan.revision}
      data-status={plan.status}
      aria-label={t('plan.card.label')}
      className="flex flex-col gap-1 rounded-panel border-hairline border-border bg-background px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ClipboardListIcon aria-hidden className="size-4 shrink-0 text-link" />
        <button
          type="button"
          data-action="open-plan"
          title={t('plan.card.open')}
          className="min-w-0 flex-1 truncate text-start text-ui-body font-medium focus-ring [@media(hover:hover)]:hover:underline"
          onClick={() => selectRightPanelTab('plan')}
        >
          <span data-user-content>{title}</span>
        </button>
        <span className="shrink-0 text-ui-small text-muted-foreground">{t('plan.revision', { n: String(plan.revision) })}</span>
        <span data-slot="plan-status" className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-ui-small text-muted-foreground">
          {t(`plan.status.${plan.status}`)}
        </span>
      </div>
      {plan.feedback !== undefined && (
        <p className="text-ui-body text-muted-foreground">
          {t('plan.feedback')}：<span data-user-content>{plan.feedback}</span>
        </p>
      )}
    </section>
  )
}

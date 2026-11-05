import type { TimelineRootAttributes } from './timeline-projection.ts'
import { planTitle } from '@coko/protocol'
import { ClipboardListIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { PlanMarkdown, planHistory } from './plan-review-panel.tsx'
import { useTimelineSession } from './timeline-session.tsx'
import type { TimelineItem } from './timeline.ts'

/** The card and mounted projection share the same null-rendering decision. */
export function planCardSuppressed(item: Extract<TimelineItem, { kind: 'plan' }>, entries: readonly import('@coko/protocol').SessionEntry[]) {
  return item.plan.status === 'proposed' && (planHistory(entries).get(item.plan.planId) ?? []).some((p) => p.seq > Number(item.key))
}

/**
 * 时间线的计划卡（plan 条目）：标题、修订与状态，被拒绝时带反馈。proposed 的条目在同一计划有后续条目（批准、拒绝或新修订）后不再显示，
 * 时间线只留结论。点击切到右栏的 Plan tab。
 */
export function PlanCard({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'plan' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t } = useI18n()
  const { plan } = item
  const { entries, historical, readOnly, openPlan } = useTimelineSession()
  const superseded = planCardSuppressed(item, entries)
  const inline = historical || readOnly || openPlan === undefined
  const [expanded, setExpanded] = React.useState(false)
  const title = React.useMemo(() => planTitle(plan.markdown), [plan.markdown])
  if (superseded) return null
  return (
    <section
      {...rootAttributes}
      data-slot="plan-card"
      data-plan-id={plan.planId}
      data-revision={plan.revision}
      data-status={plan.status}
      aria-label={t('plan.card.label')}
      className="conversation-business-card conversation-business-row"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ClipboardListIcon aria-hidden className="size-4 shrink-0 text-link" />
        <button
          type="button"
          data-action="open-plan"
          title={t(inline ? 'plan.card.inspect' : 'plan.card.open')}
          className="min-w-0 flex-1 basis-40 break-words text-start font-normal focus-ring [@media(hover:hover)]:hover:underline"
          aria-expanded={inline ? expanded : undefined}
          onClick={() => (inline ? setExpanded((open) => !open) : openPlan?.())}
        >
          <span data-user-content>{title}</span>
        </button>
        <span className="shrink-0 text-ui-small text-muted-foreground">{t('plan.revision', { n: String(plan.revision) })}</span>
        <span data-slot="plan-status" className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-ui-small text-muted-foreground">
          {t(`plan.status.${plan.status}`)}
        </span>
      </div>
      {plan.feedback !== undefined && (
        <p className="break-words whitespace-pre-wrap text-muted-foreground">
          {t('plan.feedback')}：<span data-user-content>{plan.feedback}</span>
        </p>
      )}
      {inline && expanded && <PlanMarkdown text={plan.markdown} className="conversation-plan-snapshot" />}
    </section>
  )
}

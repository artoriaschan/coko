import { GaugeIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { costText, formatCount, sumUsage, totalTokens, useCurrency, usePricedLookup } from './session-cost.tsx'
import type { TimelineItem } from './timeline.ts'

import { useTimelineSession } from './timeline-session.tsx'

/** Run 结束后的用量行：该 Run 的请求 Token 合计（兼容旧记录）与费用，缺失/部分计量明确标记，未定价模型显示"未定价"而不是 0。 */
export function RunUsageRow({ item }: { item: Extract<TimelineItem, { kind: 'run-usage' }> }) {
  const { t, locale } = useI18n()
  const { entries } = useTimelineSession()
  const priced = usePricedLookup()
  const currency = useCurrency()
  const totals = React.useMemo(() => sumUsage(entries, priced, item.runId), [entries, priced, item.runId])
  const tokens = totalTokens(totals)
  return (
    <p
      data-slot="run-usage"
      data-run-id={item.runId}
      data-tokens={tokens}
      data-cost={totals.cost.total}
      data-unpriced={(totals.priced === 0 && totals.unpriced > 0) || undefined}
      aria-label={t('usage.runRow')}
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 conversation-business-row text-muted-foreground tabular-nums"
    >
      <GaugeIcon aria-hidden className="size-3.5 shrink-0" />
      <span>{totals.hasUsage ? t('usage.tokens', { count: formatCount(locale, tokens) }) : t('usage.unavailable')}</span>
      {!totals.complete && <span>{t('usage.incomplete')}</span>}
      <span aria-hidden>·</span>
      <span data-run-cost>{costText(t, locale, currency, totals)}</span>
    </p>
  )
}

import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { UsageTotals } from './session-cost.tsx'
import { formatCacheHitPercent, formatExactTokens } from './token-format.ts'

/** Shared reported buckets for Run and Session usage; reasoning remains a subset of output. */
export function UsageFields({ totals, showModel = false }: { totals: UsageTotals; showModel?: boolean }) {
  const { t } = useI18n()
  const inputTotal = totals.reported.input + totals.reported.cacheRead + totals.reported.cacheWrite
  const cacheHit =
    (showModel ? totals.complete && totals.reported.cacheRead > 0 : true) && inputTotal > 0
      ? formatCacheHitPercent(totals.reported.cacheRead, inputTotal, 1)
      : null
  const routes = totals.models.map((model) => `${model.provider}/${model.model}`).join(', ')
  const bucket = (part: 'input' | 'cacheRead' | 'cacheWrite' | 'output') =>
    totals.known.includes(part) ? formatExactTokens(totals.reported[part]) : totals.reported[part] > 0 ? `≥ ${formatExactTokens(totals.reported[part])}` : '—'
  const row = (part: string, label: string, value: React.ReactNode) => (
    <React.Fragment key={part}>
      <dt>{label}</dt>
      <dd data-usage-part={part} className="min-w-0 text-right text-foreground tabular-nums">
        {value}
      </dd>
    </React.Fragment>
  )
  const incomplete = showModel
    ? !totals.known.includes('input') || !totals.known.includes('output')
    : (['input', 'cacheRead', 'cacheWrite', 'output'] as const).some((part) => !totals.known.includes(part))
  return (
    <>
      <dl data-turn-usage-details className="grid grid-cols-[minmax(76px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-muted-foreground">
        {showModel && routes !== '' && row('model', t('usage.details.model'), <span className="break-words [overflow-wrap:anywhere]">{routes}</span>)}
        {cacheHit !== null && row('cacheHit', t('usage.details.cacheHit'), `${cacheHit}%`)}
        {row('input', t('usage.details.input'), bucket('input'))}
        {totals.reported.cacheRead > 0 && row('cacheRead', t('usage.details.cacheRead'), bucket('cacheRead'))}
        {totals.reported.cacheWrite > 0 && row('cacheWrite', t('usage.details.cacheWrite'), bucket('cacheWrite'))}
        {row(
          'output',
          t('usage.details.output'),
          <>
            {bucket('output')}
            {totals.reasoning !== undefined && (
              <span data-usage-part="reasoning" className="whitespace-nowrap text-muted-foreground">
                {t('usage.details.reasoning', { tokens: formatExactTokens(totals.reasoning) })}
              </span>
            )}
          </>,
        )}
      </dl>
      {incomplete && <p className="mt-2 text-muted-foreground">{t('usage.details.incompleteNote')}</p>}
    </>
  )
}

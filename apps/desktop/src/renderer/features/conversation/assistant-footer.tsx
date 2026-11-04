import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@coko/ui'
import { DatabaseIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { CopyMessage } from './message-actions.tsx'
import { MessageTime } from './message-time.tsx'
import { assistantMarkdown } from './message-text.ts'
import type { DisplayRun } from './process-groups.ts'
import { sumUsage, totalTokens, type UsageTotals } from './session-cost.tsx'
import type { TimelineItem } from './timeline.ts'
import { useTimelineSession } from './timeline-session.tsx'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'

export interface RunFooter {
  runId: string
  text?: string
  endedAt?: number
  /** Copied history may display source-owned facts without attributing them to the target Session. */
  usageEntries?: readonly SessionEntry[]
}

export interface CompletedReply extends RunFooter {
  seq: number
  text: string
}

// Footer quantities have no pricing dependency; stand-alone child Session readers share the same counter.
export const withoutPricing = () => false

/** Abnormal and body-less endings keep the same factual usage entry, after their termination status. */
export function endedRunFooter(entries: readonly SessionEntry[], run?: DisplayRun): RunFooter | undefined {
  if (!run || run.status === 'running' || run.status === 'unknown') return
  const last = entries.findLast(
    (entry) => entry.runId === run.id && (run.endedSeq === undefined || entry.seq < run.endedSeq) && assistantMarkdown(entry).trim() !== '',
  )
  return { runId: run.id, text: last ? assistantMarkdown(last) : undefined, endedAt: run.status === 'interrupted' ? undefined : run.endedAt }
}

/** Completion and the last assistant message are persisted facts, independent of stop/length stage text. */
export function completedReplyFooters(
  items: TimelineItem[],
  entries: readonly SessionEntry[],
  runs?: ReadonlyMap<string, DisplayRun>,
): Map<string, CompletedReply> {
  const result = new Map<string, CompletedReply>()
  for (const run of runs?.values() ?? []) {
    if (run.status !== 'completed' || run.endedSeq === undefined) continue
    const last = entries.findLast(
      (entry) => entry.runId === run.id && entry.seq < run.endedSeq! && entry.kind === 'message' && entry.payload.role === 'assistant',
    )
    if (!last || last.kind !== 'message' || last.payload.role !== 'assistant' || !['stop', 'length'].includes(String(last.payload.stopReason))) continue
    const text = assistantMarkdown(last)
    if (!text.trim()) continue
    const seat = items.findLast((item) => item.kind === 'text' && !item.streaming && item.origin?.runId === run.id && item.origin.seq === last.seq)
    if (seat) result.set(seat.key, { runId: run.id, seq: last.seq, text, endedAt: run.endedAt })
  }
  return result
}

export function AssistantFooter({
  reply,
  latest,
  branchAction,
  totals: shared,
}: {
  reply: RunFooter
  latest: boolean
  branchAction?: React.ReactNode
  /** 由时间线一次性汇总；复制历史等独立来源省略时改按自身条目计算。 */
  totals?: UsageTotals
}) {
  const context = useTimelineSession()
  const ownEntries = reply.usageEntries
  const entries = ownEntries ?? context.entries
  // 复制历史用来源自带的条目，不能套用当前 Session 的同名 Run。
  const computed = React.useMemo(
    () => (shared && !ownEntries ? undefined : sumUsage(entries, withoutPricing, reply.runId)),
    [shared, ownEntries, entries, reply.runId],
  )
  const totals = ownEntries ? computed! : (shared ?? computed!)
  const [open, setOpen] = React.useState(false)
  return (
    <div
      data-slot="assistant-footer"
      data-run-id={reply.runId}
      data-tokens={totalTokens(totals.reported)}
      data-complete={totals.complete}
      data-latest={latest}
      data-open={open}
      className="conversation-assistant-actions flex min-w-0 items-center gap-2 transition-opacity"
    >
      <div data-slot="assistant-message-actions" className="conversation-message-actions flex min-w-0 items-center gap-2">
        {reply.text?.trim() && <CopyMessage text={reply.text} />}
        {branchAction}
        <UsageDetails totals={totals} open={open} onOpenChange={setOpen} />
      </div>
      <MessageTime timestamp={reply.endedAt} />
    </div>
  )
}

function UsageDetails({ totals, open, onOpenChange }: { totals: UsageTotals; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const trigger = React.useRef<HTMLButtonElement>(null)
  const total = totalTokens(totals.reported)
  const count = formatTokens(total, t('usage.compact.thousand'), t('usage.compact.million'))
  const inputTotal = totals.reported.input + totals.reported.cacheRead + totals.reported.cacheWrite
  const cacheHit = totals.complete && totals.reported.cacheRead > 0 && inputTotal > 0 ? formatCacheHitPercent(totals.reported.cacheRead, inputTotal, 1) : null
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
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="toolbar"
          size="sm"
          data-action="run-usage"
          aria-haspopup="dialog"
          className="h-[22px] min-w-0 shrink gap-2 px-1.5 text-ui-small tabular-nums"
        >
          <DatabaseIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{totals.hasUsage ? t('usage.consumed', { total: t('usage.count', { count }) }) : t('usage.unavailable')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        role="dialog"
        aria-label={t('usage.details.title')}
        data-slot="run-usage-details"
        className="max-h-(--radix-popover-content-available-height) w-max min-w-[min(300px,calc(100vw-24px))] max-w-[min(440px,calc(100vw-24px))] overflow-y-auto p-4 text-ui-small"
        onEscapeKeyDown={() => trigger.current?.focus()}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          event.detail.originalEvent.preventDefault()
          onOpenChange(false)
          trigger.current?.focus()
        }}
      >
        <div className="mb-2 flex justify-between gap-4 font-medium text-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <DatabaseIcon aria-hidden className="size-3.5 shrink-0" />
            {t('usage.details.title')}
          </span>
          <span data-usage-part="total" className="tabular-nums">
            {totals.hasUsage ? formatExactTokens(total) : '—'}
          </span>
        </div>
        <div aria-hidden className="mb-2.5 border-t-hairline border-border" />
        <dl data-turn-usage-details className="grid grid-cols-[minmax(76px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-muted-foreground">
          {routes !== '' && row('model', t('usage.details.model'), <span className="break-words [overflow-wrap:anywhere]">{routes}</span>)}
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
        {(!totals.known.includes('input') || !totals.known.includes('output')) && (
          <p className="mt-2 text-muted-foreground">{t('usage.details.incompleteNote')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { GaugeIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { CopyMessage } from './message-actions.tsx'
import { MessageTime } from './message-time.tsx'
import type { DisplayRun } from './process-groups.ts'
import { formatCount, sumUsage, totalTokens, type UsageTotals } from './session-cost.tsx'
import type { TimelineItem } from './timeline.ts'
import { useTimelineSession } from './timeline-session.tsx'

export interface CompletedReply {
  runId: string
  seq: number
  text: string
  endedAt?: number
}

// Footer quantities have no pricing dependency; stand-alone child Session readers share the same counter.
const withoutPricing = () => false

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
    const content = last.payload.content
    if (!Array.isArray(content)) continue
    const text = content.flatMap((block) => (block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : [])).join('\n\n')
    if (!text.trim()) continue
    const seat = items.findLast((item) => item.kind === 'text' && !item.streaming && item.origin?.runId === run.id && item.origin.seq === last.seq)
    if (seat) result.set(seat.key, { runId: run.id, seq: last.seq, text, endedAt: run.endedAt })
  }
  return result
}

export function AssistantFooter({ reply, latest, branchAction }: { reply: CompletedReply; latest: boolean; branchAction?: React.ReactNode }) {
  const { entries } = useTimelineSession()
  const totals = React.useMemo(() => sumUsage(entries, withoutPricing, reply.runId), [entries, reply.runId])
  const [open, setOpen] = React.useState(false)
  return (
    <div
      data-slot="assistant-footer"
      data-run-id={reply.runId}
      data-tokens={totalTokens(totals.reported)}
      className="conversation-assistant-actions flex min-w-0 items-center gap-2"
    >
      <div
        data-slot="assistant-message-actions"
        data-latest={latest}
        data-open={open}
        className="conversation-message-actions conversation-footer-controls flex min-w-0 items-center gap-2 transition-opacity"
      >
        <CopyMessage text={reply.text} />
        {branchAction}
        <UsageDetails totals={totals} open={open} onOpenChange={setOpen} />
      </div>
      <MessageTime timestamp={reply.endedAt} />
    </div>
  )
}

function UsageDetails({ totals, open, onOpenChange }: { totals: UsageTotals; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n()
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [tooltip, setTooltip] = React.useState(false)
  const tokens = totalTokens(totals.reported)
  const unit = tokens >= 1_000_000 ? 1_000_000 : tokens >= 1_000 ? 1_000 : 1
  const compact =
    new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(tokens / unit) +
    (unit === 1_000_000 ? 'M' : unit === 1_000 ? 'K' : '')
  const inputTotal = totals.reported.input + totals.reported.cacheRead + totals.reported.cacheWrite
  const ratio =
    totals.complete && inputTotal > 0
      ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(totals.reported.cacheRead / inputTotal)
      : undefined
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip open={!open && tooltip} onOpenChange={setTooltip}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              ref={trigger}
              variant="toolbar"
              size="sm"
              aria-label={t('usage.runRow')}
              data-action="run-usage"
              aria-haspopup="dialog"
              className="min-w-0 gap-1 text-ui-small tabular-nums"
            >
              <GaugeIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{totals.hasUsage ? t('usage.tokens', { count: compact }) : t('usage.unavailable')}</span>
              {!totals.complete && <span>{t('usage.incomplete')}</span>}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('usage.runRow')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        role="dialog"
        aria-label={t('usage.details.title')}
        data-slot="run-usage-details"
        className="max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width) overflow-y-auto text-ui-body"
        onEscapeKeyDown={() => trigger.current?.focus()}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          event.detail.originalEvent.preventDefault()
          onOpenChange(false)
          trigger.current?.focus()
        }}
      >
        <p className="mb-2 font-medium">{t('usage.details.title')}</p>
        {!totals.complete && <p className="mb-2 text-ui-small text-muted-foreground">{t('usage.details.incompleteNote')}</p>}
        <dl className="space-y-1 tabular-nums">
          <div data-usage-part="total" className="flex items-baseline justify-between gap-3 font-medium">
            <dt>{t(totals.complete ? 'usage.details.total' : 'usage.details.subtotal')}</dt>
            <dd>{totals.hasUsage ? formatCount(locale, totalTokens(totals.reported)) : '—'}</dd>
          </div>
          {(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map((part) => (
            <div key={part} data-usage-part={part} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{t(`usage.details.${part}`)}</dt>
              <dd>
                {totals.known.includes(part)
                  ? formatCount(locale, totals.reported[part])
                  : totals.reported[part] > 0
                    ? `≥ ${formatCount(locale, totals.reported[part])}`
                    : '—'}
              </dd>
            </div>
          ))}
          {totals.reasoning !== undefined && (
            <div data-usage-part="reasoning" className="flex items-baseline justify-between gap-3 text-ui-small">
              <dt className="text-muted-foreground">{t('usage.details.reasoning')}</dt>
              <dd>{formatCount(locale, totals.reasoning)}</dd>
            </div>
          )}
          {ratio !== undefined && (
            <div data-usage-part="cacheHit" className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{t('usage.details.cacheHit')}</dt>
              <dd>{ratio}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 mb-1 text-ui-small text-muted-foreground">{t('usage.details.models')}</p>
        {totals.models.length ? (
          <ul className="space-y-1 text-ui-small break-all">
            {totals.models.map((model) => (
              <li key={JSON.stringify(model)}>
                {model.provider} / {model.model}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui-small text-muted-foreground">{t('usage.details.unknownModel')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

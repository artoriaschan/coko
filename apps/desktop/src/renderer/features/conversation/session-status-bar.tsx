import type { SessionEntry } from '@coko/protocol'
import { Button, cn, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { DatabaseIcon } from 'lucide-react'
import * as React from 'react'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { sumUsage, totalTokens } from './session-cost.tsx'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { UsageFields } from './usage-fields.tsx'

const noEntries: SessionEntry[] = []
const withoutPricing = () => false

/** Persisted entries alone drive this row; streaming deltas never alter the counters. */
export function SessionStatusBar({ sessionId, className }: { sessionId: string; className?: string }) {
  const { t } = useI18n()
  const entries = useChat((state) => state.conversations[sessionId]?.entries ?? noEntries)
  const totals = React.useMemo(() => sumUsage(entries, withoutPricing), [entries])
  const [open, setOpen] = React.useState<'tokens' | null>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const text = React.useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [tooltipOpen, setTooltipOpen] = React.useState(false)
  const total = totalTokens(totals.reported)
  const compact = formatTokens(total, t('usage.compact.thousand'), t('usage.compact.million'))
  const input = totals.reported.input + totals.reported.cacheRead + totals.reported.cacheWrite
  const cacheHit = formatCacheHitPercent(totals.reported.cacheRead, input, 0)
  const suffix = cacheHit === null ? '' : ` · ${t('usage.status.cacheHit', { percent: cacheHit })}`
  const reading = `${t('usage.count', { count: compact })}${suffix}`
  const label = t('usage.status.label', { count: `${t('usage.count', { count: formatExactTokens(total) })}${suffix}` })
  React.useLayoutEffect(() => {
    const node = text.current
    if (!node) return
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [reading, totals.hasUsage])
  return (
    <div
      data-slot="session-status-bar"
      className={cn('mt-1 flex h-[22px] min-w-0 items-center justify-center gap-3 text-ui-small text-muted-foreground', className)}
    >
      {totals.hasUsage && (
        <Popover open={open === 'tokens'} onOpenChange={(next) => setOpen(next ? 'tokens' : null)}>
          <Tooltip open={truncated && open !== 'tokens' && tooltipOpen} onOpenChange={setTooltipOpen}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  ref={trigger}
                  variant="toolbar"
                  size="sm"
                  aria-label={label}
                  aria-haspopup="dialog"
                  data-action="session-token-usage"
                  data-tokens={total}
                  className="h-[22px] min-w-0 shrink gap-1.5 px-1.5 text-ui-small font-normal tabular-nums data-[state=open]:bg-accent"
                >
                  <DatabaseIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1} />
                  <span ref={text} className="min-w-0 truncate">
                    {reading}
                  </span>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            role="dialog"
            aria-label={t('usage.status.title')}
            data-slot="session-token-details"
            className="max-h-(--radix-popover-content-available-height) w-max min-w-[min(300px,calc(100vw-24px))] max-w-[min(440px,calc(100vw-24px))] overflow-y-auto p-4 text-ui-small"
            onEscapeKeyDown={() => trigger.current?.focus()}
            onPointerDownOutside={(event) => {
              event.preventDefault()
              event.detail.originalEvent.preventDefault()
              setOpen(null)
              trigger.current?.focus()
            }}
          >
            <div className="mb-2 flex justify-between gap-4 font-medium text-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <DatabaseIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1} />
                {t('usage.status.title')}
              </span>
              <span data-usage-part="total" className="tabular-nums">
                {formatExactTokens(total)}
              </span>
            </div>
            <div aria-hidden className="mb-2.5 border-t-hairline border-border" />
            <UsageFields totals={totals} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

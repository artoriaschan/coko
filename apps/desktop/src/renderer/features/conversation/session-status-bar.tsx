import type { SessionEntry } from '@coko/protocol'
import { Button, cn, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { DatabaseIcon, GaugeIcon, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { sumUsage, totalTokens } from './session-cost.tsx'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { UsageFields } from './usage-fields.tsx'
import { formatStatisticsDuration, formatStatisticsSpeed, sessionStatistics } from './session-statistics.ts'

const noEntries: SessionEntry[] = []
const withoutPricing = () => false

function StatusCapsule({
  kind,
  reading,
  label,
  title,
  Icon,
  open,
  onOpenChange,
  children,
  total,
}: {
  kind: 'tokens' | 'statistics'
  reading: string
  label: string
  title: string
  Icon: LucideIcon
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  total?: number
}) {
  const trigger = React.useRef<HTMLButtonElement>(null)
  const text = React.useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [tooltipOpen, setTooltipOpen] = React.useState(false)
  React.useLayoutEffect(() => {
    const node = text.current
    if (!node) return
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [reading])
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip open={truncated && !open && tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              ref={trigger}
              variant="toolbar"
              size="sm"
              aria-label={label}
              aria-haspopup="dialog"
              data-action={kind === 'tokens' ? 'session-token-usage' : 'session-statistics'}
              data-session-status-trigger={kind}
              data-tokens={total}
              className="h-[22px] min-w-0 shrink gap-1.5 px-1.5 text-ui-small font-normal tabular-nums data-[state=open]:bg-accent"
            >
              <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1} />
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
        aria-label={title}
        data-slot={kind === 'tokens' ? 'session-token-details' : 'session-statistics-details'}
        className="max-h-(--radix-popover-content-available-height) w-max min-w-[min(300px,calc(100vw-24px))] max-w-[min(440px,calc(100vw-24px))] overflow-y-auto p-4 text-ui-small"
        onEscapeKeyDown={() => trigger.current?.focus()}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          const target = event.detail.originalEvent.target
          if (target instanceof Element && target.closest('[data-session-status-trigger]')) return
          event.detail.originalEvent.preventDefault()
          onOpenChange(false)
          trigger.current?.focus()
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

function CardHeading({ Icon, title, children }: { Icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="mb-2 flex justify-between gap-4 font-medium text-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1} />
          {title}
        </span>
        {children}
      </div>
      <div aria-hidden className="mb-2.5 border-t-hairline border-border" />
    </>
  )
}

/** Persisted entries alone drive this row; streaming deltas never alter the counters. */
export function SessionStatusBar({ sessionId, className }: { sessionId: string; className?: string }) {
  const { t } = useI18n()
  const entries = useChat((state) => state.conversations[sessionId]?.entries ?? noEntries)
  const totals = React.useMemo(() => sumUsage(entries, withoutPricing), [entries])
  const statistics = React.useMemo(() => sessionStatistics(entries), [entries])
  const [open, setOpen] = React.useState<'tokens' | 'statistics' | null>(null)
  const show = (kind: 'tokens' | 'statistics') => (next: boolean) => setOpen((current) => (next ? kind : current === kind ? null : current))
  const total = totalTokens(totals.reported)
  const compact = formatTokens(total, t('usage.compact.thousand'), t('usage.compact.million'))
  const input = totals.reported.input + totals.reported.cacheRead + totals.reported.cacheWrite
  const cacheHit = formatCacheHitPercent(totals.reported.cacheRead, input, 0)
  const suffix = cacheHit === null ? '' : ` · ${t('usage.status.cacheHit', { percent: cacheHit })}`
  const reading = `${t('usage.count', { count: compact })}${suffix}`
  const label = t('usage.status.label', { count: `${t('usage.count', { count: formatExactTokens(total) })}${suffix}` })
  const counts = t('usage.statistics.counts', { rounds: statistics.rounds, steps: statistics.steps })
  const rate = statistics.tokensPerSecond ? t('usage.statistics.rate', { value: formatStatisticsSpeed(statistics.tokensPerSecond) }) : undefined
  const statsReading = `${counts}${rate ? ` · ${rate}` : ''}`
  const rows = [
    { label: t('usage.statistics.modelTime'), value: statistics.modelMs > 0 ? formatStatisticsDuration(statistics.modelMs, t) : undefined },
    { label: t('usage.statistics.toolTime'), value: statistics.toolMs > 0 ? formatStatisticsDuration(statistics.toolMs, t) : undefined },
    { label: t('usage.statistics.ttft'), value: statistics.ttftMs ? formatStatisticsDuration(statistics.ttftMs, t) : undefined },
    { label: t('usage.statistics.speed'), value: rate },
  ]
  return (
    <div
      data-slot="session-status-bar"
      className={cn('mt-1 flex h-[22px] min-w-0 items-center justify-center gap-3 text-ui-small text-muted-foreground', className)}
    >
      {statistics.steps > 0 && (
        <StatusCapsule
          kind="statistics"
          reading={statsReading}
          label={t('usage.statistics.label', { reading: statsReading })}
          title={t('usage.statistics.title')}
          Icon={GaugeIcon}
          open={open === 'statistics'}
          onOpenChange={show('statistics')}
        >
          <CardHeading Icon={GaugeIcon} title={t('usage.statistics.title')}>
            <span className="tabular-nums">{counts}</span>
          </CardHeading>
          <dl className="space-y-1.5">
            {rows
              .filter((row) => row.value !== undefined)
              .map((row) => (
                <div key={row.label} className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="tabular-nums text-foreground">{row.value}</dd>
                </div>
              ))}
          </dl>
        </StatusCapsule>
      )}
      {totals.hasUsage && (
        <StatusCapsule
          kind="tokens"
          reading={reading}
          label={label}
          title={t('usage.status.title')}
          Icon={DatabaseIcon}
          open={open === 'tokens'}
          onOpenChange={show('tokens')}
          total={total}
        >
          <CardHeading Icon={DatabaseIcon} title={t('usage.status.title')}>
            <span data-usage-part="total" className="tabular-nums">
              {formatExactTokens(total)}
            </span>
          </CardHeading>
          <UsageFields totals={totals} />
        </StatusCapsule>
      )}
    </div>
  )
}

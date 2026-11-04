import { Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { useI18n } from '../../app/i18n.tsx'

/** Persisted submission/Run-end time; absent historical facts never become the viewing time. */
export function MessageTime({ timestamp }: { timestamp: number | undefined }) {
  const { locale } = useI18n()
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  const full = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={date.toISOString()} aria-label={full} tabIndex={0} className="shrink-0 rounded-sm text-ui-small text-muted-foreground focus-ring">
          {clock}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top">{full}</TooltipContent>
    </Tooltip>
  )
}

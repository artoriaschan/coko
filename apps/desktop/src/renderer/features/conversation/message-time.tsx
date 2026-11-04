import * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { useI18n } from '../../app/i18n.tsx'
import { formatMessageClock, msUntilNextLocalMidnight, startOfLocalDay } from './message-clock.ts'

/** 本地日历日：跨过本地午夜后推进，让同日的时间标签长成带日期的标签。 */
function useCalendarDay(): number {
  const [day, setDay] = React.useState(() => startOfLocalDay(Date.now()))
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      const now = Date.now()
      setDay(startOfLocalDay(now))
      timer = setTimeout(arm, msUntilNextLocalMidnight(now))
    }
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()))
    return () => clearTimeout(timer)
  }, [])
  return day
}

/** Persisted submission/Run-end time; absent historical facts never become the viewing time. */
export function MessageTime({ timestamp }: { timestamp: number | undefined }) {
  const { t, locale } = useI18n()
  const day = useCalendarDay()
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const label = formatMessageClock(timestamp, t, day)
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
          {label}
        </time>
      </TooltipTrigger>
      <TooltipContent side="bottom">{full}</TooltipContent>
    </Tooltip>
  )
}

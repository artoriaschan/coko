import type { Translator } from '@coko/i18n'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地日历日的起点（本地午夜毫秒）。 */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 距下一个本地午夜还有多少毫秒，至少 1ms。 */
export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/**
 * 消息时间的紧凑本地标签：同一本地日只显示 24 小时 `HH:mm`；同年更早日期前加月日；
 * 往年再带年份。`now` 是判断日期的参照时刻，由调用方在本地午夜推进。
 */
export function formatMessageClock(timestamp: number, t: Translator, now: number): string {
  const date = new Date(timestamp)
  const reference = new Date(now)
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const params = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
  if (date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth() && date.getDate() === reference.getDate()) {
    return clock
  }
  return `${t(date.getFullYear() === reference.getFullYear() ? 'conversation.clockMonthDay' : 'conversation.clockYearMonthDay', params)} ${clock}`
}

// cron 表达式（ADR 0015）：五段 Vixie（分 时 日 月 周），每段 `*`、值、`a-b`、`*/n`、`a-b/n` 与逗号列表；周 0–7（0 与 7 为周日）。
// 日与周都不是 `*` 时任一匹配即可。下次时间按 IANA 时区的本地时刻计算：不存在的本地时刻（夏令时开始）跳过，重复的本地时刻
// （夏令时结束）只取较早的一次。只用 Intl，不依赖时区库。

/** 解析失败：message 指出哪一段与原因。 */
export class CronError extends Error {
  override readonly name = 'CronError'
}

interface Field {
  name: string
  min: number
  max: number
}

const FIELDS: readonly Field[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
]

/** 解析后的表达式：每段允许的值集合；dayOfMonthAny / dayOfWeekAny 为该段是否恰为 `*`（决定日与周是"且"还是"任一"）。 */
export interface CronSchedule {
  expression: string
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  daysOfMonth: ReadonlySet<number>
  months: ReadonlySet<number>
  /** 0–6（7 已归一为 0）。 */
  daysOfWeek: ReadonlySet<number>
  dayOfMonthAny: boolean
  dayOfWeekAny: boolean
}

const INTEGER = /^\d+$/

function value(text: string, field: Field): number {
  if (!INTEGER.test(text)) throw new CronError(`Invalid ${field.name} value "${text}": only numbers are supported`)
  const n = Number(text)
  if (n < field.min || n > field.max) throw new CronError(`${field.name} value ${n} is outside ${field.min}-${field.max}`)
  return n
}

function parseField(text: string, field: Field): Set<number> {
  const out = new Set<number>()
  for (const item of text.split(',')) {
    if (item === '') throw new CronError(`Empty item in the ${field.name} field "${text}"`)
    const [base, stepText, extra] = item.split('/')
    if (extra !== undefined) throw new CronError(`Invalid ${field.name} item "${item}"`)
    let low: number
    let high: number
    if (base === '*') {
      low = field.min
      high = field.max
    } else if (base!.includes('-')) {
      const [a, b, more] = base!.split('-')
      if (more !== undefined || a === undefined || b === undefined) throw new CronError(`Invalid ${field.name} range "${base}"`)
      low = value(a, field)
      high = value(b, field)
      if (low > high) throw new CronError(`Invalid ${field.name} range "${base}": start is after end`)
    } else {
      // 单个值不能带步长（"5/10" 在 Vixie cron 中无效）。
      if (stepText !== undefined) throw new CronError(`Invalid ${field.name} item "${item}": a step needs * or a range`)
      out.add(value(base!, field))
      continue
    }
    let step = 1
    if (stepText !== undefined) {
      if (!INTEGER.test(stepText) || Number(stepText) < 1) throw new CronError(`Invalid ${field.name} step "${stepText}"`)
      step = Number(stepText)
    }
    for (let n = low; n <= high; n += step) out.add(n)
  }
  return out
}

/** 解析五段表达式（段之间任意空白）；不合语法时抛 CronError。 */
export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5 || parts[0] === '')
    throw new CronError(`A cron expression has 5 fields (minute hour day-of-month month day-of-week); got ${parts[0] === '' ? 0 : parts.length}`)
  const [minutes, hours, daysOfMonth, months, rawWeek] = parts.map((part, i) => parseField(part, FIELDS[i]!))
  const daysOfWeek = new Set([...rawWeek!].map((d) => d % 7))
  const schedule: CronSchedule = {
    expression: parts.join(' '),
    minutes: minutes!,
    hours: hours!,
    daysOfMonth: daysOfMonth!,
    months: months!,
    daysOfWeek,
    dayOfMonthAny: parts[2] === '*',
    dayOfWeekAny: parts[4] === '*',
  }
  // 日期组合在任何年份都不存在（例如 2 月 30 日且周为 *）：没有下一次。
  if (schedule.dayOfWeekAny && ![...schedule.months].some((m) => [...schedule.daysOfMonth].some((d) => d <= MONTH_MAX_DAYS[m - 1]!)))
    throw new CronError(`The cron expression "${schedule.expression}" never matches a date`)
  return schedule
}

/** 各月最多的天数（闰年的 2 月为 29）。 */
const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// ---- 时区 ----

/** IANA 名（Area/Location，可多段）或 UTC；偏移写法（+08:00）与缩写（EST）不接受。 */
const ZONE_NAME = /^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** 时区是否为可用的 IANA 名或 UTC。 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!ZONE_NAME.test(timeZone)) return false
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

/** 本地时刻（按分钟）。 */
interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function wallAt(at: number, timeZone: string): Wall {
  const parts: Record<string, number> = {}
  for (const part of formatter(timeZone).formatToParts(at)) if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! }
}

/** 本地时刻按 UTC 解释的毫秒数（只用于比较与求偏移）。 */
const naive = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)

/** 该时刻的 UTC 偏移（毫秒，按分钟取整）。 */
const offsetAt = (at: number, timeZone: string) => naive(wallAt(at, timeZone)) - Math.floor(at / 60_000) * 60_000

const HOUR = 3_600_000

/**
 * 本地时刻对应的 UTC 时刻（升序）：一般一个；不存在（夏令时开始）时为空；重复（夏令时结束）时两个。偏移在本地时刻前后一天各取一次
 * （本地时刻按 UTC 解释与真实时刻相差可达十几小时），再取各候选时刻处的偏移；只保留换算回来正是该本地时刻的候选。
 */
function instantsOf(w: Wall, timeZone: string): number[] {
  const local = naive(w)
  const probes = new Set([offsetAt(local - 24 * HOUR, timeZone), offsetAt(local, timeZone), offsetAt(local + 24 * HOUR, timeZone)])
  const offsets = new Set(probes)
  for (const offset of probes) offsets.add(offsetAt(local - offset, timeZone))
  const out = new Set<number>()
  for (const offset of offsets) {
    const candidate = local - offset
    if (naive(wallAt(candidate, timeZone)) === local) out.add(candidate)
  }
  return [...out].sort((a, b) => a - b)
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const weekday = (w: Wall) => new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()

function dayMatches(schedule: CronSchedule, w: Wall): boolean {
  const dom = schedule.daysOfMonth.has(w.day)
  const dow = schedule.daysOfWeek.has(weekday(w))
  if (schedule.dayOfMonthAny && schedule.dayOfWeekAny) return true
  if (schedule.dayOfMonthAny) return dow
  if (schedule.dayOfWeekAny) return dom
  // 日与周都不是 *：任一匹配即可（Vixie cron）。
  return dom || dow
}

/** 下次时间的搜索上限：本地日历上 8 年（覆盖 2 月 29 日等稀疏的日期）。 */
const SEARCH_YEARS = 8

/**
 * 严格晚于 after（UTC 毫秒）的下一个发生时刻；在时区的本地日历上逐日、逐时、逐分推进，每个匹配的本地时刻换算为 UTC：不存在的跳过，
 * 重复的只认较早的一次（较晚的一次即使晚于 after 也不算）。搜索上限内没有时 undefined。
 */
export function nextCronTime(schedule: CronSchedule, timeZone: string, after: number): number | undefined {
  const start = wallAt(after, timeZone)
  const limit = start.year + SEARCH_YEARS
  // 从 after 所在的本地分钟开始（重复的那一小时中 after 可能在较晚的一次，候选仍要检查较早的一次与 after 的先后）。
  let w: Wall = { ...start }
  while (w.year <= limit) {
    if (!schedule.months.has(w.month)) {
      w = w.month === 12 ? { year: w.year + 1, month: 1, day: 1, hour: 0, minute: 0 } : { year: w.year, month: w.month + 1, day: 1, hour: 0, minute: 0 }
      continue
    }
    if (!dayMatches(schedule, w)) {
      w = nextDay(w)
      continue
    }
    if (!schedule.hours.has(w.hour)) {
      w = w.hour === 23 ? nextDay(w) : { ...w, hour: w.hour + 1, minute: 0 }
      continue
    }
    if (schedule.minutes.has(w.minute)) {
      const [earliest] = instantsOf(w, timeZone)
      if (earliest !== undefined && earliest > after) return earliest
    }
    w = w.minute === 59 ? (w.hour === 23 ? nextDay(w) : { ...w, hour: w.hour + 1, minute: 0 }) : { ...w, minute: w.minute + 1 }
  }
  return undefined
}

function nextDay(w: Wall): Wall {
  if (w.day < daysInMonth(w.year, w.month)) return { year: w.year, month: w.month, day: w.day + 1, hour: 0, minute: 0 }
  return w.month === 12 ? { year: w.year + 1, month: 1, day: 1, hour: 0, minute: 0 } : { year: w.year, month: w.month + 1, day: 1, hour: 0, minute: 0 }
}

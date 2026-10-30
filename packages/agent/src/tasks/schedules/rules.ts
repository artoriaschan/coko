// 定时任务的规则（ADR 0015）：校验、首次与下次时间、补跑计算。时间都是 UTC 毫秒；cron 的本地时刻见 cron.ts。
import { CronError, isValidTimeZone, nextCronTime, parseCron } from './cron.ts'

/** 与协议的 ScheduleRule 相同的形状（agent 不依赖 protocol）。 */
export type ScheduleRuleSpec =
  | { kind: 'after'; seconds: number }
  | { kind: 'at'; at: string }
  | { kind: 'every'; seconds: number }
  | { kind: 'cron'; expression: string; timeZone: string }

/** 间隔的下限（秒）与 prompt、title 的上限（字符）；与协议的常量相同。 */
export const SCHEDULE_MIN_EVERY_SECONDS = 60
export const SCHEDULE_TITLE_MAX_CHARS = 120
export const SCHEDULE_PROMPT_MAX_CHARS = 8000
/** 每 Session 的 active 任务上限。 */
export const SCHEDULE_MAX_ACTIVE = 20

/** 规则不合要求（工具与 HTTP 都以它的 message 报错）。 */
export class ScheduleRuleError extends Error {
  override readonly name = 'ScheduleRuleError'
}

/** RFC 3339：日期、时刻（可带小数秒）与 Z 或 ±hh:mm 偏移；不带偏移的本地时刻不接受。 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/

/** at 规则的时刻（UTC 毫秒）；格式不对时抛 ScheduleRuleError。 */
export function parseAt(at: string): number {
  if (!RFC3339.test(at)) throw new ScheduleRuleError(`"${at}" is not an RFC 3339 date-time with an offset (for example 2026-11-01T09:00:00+08:00)`)
  const time = Date.parse(at.replace(' ', 'T'))
  if (!Number.isFinite(time)) throw new ScheduleRuleError(`"${at}" is not a valid date-time`)
  return time
}

/**
 * 校验规则并返回规范形状（cron 的空白归一）。at 须晚于 now；every ≥ 60 秒；after ≥ 1 秒；cron 的时区须为 IANA 名或 UTC。
 * 不合要求时抛 ScheduleRuleError。
 */
export function validateRule(rule: ScheduleRuleSpec, now: number): ScheduleRuleSpec {
  switch (rule.kind) {
    case 'after':
      if (!Number.isInteger(rule.seconds) || rule.seconds < 1) throw new ScheduleRuleError('after_seconds must be a positive integer')
      return { kind: 'after', seconds: rule.seconds }
    case 'every':
      if (!Number.isInteger(rule.seconds) || rule.seconds < SCHEDULE_MIN_EVERY_SECONDS)
        throw new ScheduleRuleError(`every_seconds must be an integer of at least ${SCHEDULE_MIN_EVERY_SECONDS}`)
      return { kind: 'every', seconds: rule.seconds }
    case 'at': {
      const time = parseAt(rule.at)
      if (time <= now) throw new ScheduleRuleError(`"${rule.at}" is not in the future`)
      return { kind: 'at', at: rule.at }
    }
    case 'cron': {
      if (!isValidTimeZone(rule.timeZone)) throw new ScheduleRuleError(`"${rule.timeZone}" is not an IANA time zone name or UTC`)
      try {
        return { kind: 'cron', expression: parseCron(rule.expression).expression, timeZone: rule.timeZone }
      } catch (error) {
        if (error instanceof CronError) throw new ScheduleRuleError(error.message)
        throw error
      }
    }
  }
}

/**
 * 严格晚于 after 的下一个发生时刻；anchor 为一次性规则（after）与间隔规则（every）的起点：after 为 anchor + seconds，every 为
 * anchor + k × seconds（k ≥ 1，按起点对齐）。一次性规则在 after 之后没有时 undefined。
 */
export function nextOccurrence(rule: ScheduleRuleSpec, anchor: number, after: number): number | undefined {
  switch (rule.kind) {
    case 'after': {
      const at = anchor + rule.seconds * 1000
      return at > after ? at : undefined
    }
    case 'at': {
      const at = parseAt(rule.at)
      return at > after ? at : undefined
    }
    case 'every': {
      const period = rule.seconds * 1000
      const k = Math.max(1, Math.floor((after - anchor) / period) + 1)
      return anchor + k * period
    }
    case 'cron':
      return nextCronTime(parseCron(rule.expression), rule.timeZone, after)
  }
}

/** 一次性规则（after、at）：投递后不再到期。 */
export const isOneShot = (rule: ScheduleRuleSpec) => rule.kind === 'after' || rule.kind === 'at'

/** 补跑时逐个计数的上限；超出时 missed 按此封顶（只投递最近一次的结论不变）。 */
export const CATCH_UP_COUNT_MAX = 10_000

export interface CatchUp {
  /** 本次投递的发生时刻：不晚于 now 的最近一次。 */
  occurrence: number
  /** 合并掉的更早的发生次数（不含本次）。 */
  missed: number
  /** 下一次（严格晚于 now）；一次性规则为 null。 */
  nextAt: number | null
}

/**
 * 到期（due ≤ now）时的补跑：从 due 起到 now 的全部发生次只投递最近一次，其余计入 missed；下一次为严格晚于 now 的发生时刻。
 * due 晚于 now 时 undefined（还没到期）。
 */
export function catchUp(rule: ScheduleRuleSpec, anchor: number, due: number, now: number): CatchUp | undefined {
  if (due > now) return undefined
  if (isOneShot(rule)) return { occurrence: due, missed: 0, nextAt: null }
  if (rule.kind === 'every') {
    const period = rule.seconds * 1000
    const latest = anchor + Math.floor((now - anchor) / period) * period
    const occurrence = Math.max(latest, due)
    return { occurrence, missed: Math.round((occurrence - due) / period), nextAt: occurrence + period }
  }
  let occurrence = due
  let missed = 0
  for (;;) {
    const next = nextOccurrence(rule, anchor, occurrence)
    if (next === undefined || next > now) return { occurrence, missed, nextAt: next ?? null }
    occurrence = next
    missed++
    if (missed >= CATCH_UP_COUNT_MAX) {
      // 计数封顶：直接找不晚于 now 的最近一次（从 now 往前一天起找，取最后一个）。
      let latest = occurrence
      for (let probe = nextOccurrence(rule, anchor, Math.max(occurrence, now - 86_400_000)); probe !== undefined && probe <= now;) {
        latest = probe
        probe = nextOccurrence(rule, anchor, probe)
      }
      const after = nextOccurrence(rule, anchor, now)
      return { occurrence: latest, missed, nextAt: after ?? null }
    }
  }
}

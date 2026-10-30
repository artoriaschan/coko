// 定时任务的工具（ADR 0015）：schedule_create、schedule_list、schedule_update、schedule_delete，只作用于本 Session 的任务（宿主经 SchedulesPort
// 提供）。权限类由宿主注册时给出：schedule_create / schedule_update 为 automation（规则组名 Schedule，只有 full-access 放行），schedule_list
// 为 context-read，schedule_delete 为 session-state。定时任务触发的 Run 与子 Session 中不能创建或修改任务（schedulesAllowed）。
import { Type, type Static } from 'typebox'
import type { CokoTool } from '../../tools/types.ts'
import { SCHEDULE_PROMPT_MAX_CHARS, SCHEDULE_TITLE_MAX_CHARS, ScheduleRuleError, type ScheduleRuleSpec } from './rules.ts'

export type ScheduleViewStatus = 'active' | 'paused' | 'inactive'

/** 工具结果中的任务快照。 */
export interface ScheduleView {
  id: string
  title: string
  prompt: string
  rule: ScheduleRuleSpec
  status: ScheduleViewStatus
  /** 下次到期（UTC 毫秒）；inactive 或暂停的一次性任务没有。 */
  nextAt?: number
  lastOccurrence?: number
}

/** 本 Session 的任务（宿主实现）。失败时抛出 Error，message 作为工具的错误结果。 */
export interface SchedulesPort {
  create(input: { title: string; prompt: string; rule: ScheduleRuleSpec }): Promise<ScheduleView>
  list(): Promise<ScheduleView[]>
  update(input: { id: string; title?: string; prompt?: string; rule?: ScheduleRuleSpec; status?: 'active' | 'paused' }): Promise<ScheduleView>
  delete(id: string): Promise<void>
}

/** 定时任务触发的 Run 与子 Session 中调用 schedule_create / schedule_update（错误结果以 schedule-not-allowed 开头）。 */
export class ScheduleNotAllowedError extends Error {
  override readonly name = 'ScheduleNotAllowedError'
  constructor(reason: 'scheduled-run' | 'child-session') {
    super(
      reason === 'scheduled-run'
        ? 'schedule-not-allowed: a run started by a scheduled task cannot create or change scheduled tasks'
        : 'schedule-not-allowed: a subagent session cannot create or change scheduled tasks',
    )
  }
}

interface EntryLike {
  kind: string
  payload: unknown
}

/**
 * 进行中的 Run 能否创建或修改定时任务：子 Session 不能；最后一个未结束的 Run 由定时任务触发（run_start.trigger 为 schedule）时不能。
 * 判定只看宿主写入的 run_start，Run 中送达的文本（含伪造的 <scheduled_task>）不改变结果。
 */
export function schedulesAllowed(
  entries: readonly EntryLike[],
  options: { childSession: boolean },
): { allowed: true } | { allowed: false; error: ScheduleNotAllowedError } {
  if (options.childSession) return { allowed: false, error: new ScheduleNotAllowedError('child-session') }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'run_end') break
    if (entry.kind === 'run_start') {
      if ((entry.payload as { trigger?: string }).trigger === 'schedule') return { allowed: false, error: new ScheduleNotAllowedError('scheduled-run') }
      break
    }
  }
  return { allowed: true }
}

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const SCHEDULED_TASK_TAG = 'scheduled_task'

/** 定时任务 Run 的输入文本：prompt 原文（不经命令展开）包在 <scheduled_task> 中；属性值转义。 */
export function scheduledTaskText(schedule: { id: string; title: string; prompt: string }, occurrence: number): string {
  const attributes = `schedule-id="${escapeAttribute(schedule.id)}" title="${escapeAttribute(schedule.title)}" occurrence="${new Date(occurrence).toISOString()}"`
  return `<${SCHEDULED_TASK_TAG} ${attributes}>${schedule.prompt}</${SCHEDULED_TASK_TAG}>`
}

/** 规则的一行描述（工具结果与日志）。 */
export function describeRule(rule: ScheduleRuleSpec): string {
  switch (rule.kind) {
    case 'after':
      return `once after ${rule.seconds} s`
    case 'at':
      return `once at ${rule.at}`
    case 'every':
      return `every ${rule.seconds} s`
    case 'cron':
      return `cron "${rule.expression}" (${rule.timeZone})`
  }
}

/** 一行快照："<id> [<status>] <title> — <规则>; next <ISO>"。 */
export function scheduleLine(view: ScheduleView): string {
  const next = view.nextAt === undefined ? '' : `; next ${new Date(view.nextAt).toISOString()}`
  return `${view.id} [${view.status}] ${view.title} — ${describeRule(view.rule)}${next}`
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined })

const ruleFields = {
  after_seconds: Type.Optional(Type.Integer({ minimum: 1, description: 'Run once, this many seconds from now' })),
  at: Type.Optional(Type.String({ minLength: 1, description: 'Run once at this RFC 3339 date-time with an offset, e.g. 2026-11-01T09:00:00+08:00' })),
  every_seconds: Type.Optional(Type.Integer({ minimum: 60, description: 'Run repeatedly at this interval (at least 60)' })),
  cron: Type.Optional(Type.String({ minLength: 1, description: 'Five-field cron expression: minute hour day-of-month month day-of-week' })),
  time_zone: Type.Optional(Type.String({ minLength: 1, description: 'IANA time zone for cron, e.g. Asia/Shanghai or UTC (required with cron)' })),
}

type RuleArgs = { after_seconds?: number; at?: string; every_seconds?: number; cron?: string; time_zone?: string }

/** 参数中的规则：恰好一个（required 时）或至多一个；time_zone 只与 cron 一起给出且 cron 必须带它。 */
export function ruleFromArgs(args: RuleArgs, required: boolean): ScheduleRuleSpec | undefined {
  const given = (['after_seconds', 'at', 'every_seconds', 'cron'] as const).filter((key) => args[key] !== undefined)
  if (given.length > 1) throw new ScheduleRuleError(`Give only one of after_seconds, at, every_seconds or cron (got ${given.join(', ')})`)
  if (args.time_zone !== undefined && args.cron === undefined) throw new ScheduleRuleError('time_zone is only used with cron')
  if (given.length === 0) {
    if (required) throw new ScheduleRuleError('Give exactly one of after_seconds, at, every_seconds or cron')
    return undefined
  }
  if (args.after_seconds !== undefined) return { kind: 'after', seconds: args.after_seconds }
  if (args.at !== undefined) return { kind: 'at', at: args.at }
  if (args.every_seconds !== undefined) return { kind: 'every', seconds: args.every_seconds }
  if (args.time_zone === undefined) throw new ScheduleRuleError('cron needs time_zone (an IANA name such as Asia/Shanghai, or UTC)')
  return { kind: 'cron', expression: args.cron!, timeZone: args.time_zone }
}

export const scheduleCreateParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX_CHARS, description: 'Short title' }),
  prompt: Type.String({ minLength: 1, maxLength: SCHEDULE_PROMPT_MAX_CHARS, description: 'Instructions delivered to this session when the task is due' }),
  ...ruleFields,
})
export type ScheduleCreateArgs = Static<typeof scheduleCreateParameters>

export function createScheduleCreateTool(port: SchedulesPort): CokoTool<typeof scheduleCreateParameters, undefined> {
  return {
    name: 'schedule_create',
    label: 'schedule_create',
    description:
      'Schedule a prompt to be sent to this session later: exactly one of after_seconds, at, every_seconds or cron (+ time_zone). ' +
      'Missed runs while the app is closed are caught up once.',
    parameters: scheduleCreateParameters,
    effect: 'side-effect',
    async execute(_id, args) {
      const rule = ruleFromArgs(args, true)!
      const view = await port.create({ title: args.title, prompt: args.prompt, rule })
      return text('Scheduled ' + scheduleLine(view))
    },
  }
}

export const scheduleListParameters = Type.Object({})

export function createScheduleListTool(port: SchedulesPort): CokoTool<typeof scheduleListParameters, undefined> {
  return {
    name: 'schedule_list',
    label: 'schedule_list',
    description: 'List the scheduled tasks of this session, one per line.',
    parameters: scheduleListParameters,
    effect: 'read',
    async execute() {
      const views = await port.list()
      return text(views.length === 0 ? 'No scheduled tasks.' : views.map(scheduleLine).join('\n'))
    },
  }
}

export const scheduleUpdateParameters = Type.Object({
  id: Type.String({ minLength: 1, description: 'Scheduled task id' }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX_CHARS })),
  prompt: Type.Optional(Type.String({ minLength: 1, maxLength: SCHEDULE_PROMPT_MAX_CHARS })),
  ...ruleFields,
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused')], { description: 'Pause or resume' })),
})
export type ScheduleUpdateArgs = Static<typeof scheduleUpdateParameters>

export function createScheduleUpdateTool(port: SchedulesPort): CokoTool<typeof scheduleUpdateParameters, undefined> {
  return {
    name: 'schedule_update',
    label: 'schedule_update',
    description: 'Change, pause (status: paused) or resume (status: active) a scheduled task of this session. A new rule replaces the old one.',
    parameters: scheduleUpdateParameters,
    effect: 'side-effect',
    async execute(_id, args) {
      const rule = ruleFromArgs(args, false)
      const view = await port.update({
        id: args.id,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(rule ? { rule } : {}),
        ...(args.status === undefined ? {} : { status: args.status }),
      })
      return text('Updated ' + scheduleLine(view))
    },
  }
}

export const scheduleDeleteParameters = Type.Object({ id: Type.String({ minLength: 1, description: 'Scheduled task id' }) })

export function createScheduleDeleteTool(port: SchedulesPort): CokoTool<typeof scheduleDeleteParameters, undefined> {
  return {
    name: 'schedule_delete',
    label: 'schedule_delete',
    description: 'Delete a scheduled task of this session.',
    parameters: scheduleDeleteParameters,
    effect: 'side-effect',
    async execute(_id, { id }) {
      await port.delete(id)
      return text(`Deleted scheduled task ${id}.`)
    },
  }
}

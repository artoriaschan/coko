// 定时任务（ADR 0015，docs/subsystems/schedules.md）：任务的增删改（HTTP 与模型工具）、定时器（一个计时器指向最早的 next_at，另每 30 秒复查）、
// 到期的准入、记录（recordFire）后以 trigger: schedule 开始 Run、Session 有 Run 时挂起到 run_end、错过多次只投递最近一次，以及定时任务 Run 的
// 桌面通知（结束与等待审批）。至多一次：先在一个事务中记下 schedule_fire 与新的 next_at，再开始 Run；之后崩溃不会重投这一次。
import { access } from 'node:fs/promises'
import {
  catchUp,
  nextOccurrence,
  parseAt,
  SCHEDULE_MAX_ACTIVE,
  ScheduleRuleError,
  scheduledTaskText,
  schedulesAllowed,
  validateRule,
  type ScheduleFirePayload,
  type ScheduleRuleSpec,
  type SchedulesPort,
  type ScheduleView,
} from '@coko/agent'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { CreateScheduleRequest, Schedule, ScheduleSkipReason, SessionModel, UpdateScheduleRequest } from '@coko/protocol'
import type { JsonValue, ScheduleRecord, SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import type { ClockPort } from '../adapters/clock.ts'
import type { ConfigService } from './config.ts'
import type { RunEndInfo, RunRequest } from './context/types.ts'
import { AppError, errorMessage, toAppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import type { NotificationService } from './notifications.ts'
import { requireSession, toNewEntry } from './session-runtimes.ts'

/** 只取属于该 Session 的任务（按 id 读取，不扫描全表）。 */
const bySession = <T extends { sessionId: string }>(record: T | undefined, sessionId: string) => (record?.sessionId === sessionId ? record : undefined)

const log = getLogger(['application', 'schedules'])

/** 定时器之外的复查间隔（睡眠唤醒、时钟跳变）。 */
export const SCHEDULE_RECHECK_MS = 30_000

/** ScheduleService 需要的 Run 能力（runtime/layers.ts 以 SessionService 实现）。 */
export interface ScheduleRunHost {
  isRunning(sessionId: string): boolean
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }>
  /** 设置的默认模型（Session 没有模型时开始 Run 取用）。 */
  defaultModel(): Promise<SessionModel | undefined>
  /** Session 的工作目录（SessionCwd）。 */
  cwd(session: StoredSession): Promise<string>
}

export interface ScheduleServiceOptions {
  store: SessionStore
  hub: SessionHub
  clock: ClockPort
  config: Pick<ConfigService, 'effective'>
  notifications: Pick<NotificationService, 'notify'>
  runs: ScheduleRunHost
  /** Goal 的预算判定（GoalService；含子 Session 的用量）：到期时任一维度已用尽为 skipped budget。 */
  goals: { exhaustedDimension(sessionId: string): Promise<string | undefined> }
  /** 仅测试：recordFire 之后、开始 Run 之前挂起，直到 stop（集成测试在此 SIGKILL）。 */
  holdAfterRecord?: boolean
}

const toRule = (record: ScheduleRecord) => record.rule as unknown as ScheduleRuleSpec

/**
 * 间隔规则的对齐点：任务已知的任一发生时刻（下一次或上一次），都在"创建时刻 + k × 间隔"上；都没有时为 now。时间都取 ClockPort
 * （createdAt 是存储的墙上时间，测试时钟下与 ClockPort 不同，不用作对齐点）。
 */
const anchorOf = (record: ScheduleRecord, now: number) => record.nextAt ?? record.lastOccurrence ?? now

/** 规则校验失败 → 400。 */
function validated(rule: ScheduleRuleSpec, now: number): ScheduleRuleSpec {
  try {
    return validateRule(rule, now)
  } catch (error) {
    if (error instanceof ScheduleRuleError) throw new AppError('bad-request', error.message)
    throw error
  }
}

export class ScheduleService {
  readonly #options: ScheduleServiceOptions
  /** 同一任务的变化与投递串行（投递在锁内重读任务）。 */
  readonly #locks = new KeyedMutex()
  /** 同一 Session 的创建与恢复串行（active 上限）。 */
  readonly #sessionLocks = new KeyedMutex()
  /** 挂起的任务（Session 有 Run 进行中时到期）：scheduleId → sessionId；该 Session 的 Run 结束后投递一次。 */
  readonly #suspended = new Map<string, string>()
  /** 定时任务开始的 Run：runId → scheduleId（结束与等待审批的通知）。 */
  readonly #scheduledRuns = new Map<string, { sessionId: string; scheduleId: string }>()
  /** 有定时任务 Run 的 Session 的条目订阅（approval_request）。 */
  readonly #watches = new Map<string, () => void>()
  #started = false
  #cancelTimer: (() => void) | undefined
  #cancelRecheck: (() => void) | undefined
  #tick: Promise<void> = Promise.resolve()
  #releaseHold: (() => void) | undefined
  readonly #held = new Promise<void>((resolve) => (this.#releaseHold = resolve))

  constructor(options: ScheduleServiceOptions) {
    this.#options = options
  }

  get started(): boolean {
    return this.#started
  }

  get clock(): ClockPort {
    return this.#options.clock
  }

  // ---- 生命周期 ----

  /** 开始监听（启动恢复之后）：立即扫描一次（停机期间到期的任务），之后按计时器与复查。 */
  start(): void {
    this.#started = true
    this.#schedule()
    this.#recheck()
  }

  /** 停止定时器（有序关闭的第一步）：之后不再投递，挂起的任务留到下次启动。 */
  async stop(): Promise<void> {
    this.#started = false
    this.#cancelTimer?.()
    this.#cancelRecheck?.()
    this.#releaseHold?.()
    for (const off of this.#watches.values()) off()
    this.#watches.clear()
    await this.#tick.catch(() => undefined)
  }

  #recheck(): void {
    const { clock } = this.#options
    this.#cancelRecheck?.()
    this.#cancelRecheck = clock.setTimer(clock.now() + SCHEDULE_RECHECK_MS, () => {
      if (!this.#started) return
      this.#recheck()
      this.#schedule()
    })
  }

  /** 排一次扫描（串行）：投递到期的任务，再把计时器指向最早的 next_at（挂起的任务不计）。 */
  #schedule(): void {
    this.#tick = this.#tick.then(() => this.#scan()).catch((error) => log.error('schedule scan failed', { error: errorMessage(error) }))
  }

  async #scan(): Promise<void> {
    if (!this.#started) return
    const { store, clock } = this.#options
    for (const due of await store.schedules.due(clock.now())) {
      if (!this.#started) return
      if (this.#suspended.has(due.id)) continue
      await this.#locks.run(due.id, () => this.#fire(due.id))
    }
    await this.#arm()
  }

  async #arm(): Promise<void> {
    if (!this.#started) return
    const { store, clock } = this.#options
    const next = (await store.schedules.list())
      .filter((s) => s.status === 'active' && s.nextAt !== null && !this.#suspended.has(s.id))
      .reduce<number | undefined>((min, s) => (min === undefined || s.nextAt! < min ? s.nextAt! : min), undefined)
    this.#cancelTimer?.()
    this.#cancelTimer = next === undefined ? undefined : clock.setTimer(Math.max(next, clock.now()), () => this.#started && this.#schedule())
  }

  // ---- 投递 ----

  async #fire(scheduleId: string): Promise<void> {
    const { store, clock, runs } = this.#options
    const record = await store.schedules.get(scheduleId)
    const now = clock.now()
    if (!record || record.status !== 'active' || record.nextAt === null || record.nextAt > now) return
    const rule = toRule(record)
    const plan = catchUp(rule, record.nextAt, record.nextAt, now)!
    const session = await store.sessions.getSession(record.sessionId)
    if (!session) {
      // 不再到期（否则计时器反复指向这个过去的时刻）。
      log.warn('scheduled task without a session', { scheduleId, sessionId: record.sessionId })
      await store.schedules.update(record.id, record.revision, { status: 'inactive', nextAt: null })
      return
    }
    const skip = await this.#admission(session)
    const done = plan.nextAt === null ? { status: 'inactive' as const } : {}
    if (skip) {
      await this.#record(record, { ...plan, ...done }, { status: 'skipped', reason: skip })
      log.info('scheduled task skipped', { scheduleId, sessionId: record.sessionId, reason: skip })
      return
    }
    // Session 有 Run 进行中：挂起，该 Run 结束后投递一次（期间再次到期的合并为这一次）。
    if (runs.isRunning(record.sessionId)) {
      this.#suspended.set(scheduleId, record.sessionId)
      log.info('scheduled task suspended until the run ends', { scheduleId, sessionId: record.sessionId })
      return
    }
    const fired = await this.#record(record, { ...plan, ...done }, { status: 'started' })
    log.info('scheduled task fired', { scheduleId, sessionId: record.sessionId, occurrence: plan.occurrence, missed: plan.missed })
    if (this.#options.holdAfterRecord) {
      log.warn('test hold after schedule fire', { scheduleId })
      await this.#held
      return
    }
    this.#watch(record.sessionId)
    try {
      const { runId } = await runs.startRun(record.sessionId, {
        trigger: 'schedule',
        input: { text: scheduledTaskText(fired, plan.occurrence) },
        schedule: { scheduleId, occurrence: plan.occurrence },
      })
      this.#scheduledRuns.set(runId, { sessionId: record.sessionId, scheduleId })
    } catch (error) {
      this.#unwatchIfIdle(record.sessionId)
      const entry = { scheduleId, occurrence: plan.occurrence, status: 'skipped', reason: 'start-failed' } satisfies ScheduleFirePayload
      await this.#commit(record.sessionId, entry)
      log.warn('scheduled run did not start', { scheduleId, sessionId: record.sessionId, error: errorMessage(error) })
    }
  }

  /** 准入（按顺序）；通过时 undefined。 */
  async #admission(session: StoredSession): Promise<ScheduleSkipReason | undefined> {
    const { store, config, runs } = this.#options
    let cwd: string | undefined
    try {
      cwd = await runs.cwd(session)
    } catch {
      cwd = undefined
    }
    // 有效值：全局开关与项目文件（项目只能关闭）。
    const effective = await config.effective(cwd)
    if (!effective.schedules.enabled) return 'disabled'
    if (session.parentSessionId !== null) return 'child-session'
    if (session.worktreeId !== null) {
      const worktree = await store.worktrees.get(session.worktreeId)
      if (!worktree || worktree.status === 'removed') return 'worktree-removed'
    }
    if (
      cwd === undefined ||
      !(await access(cwd).then(
        () => true,
        () => false,
      ))
    )
      return 'workspace-missing'
    if (!session.model && (session.modelCleared || !(await runs.defaultModel()))) return 'model-not-configured'
    if (await this.#options.goals.exhaustedDimension(session.id)) return 'budget'
    return undefined
  }

  /** 一个事务中更新任务并追加 schedule_fire；推送条目与快照。返回更新后的任务。 */
  async #record(
    record: ScheduleRecord,
    plan: { occurrence: number; missed: number; nextAt: number | null; status?: 'inactive' },
    fire: { status: 'started' } | { status: 'skipped'; reason: ScheduleSkipReason },
  ): Promise<ScheduleRecord> {
    const payload: ScheduleFirePayload = {
      scheduleId: record.id,
      occurrence: plan.occurrence,
      ...fire,
      ...(plan.missed > 0 ? { missed: plan.missed } : {}),
    }
    const { schedule, entry } = await this.#options.store.schedules.recordFire(
      record.id,
      { occurrence: plan.occurrence, nextAt: plan.nextAt, ...(plan.status ? { status: plan.status } : {}) },
      toNewEntry({ kind: 'schedule_fire', payload }),
    )
    this.#options.hub.publishEntry(entry)
    await this.#publish(schedule)
    return schedule
  }

  async #commit(sessionId: string, payload: ScheduleFirePayload): Promise<void> {
    const [committed] = await this.#options.store.sessions.appendEntries(sessionId, [toNewEntry({ kind: 'schedule_fire', payload })])
    this.#options.hub.publishEntry(committed!)
    const record = bySession(await this.#options.store.schedules.get(payload.scheduleId), sessionId)
    if (record) await this.#publish(record)
  }

  // ---- Run 结束与通知 ----

  /** Run 结束之后（context/schedules.ts 的 onRunEnd）：定时任务 Run 的结束通知；投递该 Session 挂起的任务。 */
  async runEnded(info: RunEndInfo): Promise<void> {
    const scheduled = this.#scheduledRuns.get(info.runId)
    if (scheduled) {
      this.#scheduledRuns.delete(info.runId)
      this.#unwatchIfIdle(info.sessionId)
      const record = bySession(await this.#options.store.schedules.get(scheduled.scheduleId), info.sessionId)
      const status = info.result.status === 'completed' ? 'finished' : info.result.status
      await this.#notify({
        kind: 'schedule-run-ended',
        sessionId: info.sessionId,
        title: record?.title ?? 'Scheduled task',
        body: `Scheduled task run ${status}`,
      })
    }
    const waiting = [...this.#suspended].filter(([, sessionId]) => sessionId === info.sessionId).map(([id]) => id)
    if (waiting.length === 0 || !this.#started) return
    // 不在 onRunEnd 中开始下一个 Run（其他领域的处理排在之后）：排到扫描队列，仍有 Run 时再次挂起。
    setImmediate(() => {
      if (!this.#started) return
      this.#tick = this.#tick
        .then(async () => {
          for (const id of waiting) {
            this.#suspended.delete(id)
            await this.#locks.run(id, () => this.#fire(id))
          }
          await this.#arm()
        })
        .catch((error) => log.error('suspended schedule delivery failed', { error: errorMessage(error) }))
    })
  }

  #watch(sessionId: string): void {
    if (this.#watches.has(sessionId)) return
    const off = this.#options.hub.subscribe(sessionId, (message) => {
      if (message.type !== 'entry' || message.entry.kind !== 'approval_request' || message.entry.runId === null) return
      const scheduled = this.#scheduledRuns.get(message.entry.runId)
      if (!scheduled) return
      void this.#approvalWaiting(scheduled.sessionId, scheduled.scheduleId)
    })
    this.#watches.set(sessionId, off)
  }

  #unwatchIfIdle(sessionId: string): void {
    if ([...this.#scheduledRuns.values()].some((run) => run.sessionId === sessionId)) return
    this.#watches.get(sessionId)?.()
    this.#watches.delete(sessionId)
  }

  async #approvalWaiting(sessionId: string, scheduleId: string): Promise<void> {
    const record = bySession(await this.#options.store.schedules.get(scheduleId), sessionId)
    await this.#notify({ kind: 'approval-waiting', sessionId, title: record?.title ?? 'Scheduled task', body: 'A scheduled task is waiting for approval' })
  }

  async #notify(input: Parameters<NotificationService['notify']>[0]): Promise<void> {
    try {
      await this.#options.notifications.notify(input)
    } catch (error) {
      log.warn('notification failed', { kind: input.kind, sessionId: input.sessionId, error: errorMessage(error) })
    }
  }

  // ---- 增删改（HTTP 与工具） ----

  /** 列表（按创建顺序）；给出 sessionId 时只列该 Session。 */
  async list(sessionId?: string): Promise<Schedule[]> {
    const { store } = this.#options
    if (sessionId !== undefined) await requireSession(store, sessionId)
    const records = await store.schedules.list(sessionId === undefined ? {} : { sessionId })
    return Promise.all(records.map((record) => this.#toDto(record)))
  }

  /** 新建（HTTP）：子 Session 409 child-session；规则不合 400；该 Session 已有 20 个 active 400。 */
  async create(sessionId: string, request: CreateScheduleRequest): Promise<Schedule> {
    const session = await requireSession(this.#options.store, sessionId)
    if (session.parentSessionId !== null) throw new AppError('child-session', 'A subagent session cannot have scheduled tasks')
    return this.#toDto(await this.#create(sessionId, request))
  }

  async #create(sessionId: string, request: { title: string; prompt: string; rule: ScheduleRuleSpec }): Promise<ScheduleRecord> {
    const { store, clock } = this.#options
    const now = clock.now()
    const rule = validated(request.rule, now)
    const record = await this.#sessionLocks.run(sessionId, async () => {
      await this.#limit(sessionId)
      // prompt 与 title 入库前按值替换登记的 Secret。
      const text = redactSecretsDeep({ title: request.title, prompt: request.prompt })
      try {
        return await store.schedules.create({ sessionId, ...text, rule: rule as unknown as JsonValue, nextAt: nextOccurrence(rule, now, now) ?? null })
      } catch (error) {
        throw toAppError(error)
      }
    })
    const stored = record
    log.info('scheduled task created', { scheduleId: stored.id, sessionId, kind: rule.kind, nextAt: stored.nextAt })
    await this.#publish(stored)
    this.#rearm()
    return stored
  }

  async #limit(sessionId: string, except?: string): Promise<void> {
    const active = (await this.#options.store.schedules.list({ sessionId })).filter((s) => s.status === 'active' && s.id !== except)
    if (active.length >= SCHEDULE_MAX_ACTIVE)
      throw new AppError('bad-request', `A session can have at most ${SCHEDULE_MAX_ACTIVE} active scheduled tasks`, { limit: SCHEDULE_MAX_ACTIVE })
  }

  /** 修改（HTTP）：revision 不一致 409 revision-conflict。 */
  async update(scheduleId: string, request: UpdateScheduleRequest): Promise<Schedule> {
    const record = await this.#require(scheduleId)
    if (record.revision !== request.revision)
      throw new AppError('revision-conflict', `Scheduled task ${scheduleId} has revision ${record.revision}`, {
        expected: request.revision,
        actual: record.revision,
      })
    return this.#toDto(await this.#update(record, request))
  }

  async #update(
    current: ScheduleRecord,
    patch: { revision?: number; title?: string; prompt?: string; rule?: ScheduleRuleSpec; status?: 'active' | 'paused' },
  ): Promise<ScheduleRecord> {
    const { store, clock } = this.#options
    const updated = await this.#sessionLocks.run(current.sessionId, () =>
      this.#locks.run(current.id, async () => {
        const record = await this.#require(current.id)
        if (patch.revision !== undefined && record.revision !== patch.revision)
          throw new AppError('revision-conflict', `Scheduled task ${record.id} has revision ${record.revision}`, {
            expected: patch.revision,
            actual: record.revision,
          })
        const now = clock.now()
        const rule = patch.rule ? validated(patch.rule, now) : toRule(record)
        const status = patch.status ?? (record.status === 'inactive' && patch.rule ? 'active' : record.status)
        if (status === 'active' && record.status !== 'active') await this.#limit(record.sessionId, record.id)
        let nextAt = record.nextAt
        if (patch.rule || (status === 'active' && record.status !== 'active')) nextAt = this.#nextAfterChange(record, rule, now, Boolean(patch.rule))
        if (status === 'active' && nextAt === null) throw new AppError('bad-request', 'The scheduled task has no future occurrence; give a new rule')
        const text = redactSecretsDeep({
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
        })
        try {
          return await store.schedules.update(record.id, record.revision, {
            ...text,
            ...(patch.rule ? { rule: rule as unknown as JsonValue } : {}),
            status,
            nextAt,
          })
        } catch (error) {
          throw toAppError(error)
        }
      }),
    )
    if (updated.status !== 'active') this.#suspended.delete(updated.id)
    log.info('scheduled task updated', { scheduleId: updated.id, status: updated.status, nextAt: updated.nextAt })
    await this.#publish(updated)
    this.#rearm()
    return updated
  }

  /**
   * 规则改变或恢复（paused / inactive → active）后的下一次：间隔按创建时刻对齐、cron 为此刻之后的下一次（暂停期间错过的不补）；
   * at 须在将来；after 仍在将来时保留，否则（或规则改变时）从此刻重新计时。
   */
  #nextAfterChange(record: ScheduleRecord, rule: ScheduleRuleSpec, now: number, ruleChanged: boolean): number | null {
    switch (rule.kind) {
      case 'every':
        // 规则改变时以此刻为新的对齐点；恢复时沿用原来的对齐。
        return nextOccurrence(rule, ruleChanged || toRule(record).kind !== 'every' ? now : anchorOf(record, now), now) ?? null
      case 'cron':
        return nextOccurrence(rule, now, now) ?? null
      case 'at':
        return parseAt(rule.at) > now ? parseAt(rule.at) : null
      case 'after':
        if (!ruleChanged && record.nextAt !== null && record.nextAt > now) return record.nextAt
        return nextOccurrence(rule, now, now) ?? null
    }
  }

  async delete(scheduleId: string): Promise<void> {
    const record = await this.#require(scheduleId)
    await this.#locks.run(record.id, async () => {
      try {
        await this.#options.store.schedules.delete(record.id)
      } catch (error) {
        throw toAppError(error)
      }
    })
    this.#suspended.delete(record.id)
    log.info('scheduled task deleted', { scheduleId, sessionId: record.sessionId })
    this.#rearm()
  }

  /** 模型的工具端口（context/schedules.ts）：只作用于本 Session 的任务；定时任务 Run 与子 Session 中不能创建或修改。 */
  port(sessionId: string): SchedulesPort {
    const { store } = this.#options
    const own = async (id: string) => {
      const record = bySession(await store.schedules.get(id), sessionId)
      if (!record) throw new Error(`No scheduled task ${id} in this session`)
      return record
    }
    const guard = async () => {
      const session = await requireSession(store, sessionId)
      const verdict = schedulesAllowed(await store.sessions.listEntries(sessionId), { childSession: session.parentSessionId !== null })
      if (!verdict.allowed) throw verdict.error
    }
    const plain = <T>(task: () => Promise<T>) =>
      task().catch((error: unknown) => {
        throw error instanceof AppError ? new Error(error.message) : error
      })
    return {
      create: (input) =>
        plain(async () => {
          await guard()
          return this.#view(await this.#create(sessionId, input))
        }),
      list: async () => (await store.schedules.list({ sessionId })).map((r) => this.#view(r)),
      update: (input) =>
        plain(async () => {
          await guard()
          const { id, ...patch } = input
          return this.#view(await this.#update(await own(id), patch))
        }),
      delete: (id) => plain(async () => this.delete((await own(id)).id)),
    }
  }

  #view(record: ScheduleRecord): ScheduleView {
    return {
      id: record.id,
      title: record.title,
      prompt: record.prompt,
      rule: toRule(record),
      status: record.status,
      ...(record.nextAt === null ? {} : { nextAt: record.nextAt }),
      ...(record.lastOccurrence === null ? {} : { lastOccurrence: record.lastOccurrence }),
    }
  }

  async #require(scheduleId: string): Promise<ScheduleRecord> {
    const record = await this.#options.store.schedules.get(scheduleId)
    if (!record) throw new AppError('not-found', `Scheduled task ${scheduleId} not found`)
    return record
  }

  #rearm(): void {
    if (this.#started) this.#schedule()
  }

  async #publish(record: ScheduleRecord): Promise<void> {
    this.#options.hub.publishProgress(record.sessionId, '', { type: 'schedule_update', schedule: await this.#toDto(record) })
  }

  /** 公开快照：lastFire 为最近一条 schedule_fire（started 时 runId 取自带同一 schedule 与 occurrence 的 run_start）。 */
  async #toDto(record: ScheduleRecord): Promise<Schedule> {
    const entries = await this.#options.store.sessions.listEntries(record.sessionId)
    const lastFire = latestFire(entries, record.id)
    return {
      id: record.id,
      sessionId: record.sessionId,
      title: record.title,
      prompt: record.prompt,
      rule: toRule(record),
      status: record.status,
      ...(record.nextAt === null ? {} : { nextAt: record.nextAt }),
      ...(record.lastOccurrence === null ? {} : { lastOccurrence: record.lastOccurrence }),
      ...(lastFire ? { lastFire } : {}),
      revision: record.revision,
    }
  }
}

function latestFire(entries: readonly StoredEntry[], scheduleId: string): Schedule['lastFire'] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind !== 'schedule_fire') continue
    const fire = entry.payload as ScheduleFirePayload
    if (fire.scheduleId !== scheduleId) continue
    if (fire.status === 'skipped') return { status: 'skipped', ...(fire.reason ? { reason: fire.reason } : {}) }
    const start = entries.slice(i + 1).find((e) => {
      const schedule = e.kind === 'run_start' ? (e.payload as { schedule?: { scheduleId: string; occurrence: number } }).schedule : undefined
      return schedule?.scheduleId === scheduleId && schedule.occurrence === fire.occurrence
    })
    return { status: 'started', ...(start?.runId ? { runId: start.runId } : {}) }
  }
  return undefined
}

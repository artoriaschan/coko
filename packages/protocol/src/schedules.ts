import { Type, type Static } from 'typebox'

// 定时任务（ADR 0015）：schedule_fire 条目 payload、规则、Schedule 快照（schedule_update 进度与列表）、/api/schedules 的 DTO 与测试时钟。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Timestamp = Type.Integer({ minimum: 0 })

/** prompt 与 title 的上限（字符）、每 Session 的 active 上限、间隔的下限（秒）。 */
export const SCHEDULE_TITLE_MAX = 120
export const SCHEDULE_PROMPT_MAX = 8000
export const MAX_ACTIVE_SCHEDULES_PER_SESSION = 20
export const SCHEDULE_MIN_INTERVAL_SECONDS = 60

/** 规则：after（秒后一次）、at（RFC 3339 带偏移的将来时刻）、every（≥ 60 秒，按创建时刻对齐）、cron（五段 Vixie + IANA 时区）。 */
export const ScheduleRule = Type.Union([
  Type.Object({ kind: Type.Literal('after'), seconds: Type.Integer({ minimum: 1 }) }, strict),
  Type.Object({ kind: Type.Literal('at'), at: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ kind: Type.Literal('every'), seconds: Type.Integer({ minimum: SCHEDULE_MIN_INTERVAL_SECONDS }) }, strict),
  Type.Object({ kind: Type.Literal('cron'), expression: Type.String({ minLength: 1 }), timeZone: Type.String({ minLength: 1 }) }, strict),
])
export type ScheduleRule = Static<typeof ScheduleRule>

export const ScheduleStatus = Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('inactive')])
export type ScheduleStatus = Static<typeof ScheduleStatus>

export const ScheduleSkipReason = Type.Union([
  Type.Literal('session-archived'),
  Type.Literal('disabled'),
  Type.Literal('child-session'),
  Type.Literal('workspace-missing'),
  Type.Literal('worktree-removed'),
  Type.Literal('model-not-configured'),
  Type.Literal('budget'),
  Type.Literal('start-failed'),
])
export type ScheduleSkipReason = Static<typeof ScheduleSkipReason>

export const ScheduleFireStatus = Type.Union([Type.Literal('started'), Type.Literal('skipped')])
export type ScheduleFireStatus = Static<typeof ScheduleFireStatus>

/** schedule_fire v1：occurrence 为本次到期时刻（UTC 毫秒）；missed 为补跑时合并掉的次数。 */
export const ScheduleFirePayload = Type.Object(
  {
    scheduleId: Id,
    occurrence: Timestamp,
    status: ScheduleFireStatus,
    reason: Type.Optional(ScheduleSkipReason),
    missed: Type.Optional(Type.Integer({ minimum: 1 })),
    runId: Type.Optional(Id),
  },
  strict,
)
export type ScheduleFirePayload = Static<typeof ScheduleFirePayload>

/** Schedule 的公开快照（progress schedule_update 与列表的元素）；nextAt / lastOccurrence 为 UTC 毫秒。 */
export const Schedule = Type.Object(
  {
    id: Id,
    sessionId: Id,
    title: Type.String({ maxLength: SCHEDULE_TITLE_MAX }),
    prompt: Type.String({ maxLength: SCHEDULE_PROMPT_MAX }),
    rule: ScheduleRule,
    status: ScheduleStatus,
    nextAt: Type.Optional(Timestamp),
    lastOccurrence: Type.Optional(Timestamp),
    lastFire: Type.Optional(Type.Object({ status: ScheduleFireStatus, reason: Type.Optional(ScheduleSkipReason), runId: Type.Optional(Id) }, strict)),
    revision: Type.Integer({ minimum: 1 }),
  },
  strict,
)
export type Schedule = Static<typeof Schedule>
export const ScheduleListResponse = Type.Array(Schedule)
export type ScheduleListResponse = Static<typeof ScheduleListResponse>

/** progress schedule_update：任务变化时的快照（不属于 Run 的进度）。 */
export const ScheduleUpdate = Type.Object({ type: Type.Literal('schedule_update'), schedule: Schedule }, strict)
export type ScheduleUpdate = Static<typeof ScheduleUpdate>

/** POST /api/sessions/:id/schedules → 201 Schedule。 */
export const CreateScheduleRequest = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX }),
    prompt: Type.String({ minLength: 1, maxLength: SCHEDULE_PROMPT_MAX }),
    rule: ScheduleRule,
  },
  strict,
)
export type CreateScheduleRequest = Static<typeof CreateScheduleRequest>

/** PATCH /api/schedules/:id → Schedule；revision 不一致 409 revision-conflict。 */
export const UpdateScheduleRequest = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX })),
    prompt: Type.Optional(Type.String({ minLength: 1, maxLength: SCHEDULE_PROMPT_MAX })),
    rule: Type.Optional(ScheduleRule),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused')])),
  },
  strict,
)
export type UpdateScheduleRequest = Static<typeof UpdateScheduleRequest>

/** POST /api/test/clock（只在测试构建注册）：拨快或设定测试时钟，返回当前时刻。 */
export const TestClockRequest = Type.Union([
  Type.Object({ advanceMs: Type.Integer({ minimum: 0 }) }, strict),
  Type.Object({ setMs: Type.Integer({ minimum: 0 }) }, strict),
])
export type TestClockRequest = Static<typeof TestClockRequest>
export const TestClockResponse = Type.Object({ now: Timestamp }, strict)
export type TestClockResponse = Static<typeof TestClockResponse>

/** 能力开关在能力配置的 schedules.enabled。 */
export const schedulePaths = {
  /** GET ScheduleListResponse；省略 sessionId 为全部会话。 */
  list: (sessionId?: string) => (sessionId === undefined ? '/api/schedules' : `/api/schedules?sessionId=${encodeURIComponent(sessionId)}`),
  /** POST CreateScheduleRequest → 201 Schedule。 */
  sessionSchedules: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/schedules`,
  /** PATCH UpdateScheduleRequest / DELETE（204）。 */
  schedule: (id: string) => `/api/schedules/${encodeURIComponent(id)}`,
  /** POST TestClockRequest → TestClockResponse（测试构建）。 */
  testClock: '/api/test/clock',
} as const

/** 本领域的 kind → payload schema。 */
export const scheduleEntryPayloadSchemas = {
  schedule_fire: ScheduleFirePayload,
}

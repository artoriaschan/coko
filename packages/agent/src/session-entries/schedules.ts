// 定时任务（ADR 0015）的条目 payload（与 @coko/protocol 的 schedules.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** 到期时没有开始 Run 的原因（按准入顺序）；start-failed：准入通过但 Run 没能开始。 */
export const scheduleSkipReasonSchema = Type.Union([
  Type.Literal('session-archived'),
  Type.Literal('disabled'),
  Type.Literal('child-session'),
  Type.Literal('workspace-missing'),
  Type.Literal('worktree-removed'),
  Type.Literal('model-not-configured'),
  Type.Literal('budget'),
  Type.Literal('start-failed'),
])
export type ScheduleSkipReason = Static<typeof scheduleSkipReasonSchema>

/** schedule_fire v1：occurrence 为本次到期时刻（UTC 毫秒）；missed 为补跑时合并掉的次数；started 时 runId 为开始的 Run。 */
export const scheduleFirePayloadSchema = Type.Object(
  {
    scheduleId: Id,
    occurrence: Type.Integer({ minimum: 0 }),
    status: Type.Union([Type.Literal('started'), Type.Literal('skipped')]),
    reason: Type.Optional(scheduleSkipReasonSchema),
    missed: Type.Optional(Type.Integer({ minimum: 1 })),
    runId: Type.Optional(Id),
  },
  strict,
)
export type ScheduleFirePayload = Static<typeof scheduleFirePayloadSchema>

export interface ScheduleEntryPayloads {
  schedule_fire: ScheduleFirePayload
}

export const scheduleEntryPayloads = definePayloads({
  schedule_fire: [{ schema: scheduleFirePayloadSchema }],
} satisfies Record<keyof ScheduleEntryPayloads, unknown>)

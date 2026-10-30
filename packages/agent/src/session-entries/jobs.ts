// 后台任务（Background Job）的条目 payload（与 @coko/protocol 的 jobs.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const jobKindSchema = Type.Union([Type.Literal('bash'), Type.Literal('pty')])
export type JobKind = Static<typeof jobKindSchema>

/** lost：Sidecar 退出时仍在运行，启动恢复补记。 */
export const jobEndStatusSchema = Type.Union([Type.Literal('completed'), Type.Literal('failed'), Type.Literal('killed'), Type.Literal('lost')])
export type JobEndStatus = Static<typeof jobEndStatusSchema>

export const jobStartPayloadSchema = Type.Object(
  { jobId: Id, kind: jobKindSchema, label: Type.String(), command: Type.String(), toolCallId: Id, goalId: Type.Optional(Id), logPath: Type.String() },
  strict,
)
export type JobStartPayload = Static<typeof jobStartPayloadSchema>

export const jobEndPayloadSchema = Type.Object(
  {
    jobId: Id,
    status: jobEndStatusSchema,
    exitCode: Type.Optional(Type.Integer()),
    signal: Type.Optional(Type.String()),
    outputBytes: Count,
    truncated: Type.Boolean(),
  },
  strict,
)
export type JobEndPayload = Static<typeof jobEndPayloadSchema>

/** 紧接在送达完成通知的 user message 之前。 */
export const jobNotificationPayloadSchema = Type.Object({ jobIds: Type.Array(Id, { minItems: 1 }) }, strict)
export type JobNotificationPayload = Static<typeof jobNotificationPayloadSchema>

export interface JobEntryPayloads {
  job_start: JobStartPayload
  job_end: JobEndPayload
  job_notification: JobNotificationPayload
}

export const jobEntryPayloads = definePayloads({
  job_start: [{ schema: jobStartPayloadSchema }],
  job_end: [{ schema: jobEndPayloadSchema }],
  job_notification: [{ schema: jobNotificationPayloadSchema }],
} satisfies Record<keyof JobEntryPayloads, unknown>)

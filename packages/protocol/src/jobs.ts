import { Type, type Static } from 'typebox'

// 后台任务（Background Job）的条目 payload 与进度中的公开快照。entries.ts 据 jobEntryPayloadSchemas 组成 SessionEntry；ws.ts 的
// job_update / job_output 进度引用这里的形状。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const JobKind = Type.Union([Type.Literal('bash'), Type.Literal('pty')])
export type JobKind = Static<typeof JobKind>

/** Job 的结束状态；lost：Sidecar 退出时仍在运行，启动恢复补记。 */
export const JobEndStatus = Type.Union([Type.Literal('completed'), Type.Literal('failed'), Type.Literal('killed'), Type.Literal('lost')])
export type JobEndStatus = Static<typeof JobEndStatus>

export const JobStatus = Type.Union([Type.Literal('running'), Type.Literal('stopping'), JobEndStatus])
export type JobStatus = Static<typeof JobStatus>

/** job_start v1：后台命令已启动。 */
export const JobStartPayload = Type.Object(
  { jobId: Id, kind: JobKind, label: Type.String(), command: Type.String(), toolCallId: Id, goalId: Type.Optional(Id), logPath: Type.String() },
  strict,
)
export type JobStartPayload = Static<typeof JobStartPayload>

/** job_end v1：后台命令已结束。 */
export const JobEndPayload = Type.Object(
  {
    jobId: Id,
    status: JobEndStatus,
    exitCode: Type.Optional(Type.Integer()),
    signal: Type.Optional(Type.String()),
    outputBytes: Count,
    truncated: Type.Boolean(),
  },
  strict,
)
export type JobEndPayload = Static<typeof JobEndPayload>

/** job_notification v1：紧接在送达完成通知的 user message 之前。 */
export const JobNotificationPayload = Type.Object({ jobIds: Type.Array(Id, { minItems: 1 }) }, strict)
export type JobNotificationPayload = Static<typeof JobNotificationPayload>

/** Job 的公开快照（progress job_update 与 GET /api/sessions/:id/jobs 的元素）。 */
export const JobSnapshot = Type.Object(
  {
    jobId: Id,
    sessionId: Id,
    kind: JobKind,
    label: Type.String(),
    command: Type.String(),
    status: JobStatus,
    toolCallId: Id,
    goalId: Type.Optional(Id),
    startedAt: Count,
    endedAt: Type.Optional(Count),
    exitCode: Type.Optional(Type.Integer()),
    signal: Type.Optional(Type.String()),
    outputBytes: Count,
    truncated: Type.Boolean(),
  },
  strict,
)
export type JobSnapshot = Static<typeof JobSnapshot>

/** 本领域的 kind → payload schema。 */
export const jobEntryPayloadSchemas = {
  job_start: JobStartPayload,
  job_end: JobEndPayload,
  job_notification: JobNotificationPayload,
}

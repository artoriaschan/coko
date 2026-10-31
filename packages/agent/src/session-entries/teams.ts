// Agent Teams（ADR 0018）的条目 payload：根 Session 的任务板快照 team_task 与送达消息前的 team_message
// （与 @coko/protocol 的 teams.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const TEAM_TASK_SUBJECT_MAX = 200
export const TEAM_TASK_DESCRIPTION_MAX = 4000
export const TEAM_MESSAGE_SUMMARY_MAX = 120

export const teamTaskStatusSchema = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('deleted')])
export type TeamTaskStatus = Static<typeof teamTaskStatusSchema>

/**
 * team_task v1：任务的完整快照（每次变更提交一条，当前板由条目派生）。taskId 为 t<n>；owner 与 by 为成员名或 lead；
 * writeScopes 为 Workspace 相对路径前缀（只用于重叠警告）。
 */
export const teamTaskPayloadSchema = Type.Object(
  {
    taskId: Type.String({ pattern: '^t[0-9]+$' }),
    revision: Type.Integer({ minimum: 1 }),
    subject: Type.String({ minLength: 1, maxLength: TEAM_TASK_SUBJECT_MAX }),
    description: Type.String({ maxLength: TEAM_TASK_DESCRIPTION_MAX }),
    status: teamTaskStatusSchema,
    owner: Type.Optional(Id),
    blockedBy: Type.Array(Type.String({ pattern: '^t[0-9]+$' })),
    writeScopes: Type.Array(Type.String({ minLength: 1 })),
    by: Id,
  },
  strict,
)
export type TeamTaskPayload = Static<typeof teamTaskPayloadSchema>

/** team_message v1：紧接在送达该消息的 user message 之前，提交在目标 Session。from / to 为成员名、lead 或 agentId。 */
export const teamMessagePayloadSchema = Type.Object(
  { messageId: Id, from: Id, to: Id, summary: Type.Optional(Type.String({ maxLength: TEAM_MESSAGE_SUMMARY_MAX })) },
  strict,
)
export type TeamMessagePayload = Static<typeof teamMessagePayloadSchema>

export interface TeamEntryPayloads {
  team_task: TeamTaskPayload
  team_message: TeamMessagePayload
}

export const teamEntryPayloads = definePayloads({
  team_task: [{ schema: teamTaskPayloadSchema }],
  team_message: [{ schema: teamMessagePayloadSchema }],
} satisfies Record<keyof TeamEntryPayloads, unknown>)

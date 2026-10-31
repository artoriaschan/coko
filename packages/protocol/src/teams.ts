import { Type, type Static } from 'typebox'
import { AgentUsage, AgentWorktreeOutcome, AGENT_ACTIVITY_SUMMARY_MAX } from './agents.ts'

// Agent Teams（ADR 0018）：team_task / team_message 条目 payload、team_update 进度与 GET /api/sessions/:id/team 的 DTO。
// 与 @coko/agent 的 session-entries/teams.ts 一致（apps/server/src/application/entry-payloads.ts 编译期比对）。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const TaskId = Type.String({ pattern: '^t[0-9]+$' })

export const TEAM_TASK_SUBJECT_MAX = 200
export const TEAM_TASK_DESCRIPTION_MAX = 4000
export const TEAM_MESSAGE_SUMMARY_MAX = 120
/** send_message 的正文上限（字符）。 */
export const TEAM_MESSAGE_BODY_MAX = 8000
/** 每个根 Session 未解散的 teammate 上限。 */
export const MAX_TEAMMATES = 8
/** 每个根 Session 非删除任务的上限。 */
export const MAX_TEAM_TASKS = 100
/** lead 在团队消息中的名字（根 Session）。 */
export const TEAM_LEAD_NAME = 'lead'

export const TeamTaskStatus = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('deleted')])
export type TeamTaskStatus = Static<typeof TeamTaskStatus>

/** team_task v1：任务的完整快照（每次变更一条，提交在根 Session）；owner 与 by 为成员名或 lead。 */
export const TeamTaskPayload = Type.Object(
  {
    taskId: TaskId,
    revision: Type.Integer({ minimum: 1 }),
    subject: Type.String({ minLength: 1, maxLength: TEAM_TASK_SUBJECT_MAX }),
    description: Type.String({ maxLength: TEAM_TASK_DESCRIPTION_MAX }),
    status: TeamTaskStatus,
    owner: Type.Optional(Id),
    blockedBy: Type.Array(TaskId),
    writeScopes: Type.Array(Type.String({ minLength: 1 })),
    by: Id,
  },
  strict,
)
export type TeamTaskPayload = Static<typeof TeamTaskPayload>

/** team_message v1：紧接在送达该消息的 user message 之前，提交在目标 Session。 */
export const TeamMessagePayload = Type.Object(
  { messageId: Id, from: Id, to: Id, summary: Type.Optional(Type.String({ maxLength: TEAM_MESSAGE_SUMMARY_MAX })) },
  strict,
)
export type TeamMessagePayload = Static<typeof TeamMessagePayload>

export const TeamMemberStatus = Type.Union([Type.Literal('running'), Type.Literal('idle'), Type.Literal('dismissed'), Type.Literal('failed')])
export type TeamMemberStatus = Static<typeof TeamMemberStatus>

export const TeamMember = Type.Object(
  {
    agentId: Id,
    name: Id,
    status: TeamMemberStatus,
    activity: Type.Optional(Type.Object({ toolName: Type.String(), summary: Type.String({ maxLength: AGENT_ACTIVITY_SUMMARY_MAX }) }, strict)),
    usage: AgentUsage,
    worktree: Type.Optional(AgentWorktreeOutcome),
  },
  strict,
)
export type TeamMember = Static<typeof TeamMember>

/** 任务板中的一项：快照加 ready（前置任务全部完成）。 */
export const TeamTaskView = Type.Object({ ...TeamTaskPayload.properties, ready: Type.Boolean() }, strict)
export type TeamTaskView = Static<typeof TeamTaskView>

/** 任务板的警告：两个 in_progress 任务的 writeScopes 重叠（不阻止写入）。 */
export const TeamWarning = Type.Object(
  { code: Type.Literal('write-scope-overlap'), taskIds: Type.Array(TaskId, { minItems: 2 }), message: Type.String() },
  strict,
)
export type TeamWarning = Static<typeof TeamWarning>

/** 根 Session 的团队快照（GET /api/sessions/:id/team；子 Session id 时为其根的快照）。 */
export const TeamSnapshot = Type.Object({ members: Type.Array(TeamMember), tasks: Type.Array(TeamTaskView), warnings: Type.Array(TeamWarning) }, strict)
export type TeamSnapshot = Static<typeof TeamSnapshot>

/** progress team_update：根 Session 的名册或任务变化时（不属于 Run）。 */
export const TeamUpdate = Type.Object({ type: Type.Literal('team_update'), team: TeamSnapshot }, strict)
export type TeamUpdate = Static<typeof TeamUpdate>

export const teamPaths = {
  /** GET TeamSnapshot。 */
  team: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/team`,
} as const

/** 本领域的 kind → payload schema。 */
export const teamEntryPayloadSchemas = {
  team_task: TeamTaskPayload,
  team_message: TeamMessagePayload,
}

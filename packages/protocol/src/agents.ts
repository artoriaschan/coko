import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'
import { StandardPermissionMode } from './permissions.ts'

// 子代理（ADR 0014）：条目 payload、agent_update 进度的形状与 /api/sessions/:id/agents、/api/agents/definitions 的 DTO。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })
const Timestamp = Type.Integer({ minimum: 0 })

export const AgentEndStatus = Type.Union([
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('max-turns'),
  Type.Literal('interrupted'),
])
export type AgentEndStatus = Static<typeof AgentEndStatus>

export const AgentStatus = Type.Union([Type.Literal('running'), AgentEndStatus])
export type AgentStatus = Static<typeof AgentStatus>

export const AgentDefinitionSource = Type.Union([Type.Literal('builtin'), Type.Literal('user'), Type.Literal('project')])
export type AgentDefinitionSource = Static<typeof AgentDefinitionSource>

/** agent_start v1：agentId 即子 Session id。 */
export const AgentStartPayload = Type.Object(
  {
    agentId: Id,
    agentType: Id,
    description: Type.String(),
    background: Type.Boolean(),
    toolCallId: Id,
    goalId: Type.Optional(Id),
    isolation: Type.Optional(Type.Object({ worktreeId: Id, path: Type.String(), branch: Type.String() }, strict)),
  },
  strict,
)
export type AgentStartPayload = Static<typeof AgentStartPayload>

export const AgentUsage = Type.Object({ turns: Count, toolCalls: Count, tokens: Count, cost: Type.Number({ minimum: 0 }), durationMs: Count }, strict)
export type AgentUsage = Static<typeof AgentUsage>

export const AgentWorktreeOutcome = Type.Object({ kept: Type.Boolean(), path: Type.String(), branch: Type.String() }, strict)
export type AgentWorktreeOutcome = Static<typeof AgentWorktreeOutcome>

/** agent_end v1。 */
export const AgentEndPayload = Type.Object(
  { agentId: Id, status: AgentEndStatus, usage: AgentUsage, resultChars: Count, worktree: Type.Optional(AgentWorktreeOutcome) },
  strict,
)
export type AgentEndPayload = Static<typeof AgentEndPayload>

/** agent_notification v1：紧接在送达后台子代理结束通知的 user message 之前。 */
export const AgentNotificationPayload = Type.Object({ agentIds: Type.Array(Id, { minItems: 1 }) }, strict)
export type AgentNotificationPayload = Static<typeof AgentNotificationPayload>

/** subagent_origin v1：子 Session 的首条。 */
export const SubagentOriginPayload = Type.Object(
  {
    parentSessionId: Id,
    parentRunId: Id,
    toolCallId: Id,
    definition: Type.Object(
      {
        name: Id,
        source: AgentDefinitionSource,
        tools: Type.Array(Type.String()),
        model: Type.Optional(Type.String()),
        permissionMode: Type.Optional(StandardPermissionMode),
        maxTurns: Type.Integer({ minimum: 1 }),
      },
      strict,
    ),
  },
  strict,
)
export type SubagentOriginPayload = Static<typeof SubagentOriginPayload>

/** agent_update.activity 的摘要上限（字符）。 */
export const AGENT_ACTIVITY_SUMMARY_MAX = 120

/** progress agent_update：子代理的状态与最近一次工具调用（已脱敏）。 */
export const AgentUpdate = Type.Object(
  {
    type: Type.Literal('agent_update'),
    agentId: Id,
    status: AgentStatus,
    activity: Type.Optional(Type.Object({ toolName: Type.String(), summary: Type.String({ maxLength: AGENT_ACTIVITY_SUMMARY_MAX }) }, strict)),
  },
  strict,
)
export type AgentUpdate = Static<typeof AgentUpdate>

/** GET /api/sessions/:id/agents 的元素。 */
export const AgentSnapshot = Type.Object(
  {
    agentId: Id,
    agentType: Id,
    description: Type.String(),
    status: AgentStatus,
    background: Type.Boolean(),
    startedAt: Timestamp,
    endedAt: Type.Optional(Timestamp),
    usage: Type.Optional(AgentUsage),
    worktree: Type.Optional(AgentWorktreeOutcome),
  },
  strict,
)
export type AgentSnapshot = Static<typeof AgentSnapshot>
export const SessionAgentsResponse = Type.Array(AgentSnapshot)
export type SessionAgentsResponse = Static<typeof SessionAgentsResponse>

/** 一个已加载的子代理定义；path 为文件定义的位置（内置没有）。 */
export const AgentDefinitionInfo = Type.Object(
  {
    name: Id,
    source: AgentDefinitionSource,
    description: Type.String(),
    tools: Type.Optional(Type.Array(Type.String())),
    model: Type.Optional(Type.String()),
    permissionMode: Type.Optional(StandardPermissionMode),
    maxTurns: Type.Integer({ minimum: 1 }),
    path: Type.Optional(Type.String()),
  },
  strict,
)
export type AgentDefinitionInfo = Static<typeof AgentDefinitionInfo>

/** GET /api/agents/definitions?workspaceId=。 */
export const AgentDefinitionsResponse = Type.Object({ definitions: Type.Array(AgentDefinitionInfo), diagnostics: Type.Array(ResourceDiagnostic) }, strict)
export type AgentDefinitionsResponse = Static<typeof AgentDefinitionsResponse>

/** 能力开关在能力配置的 agents.enabled；每个根 Session 同时 running 的子代理上限。 */
export const MAX_RUNNING_SUBAGENTS = 4

export const agentPaths = {
  /** GET SessionAgentsResponse。 */
  sessionAgents: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/agents`,
  /** POST，204；已结束 409 agent-not-running。 */
  cancel: (sessionId: string, agentId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/cancel`,
  /** GET AgentDefinitionsResponse。 */
  definitions: (workspaceId: string) => `/api/agents/definitions?workspaceId=${encodeURIComponent(workspaceId)}`,
} as const

/** 本领域的 kind → payload schema。 */
export const agentEntryPayloadSchemas = {
  agent_start: AgentStartPayload,
  agent_end: AgentEndPayload,
  agent_notification: AgentNotificationPayload,
  subagent_origin: SubagentOriginPayload,
}

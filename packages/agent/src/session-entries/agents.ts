// 子代理（ADR 0014）的条目 payload：父 Session 的 agent_start / agent_end / agent_notification 与子 Session 首条的 subagent_origin
// （与 @coko/protocol 的 agents.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'
import { standardPermissionModeSchema } from './permissions.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** 子代理的结束状态；interrupted：Sidecar 重启时仍在运行，父 Session 的恢复补记。 */
export const agentEndStatusSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('max-turns'),
  Type.Literal('interrupted'),
])
export type AgentEndStatus = Static<typeof agentEndStatusSchema>

/** 子代理定义的来源；同名时 project > user > builtin。 */
export const agentDefinitionSourceSchema = Type.Union([Type.Literal('builtin'), Type.Literal('user'), Type.Literal('project')])
export type AgentDefinitionSource = Static<typeof agentDefinitionSourceSchema>

/** agent_start v1：agentId 即子 Session id；isolation 为子代理专用的 worktree。 */
export const agentStartPayloadSchema = Type.Object(
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
export type AgentStartPayload = Static<typeof agentStartPayloadSchema>

/** 子代理的用量（计入派发它的 Goal，不计轮次）。 */
export const agentUsageSchema = Type.Object({ turns: Count, toolCalls: Count, tokens: Count, cost: Type.Number({ minimum: 0 }), durationMs: Count }, strict)
export type AgentUsage = Static<typeof agentUsageSchema>

/** agent_end v1：resultChars 为交回结果的字符数；worktree 为结束时 isolation worktree 的去留。 */
export const agentEndPayloadSchema = Type.Object(
  {
    agentId: Id,
    status: agentEndStatusSchema,
    usage: agentUsageSchema,
    resultChars: Count,
    worktree: Type.Optional(Type.Object({ kept: Type.Boolean(), path: Type.String(), branch: Type.String() }, strict)),
  },
  strict,
)
export type AgentEndPayload = Static<typeof agentEndPayloadSchema>

/** agent_notification v1：紧接在送达后台子代理结束通知的 user message 之前。 */
export const agentNotificationPayloadSchema = Type.Object({ agentIds: Type.Array(Id, { minItems: 1 }) }, strict)
export type AgentNotificationPayload = Static<typeof agentNotificationPayloadSchema>

/** subagent_origin v1：子 Session 的首条，记录派发它的父 Run 与所用定义。 */
export const subagentOriginPayloadSchema = Type.Object(
  {
    parentSessionId: Id,
    parentRunId: Id,
    toolCallId: Id,
    definition: Type.Object(
      {
        name: Id,
        source: agentDefinitionSourceSchema,
        tools: Type.Array(Type.String()),
        model: Type.Optional(Type.String()),
        permissionMode: Type.Optional(standardPermissionModeSchema),
        maxTurns: Type.Integer({ minimum: 1 }),
      },
      strict,
    ),
  },
  strict,
)
export type SubagentOriginPayload = Static<typeof subagentOriginPayloadSchema>

/** 条目的最小形状（宿主的存储条目与运行时条目都满足）。 */
interface EntryLike {
  kind: string
  payload: unknown
}
type Typed<E extends EntryLike, P> = E & { payload: P }

/** 父 Session 的 agent_start 条目（payload 已入库校验，按 schema 类型读取）。 */
export const agentStarts = <E extends EntryLike>(entries: readonly E[]): Typed<E, AgentStartPayload>[] =>
  entries.filter((e): e is Typed<E, AgentStartPayload> => e.kind === 'agent_start')

/** 父 Session 的 agent_end 条目（payload 已入库校验，按 schema 类型读取）。 */
export const agentEnds = <E extends EntryLike>(entries: readonly E[]): Typed<E, AgentEndPayload>[] =>
  entries.filter((e): e is Typed<E, AgentEndPayload> => e.kind === 'agent_end')

export interface AgentEntryPayloads {
  agent_start: AgentStartPayload
  agent_end: AgentEndPayload
  agent_notification: AgentNotificationPayload
  subagent_origin: SubagentOriginPayload
}

export const agentEntryPayloads = definePayloads({
  agent_start: [{ schema: agentStartPayloadSchema }],
  agent_end: [{ schema: agentEndPayloadSchema }],
  agent_notification: [{ schema: agentNotificationPayloadSchema }],
  subagent_origin: [{ schema: subagentOriginPayloadSchema }],
} satisfies Record<keyof AgentEntryPayloads, unknown>)

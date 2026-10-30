import { Type, type Static } from 'typebox'
import { RequestUsage } from './context-entries.ts'

// Handoff：源 Session 的 handoff、目标 Session 首条的 handoff_origin 与 POST /api/sessions/:id/handoff 的 DTO。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** 交接摘要的上限（字符）。 */
export const HANDOFF_SUMMARY_MAX = 12000

/** handoff v1：usage 为摘要请求的 usage（计入同一 Goal Run 的预算）。 */
export const HandoffPayload = Type.Object(
  {
    targetSessionId: Id,
    instructions: Type.String(),
    summary: Type.String(),
    target: Type.Union([Type.Literal('current'), Type.Literal('worktree')]),
    usage: Type.Optional(RequestUsage),
  },
  strict,
)
export type HandoffPayload = Static<typeof HandoffPayload>

/** handoff_origin v1：指向源 Session 中 handoff 条目的 seq。 */
export const HandoffOriginPayload = Type.Object({ sessionId: Id, seq: Type.Integer({ minimum: 1 }) }, strict)
export type HandoffOriginPayload = Static<typeof HandoffOriginPayload>

export const HandoffTarget = Type.Union([
  Type.Object({ kind: Type.Literal('current') }, strict),
  Type.Object({ kind: Type.Literal('new-worktree'), name: Type.Optional(Type.String({ minLength: 1 })) }, strict),
  Type.Object({ kind: Type.Literal('worktree'), worktreeId: Id }, strict),
])
export type HandoffTarget = Static<typeof HandoffTarget>

/** POST /api/sessions/:id/handoff → 202 { runId }；Run 进行中 409 run-in-progress、子 Session 409 child-session、没有用户消息 400 nothing-to-hand-off。 */
export const HandoffRequest = Type.Object({ instructions: Type.String({ minLength: 1 }), target: HandoffTarget }, strict)
export type HandoffRequest = Static<typeof HandoffRequest>

export const handoffPaths = {
  handoff: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/handoff`,
} as const

/** 本领域的 kind → payload schema。 */
export const handoffEntryPayloadSchemas = {
  handoff: HandoffPayload,
  handoff_origin: HandoffOriginPayload,
}

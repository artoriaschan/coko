// Handoff 的条目 payload：源 Session 的 handoff 与目标 Session 首条的 handoff_origin（与 @coko/protocol 的 handoff.ts 一致）。
import { Type, type Static } from 'typebox'
import { requestUsageSchema } from './context.ts'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** handoff v1：summary 为模型写的交接摘要；usage 为摘要请求的 usage（计入同一 Goal Run 的预算）。 */
export const handoffPayloadSchema = Type.Object(
  {
    targetSessionId: Id,
    instructions: Type.String(),
    summary: Type.String(),
    target: Type.Union([Type.Literal('current'), Type.Literal('worktree')]),
    usage: Type.Optional(requestUsageSchema),
  },
  strict,
)
export type HandoffPayload = Static<typeof handoffPayloadSchema>

/** handoff_origin v1：目标 Session 的首条，指向源 Session 中 handoff 条目的 seq。 */
export const handoffOriginPayloadSchema = Type.Object({ sessionId: Id, seq: Type.Integer({ minimum: 1 }) }, strict)
export type HandoffOriginPayload = Static<typeof handoffOriginPayloadSchema>

export interface HandoffEntryPayloads {
  handoff: HandoffPayload
  handoff_origin: HandoffOriginPayload
}

export const handoffEntryPayloads = definePayloads({
  handoff: [{ schema: handoffPayloadSchema }],
  handoff_origin: [{ schema: handoffOriginPayloadSchema }],
} satisfies Record<keyof HandoffEntryPayloads, unknown>)

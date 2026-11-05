// 工具执行记录（Execution Record）的条目 payload。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const Id = Type.String({ minLength: 1 })

/** side-effect 调用取得执行槽后、执行前提交；幂等键为 `<sessionId>:<toolCallId>`。 */
export const toolExecPayloadSchema = Type.Object({ toolCallId: Id, toolName: Type.String(), idempotencyKey: Id }, { additionalProperties: false })
export type ToolExecPayload = Static<typeof toolExecPayloadSchema>

/** 幂等键：同一 Session 内的 toolCallId 唯一，恢复后重新计算得到同一个键。 */
export const idempotencyKeyFor = (sessionId: string, toolCallId: string) => `${sessionId}:${toolCallId}`

export const toolLoadPayloadSchema = Type.Object(
  {
    names: Type.Array(Id, { minItems: 1, uniqueItems: true }),
    source: Type.Union([Type.Literal('search'), Type.Literal('optimistic')]),
    toolCallId: Id,
  },
  { additionalProperties: false },
)
export type ToolLoadPayload = Static<typeof toolLoadPayloadSchema>

export interface ToolEntryPayloads {
  tool_load: ToolLoadPayload
  tool_exec: ToolExecPayload
}

export const toolEntryPayloads = definePayloads({
  tool_exec: [{ schema: toolExecPayloadSchema }],
  tool_load: [{ schema: toolLoadPayloadSchema }],
} satisfies Record<keyof ToolEntryPayloads, unknown>)

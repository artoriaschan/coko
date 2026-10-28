// M3 上下文相关的条目 payload：命令与压缩（与 @coko/protocol 的 context-entries.ts 一致，server 的 entry-payloads.ts 编译期比对）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Count = Type.Integer({ minimum: 0 })

export const commandSourceSchema = Type.Union([
  Type.Literal('builtin'),
  Type.Literal('project'),
  Type.Literal('user'),
  Type.Literal('skill'),
  Type.Literal('mcp'),
])
export type CommandSource = Static<typeof commandSourceSchema>

/** 识别到命令：位于 run_start 之后、展开后的 user message 之前（steer 时在该 user message 之前）。 */
export const commandPayloadSchema = Type.Object({ name: Type.String({ minLength: 1 }), args: Type.String(), source: commandSourceSchema }, strict)
export type CommandPayload = Static<typeof commandPayloadSchema>

export const compactionTriggerSchema = Type.Union([Type.Literal('auto'), Type.Literal('manual'), Type.Literal('overflow')])
export type CompactionTrigger = Static<typeof compactionTriggerSchema>

/** 压缩成功：之后的模型上下文为合成摘要消息 + firstKeptSeq 及之后的消息（entries/ 的 modelContext）。 */
export const compactionPayloadSchema = Type.Object(
  {
    summary: Type.String(),
    firstKeptSeq: Type.Integer({ minimum: 1 }),
    tokensBefore: Count,
    tokensAfter: Type.Optional(Count),
    trigger: compactionTriggerSchema,
    readFiles: Type.Array(Type.String()),
    modifiedFiles: Type.Array(Type.String()),
    invokedSkills: Type.Optional(Type.Array(Type.String())),
  },
  strict,
)
export type CompactionPayload = Static<typeof compactionPayloadSchema>

export interface ContextEntryPayloads {
  command: CommandPayload
  compaction: CompactionPayload
}

export const contextEntryPayloads = definePayloads({
  command: [{ schema: commandPayloadSchema }],
  compaction: [{ schema: compactionPayloadSchema }],
} satisfies Record<keyof ContextEntryPayloads, unknown>)

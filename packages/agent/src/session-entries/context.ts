// M3 上下文相关的条目 payload：命令与压缩（与 @coko/protocol 的 context-entries.ts 一致，server 的 entry-payloads.ts 编译期比对）。
import { Type, type Static } from 'typebox'
import { definePayloads, type EntryJson } from './define.ts'

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

const compactionFields = {
  summary: Type.String(),
  firstKeptSeq: Type.Integer({ minimum: 1 }),
  tokensBefore: Count,
  tokensAfter: Type.Optional(Count),
  trigger: compactionTriggerSchema,
  readFiles: Type.Array(Type.String()),
  modifiedFiles: Type.Array(Type.String()),
  invokedSkills: Type.Optional(Type.Array(Type.String())),
}

/** compaction v1：没有摘要请求的 usage。 */
const compactionV1Schema = Type.Object(compactionFields, strict)

const Amount = Type.Number({ minimum: 0 })
/** Raw provider reporting completeness; absent on legacy records. */
export const USAGE_REPORT_SCHEMA = Type.Object(
  {
    complete: Type.Boolean(),
    known: Type.Array(Type.Union([Type.Literal('input'), Type.Literal('output'), Type.Literal('cacheRead'), Type.Literal('cacheWrite')]), {
      uniqueItems: true,
    }),
  },
  strict,
)
export type UsageReport = Static<typeof USAGE_REPORT_SCHEMA>

/** 一次模型请求的 usage（pi-ai Usage 的 token 与费用部分）。 */
export const requestUsageSchema = Type.Object(
  {
    input: Amount,
    output: Amount,
    cacheRead: Amount,
    cacheWrite: Amount,
    totalTokens: Amount,
    reasoning: Type.Optional(Amount),
    cacheWrite1h: Type.Optional(Amount),
    report: Type.Optional(USAGE_REPORT_SCHEMA),
    cost: Type.Object({ input: Amount, output: Amount, cacheRead: Amount, cacheWrite: Amount, total: Amount }, strict),
  },
  strict,
)
export type RequestUsage = Static<typeof requestUsageSchema>

/**
 * 压缩成功（v2）：之后的模型上下文为合成摘要消息 + firstKeptSeq 及之后的消息（entries/ 的 modelContext）。usage 为摘要请求的 usage
 * （计入 Goal 预算）；v1 迁移而来的条目没有。
 */
export const compactionPayloadSchema = Type.Object({ ...compactionFields, usage: Type.Optional(requestUsageSchema) }, strict)
export type CompactionPayload = Static<typeof compactionPayloadSchema>

export interface ContextEntryPayloads {
  command: CommandPayload
  compaction: CompactionPayload
}

export const contextEntryPayloads = definePayloads({
  command: [{ schema: commandPayloadSchema }],
  compaction: [{ schema: compactionV1Schema }, { schema: compactionPayloadSchema, migrate: (previous: EntryJson) => previous }],
} satisfies Record<keyof ContextEntryPayloads, unknown>)

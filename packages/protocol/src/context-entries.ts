import { Type, type Static } from 'typebox'

// M3 上下文相关的条目 payload：命令（command）与压缩（compaction）。entries.ts 据 contextEntryPayloadSchemas 组成 SessionEntry。
// File Reference 与嵌套指令不是独立的 kind，见 files.ts。

const strict = { additionalProperties: false } as const
const Count = Type.Integer({ minimum: 0 })

/** 命令的来源（命令目录的分组）。 */
export const CommandSource = Type.Union([Type.Literal('builtin'), Type.Literal('project'), Type.Literal('user'), Type.Literal('skill'), Type.Literal('mcp')])
export type CommandSource = Static<typeof CommandSource>

/** 识别到命令：位于 run_start 之后、展开后的 user message 之前（steer 时在该 user message 之前）。 */
export const CommandPayload = Type.Object({ name: Type.String({ minLength: 1 }), args: Type.String(), source: CommandSource }, strict)
export type CommandPayload = Static<typeof CommandPayload>

/** 压缩的触发：自动（接近阈值）、手动（/compact）、溢出（模型报上下文超限）。 */
export const CompactionTrigger = Type.Union([Type.Literal('auto'), Type.Literal('manual'), Type.Literal('overflow')])
export type CompactionTrigger = Static<typeof CompactionTrigger>

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

/** 一次模型请求的 usage：token 数与按模型价格计算的费用（未定价模型为 0）。 */
export const RequestUsage = Type.Object(
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
export type RequestUsage = Static<typeof RequestUsage>

/**
 * 压缩成功（v2）：之后的模型上下文为合成摘要消息 + firstKeptSeq 及之后的消息（@coko/agent/entries 的 modelContext）。原条目保留，
 * 时间线仍可查看；compaction 落在被回退区间内时不生效。usage 为摘要请求的 usage（计入 Goal 预算）；v1 迁移而来的条目没有。
 */
export const CompactionPayload = Type.Object(
  {
    summary: Type.String(),
    firstKeptSeq: Type.Integer({ minimum: 1 }),
    tokensBefore: Count,
    tokensAfter: Type.Optional(Count),
    trigger: CompactionTrigger,
    readFiles: Type.Array(Type.String()),
    modifiedFiles: Type.Array(Type.String()),
    invokedSkills: Type.Optional(Type.Array(Type.String())),
    usage: Type.Optional(RequestUsage),
  },
  strict,
)
export type CompactionPayload = Static<typeof CompactionPayload>

/** 本领域的 kind → payload schema。 */
export const contextEntryPayloadSchemas = {
  command: CommandPayload,
  compaction: CompactionPayload,
}

// 逐请求记录：每次模型请求结束时运行时提交的 model_request（与 @coko/protocol 的 trace.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** turn：Run 中的一轮；compaction：压缩的摘要请求；summary：交接的摘要请求；title：Run 之外的会话标题请求（runId 为 null）。 */
export const modelRequestPurposeSchema = Type.Union([Type.Literal('turn'), Type.Literal('compaction'), Type.Literal('summary'), Type.Literal('title')])
export type ModelRequestPurpose = Static<typeof modelRequestPurposeSchema>

export const modelRequestUsageSchema = Type.Object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count, total: Count }, strict)
export type ModelRequestUsage = Static<typeof modelRequestUsageSchema>

/**
 * model_request v1：一次模型请求（含重试后的最终一次，retries 为之前失败的次数）。ttftMs 为第一个文本或工具调用增量到达的时间；
 * cost 为该请求的费用合计（未定价时省略）；errorCode 只在请求以错误结束时有。
 */
export const modelRequestPayloadSchema = Type.Object(
  {
    runId: Type.Union([Id, Type.Null()]),
    provider: Type.String(),
    model: Type.String(),
    startedAt: Count,
    durationMs: Count,
    ttftMs: Type.Optional(Count),
    usage: modelRequestUsageSchema,
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    stopReason: Type.String(),
    retries: Count,
    errorCode: Type.Optional(Type.String()),
    purpose: modelRequestPurposeSchema,
  },
  strict,
)
export type ModelRequestPayload = Static<typeof modelRequestPayloadSchema>

export interface ObservabilityEntryPayloads {
  model_request: ModelRequestPayload
}

export const observabilityEntryPayloads = definePayloads({
  model_request: [{ schema: modelRequestPayloadSchema }],
} satisfies Record<keyof ObservabilityEntryPayloads, unknown>)

import { Type, type Static } from 'typebox'

// 观测：model_request 条目 payload 与 GET /api/sessions/:id/{trace,audit,export} 的 DTO。model_request 与 @coko/agent 的
// session-entries/observability.ts 一致；RunTrace / AuditEvent 由追踪派生扩展（这里是占位的最小形状）。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const ModelRequestPurpose = Type.Union([Type.Literal('turn'), Type.Literal('compaction'), Type.Literal('summary')])
export type ModelRequestPurpose = Static<typeof ModelRequestPurpose>

export const ModelRequestUsage = Type.Object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count, total: Count }, strict)
export type ModelRequestUsage = Static<typeof ModelRequestUsage>

/** model_request v1：一次模型请求结束（含错误与摘要请求）；retries 为之前失败的次数。 */
export const ModelRequestPayload = Type.Object(
  {
    runId: Id,
    provider: Type.String(),
    model: Type.String(),
    startedAt: Count,
    durationMs: Count,
    ttftMs: Type.Optional(Count),
    usage: ModelRequestUsage,
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    stopReason: Type.String(),
    retries: Count,
    errorCode: Type.Optional(Type.String()),
    purpose: ModelRequestPurpose,
  },
  strict,
)
export type ModelRequestPayload = Static<typeof ModelRequestPayload>

/** 一个 Run 的追踪（占位：由追踪派生补全工具耗时、审批等待与 Hook 结果）。 */
export const RunTrace = Type.Object(
  {
    runId: Id,
    trigger: Type.String(),
    status: Type.Optional(Type.String()),
    startedAt: Count,
    durationMs: Type.Optional(Count),
    requests: Type.Array(ModelRequestPayload),
  },
  { additionalProperties: true },
)
export type RunTrace = Static<typeof RunTrace>

export const TraceTotals = Type.Object({ requests: Count, tokens: Count, cost: Type.Number({ minimum: 0 }), durationMs: Count }, { additionalProperties: true })
export type TraceTotals = Static<typeof TraceTotals>

/** GET /api/sessions/:id/trace。 */
export const TraceResponse = Type.Object({ runs: Type.Array(RunTrace), totals: TraceTotals }, strict)
export type TraceResponse = Static<typeof TraceResponse>

/** 审计时间序列中的一项（占位：由审计派生补全种类与字段）。 */
export const AuditEvent = Type.Object({ seq: Type.Integer({ minimum: 1 }), at: Count, kind: Type.String() }, { additionalProperties: true })
export type AuditEvent = Static<typeof AuditEvent>
export const AuditResponse = Type.Array(AuditEvent)
export type AuditResponse = Static<typeof AuditResponse>

/** 导出（application/x-ndjson）的第一行。 */
export const SESSION_EXPORT_FORMAT = 'coko-session-export'
export const SessionExportHeader = Type.Object(
  { type: Type.Literal('header'), format: Type.Literal(SESSION_EXPORT_FORMAT), version: Type.Literal(1), sessionId: Id, exportedAt: Count },
  strict,
)
export type SessionExportHeader = Static<typeof SessionExportHeader>

export const tracePaths = {
  /** GET TraceResponse。 */
  trace: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/trace`,
  /** GET AuditResponse。 */
  audit: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/audit`,
  /** GET application/x-ndjson；children 为 true 时含子 Session 的条目。 */
  export: (sessionId: string, children = false) => `/api/sessions/${encodeURIComponent(sessionId)}/export${children ? '?children=1' : ''}`,
} as const

/** 本领域的 kind → payload schema。 */
export const traceEntryPayloadSchemas = {
  model_request: ModelRequestPayload,
}

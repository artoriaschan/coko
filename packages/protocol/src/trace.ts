import { USAGE_REPORT_SCHEMA, RequestUsage } from './context-entries.ts'
import { Type, type Static, type TSchema } from 'typebox'

// 观测：model_request 条目 payload 与 GET /api/sessions/:id/{trace,audit,export} 的 DTO。model_request 与 @coko/agent 的
// session-entries/observability.ts 一致；RunTrace / AuditEvent 与 @coko/agent 的 deriveTrace / deriveAudit 一致（server 的 trace.ts 编译期比对）。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const ModelRequestPurpose = Type.Union([Type.Literal('turn'), Type.Literal('compaction'), Type.Literal('summary'), Type.Literal('title')])
export type ModelRequestPurpose = Static<typeof ModelRequestPurpose>

export const ModelRequestUsage = Type.Object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count, total: Count }, strict)
export type ModelRequestUsage = Static<typeof ModelRequestUsage>

/** Immutable, redacted model-visible input captured when the request attempt started. */
export const ModelRequestSnapshot = Type.Object({ system: Type.String(), messages: Type.Array(Type.Unknown()), tools: Type.Array(Type.Unknown()) }, strict)
export type ModelRequestSnapshot = Static<typeof ModelRequestSnapshot>

/** model_request v1：一次模型请求结束（含错误、摘要与 Run 外标题请求；标题的 runId 为 null）；retries 为之前失败的次数。 */
export const ModelRequestPayload = Type.Object(
  {
    runId: Type.Union([Id, Type.Null()]),
    provider: Type.String(),
    model: Type.String(),
    startedAt: Count,
    durationMs: Count,
    ttftMs: Type.Optional(Count),
    requestId: Type.Optional(Id),
    snapshot: Type.Optional(ModelRequestSnapshot),
    usageReport: Type.Optional(USAGE_REPORT_SCHEMA),
    reasoning: Type.Optional(Count),
    usage: ModelRequestUsage,
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    costBreakdown: Type.Optional(RequestUsage.properties.cost),
    stopReason: Type.String(),
    retries: Count,
    errorCode: Type.Optional(Type.String()),
    purpose: ModelRequestPurpose,
  },
  strict,
)
export type ModelRequestPayload = Static<typeof ModelRequestPayload>

/** 一次有结果的 Hook 执行（hook_run 的摘要）。 */
export const HookTrace = Type.Object(
  { event: Type.String(), hookId: Type.String(), source: Type.String(), plugin: Type.Optional(Type.String()), outcome: Type.String(), durationMs: Count },
  strict,
)
export type HookTrace = Static<typeof HookTrace>

export const ToolApproval = Type.Union([
  Type.Literal('pending'),
  Type.Literal('allowed'),
  Type.Literal('denied'),
  Type.Literal('cancelled'),
  Type.Literal('expired'),
  Type.Literal('superseded'),
])
export type ToolApproval = Static<typeof ToolApproval>

/**
 * 一次工具调用。durationMs：调用所在 assistant 消息到结果消息（含审批等待与 Hook；同一批并行调用的结果一起提交）；execMs：tool_exec 到结果
 * （只有 side-effect 调用）；approvalWaitMs：已回答的审批等待之和。没有结果（Run 被中断）时没有 durationMs。
 */
export const ToolTrace = Type.Object(
  {
    toolCallId: Id,
    name: Type.String(),
    startedAt: Count,
    durationMs: Type.Optional(Count),
    execMs: Type.Optional(Count),
    isError: Type.Optional(Type.Boolean()),
    approvalWaitMs: Type.Optional(Count),
    approval: Type.Optional(ToolApproval),
    approvalBy: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('hook'), Type.Literal('headless')])),
    hooks: Type.Array(HookTrace),
  },
  strict,
)
export type ToolTrace = Static<typeof ToolTrace>

/**
 * 一个 Run 的追踪：模型请求（含压缩与交接的摘要请求）、工具与不属于某一次调用的 Hook（UserPromptSubmit、Stop 等，以及多个调用同时未结束时
 * 无法归属的工具 Hook）。没有 run_end（被中断或进行中）时没有 status 与 durationMs。tokens = input + output + cacheRead + cacheWrite。
 */
export const RunTrace = Type.Object(
  {
    runId: Id,
    trigger: Type.String(),
    status: Type.Optional(Type.String()),
    errorCode: Type.Optional(Type.String()),
    startedAt: Count,
    durationMs: Type.Optional(Count),
    requests: Type.Array(ModelRequestPayload),
    tools: Type.Array(ToolTrace),
    hooks: Type.Array(HookTrace),
    usage: ModelRequestUsage,
    tokens: Count,
    cost: Type.Number({ minimum: 0 }),
  },
  strict,
)
export type RunTrace = Static<typeof RunTrace>

/** Session 合计（只含本 Session 的条目；durationMs 为已结束 Run 的时长之和）。 */
export const TraceTotals = Type.Object(
  { runs: Count, requests: Count, toolCalls: Count, tokens: Count, cost: Type.Number({ minimum: 0 }), durationMs: Count },
  strict,
)
export type TraceTotals = Static<typeof TraceTotals>

/** GET /api/sessions/:id/trace。 */
export const TraceResponse = Type.Object({ runs: Type.Array(RunTrace), totals: TraceTotals }, strict)
export type TraceResponse = Static<typeof TraceResponse>

const auditBase = { seq: Type.Integer({ minimum: 1 }), at: Count, runId: Type.Optional(Id) }
const audit = <K extends string, P extends Record<string, TSchema>>(kind: K, fields: P) =>
  Type.Object({ ...auditBase, kind: Type.Literal(kind), ...fields }, strict)

/**
 * 审计时间序列中的一项（按提交顺序）。approval 在回答时给出（seq 为决定条目，requestedAt 为请求时刻；by 为 user、hook 或 headless），
 * 没有回答的审批以请求的位置给出 outcome pending。只含结构化字段：不带用户输入、模型输出或交接摘要等正文。
 */
export const AuditEvent = Type.Union([
  audit('approval', {
    requestId: Id,
    toolCallId: Id,
    toolName: Type.String(),
    approvalKind: Type.String(),
    subject: Type.String(),
    requestedAt: Count,
    outcome: Type.String(),
    by: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
  }),
  audit('permission_mode', { mode: Type.String(), prior: Type.Optional(Type.String()) }),
  audit('permission_rule', {
    op: Type.String(),
    rule: Type.Object({ behavior: Type.String(), tool: Type.String(), content: Type.Optional(Type.String()) }, strict),
  }),
  audit('hook', {
    event: Type.String(),
    hookId: Type.String(),
    source: Type.String(),
    plugin: Type.Optional(Type.String()),
    outcome: Type.String(),
    exitCode: Type.Optional(Type.Integer()),
    durationMs: Count,
    message: Type.Optional(Type.String()),
  }),
  audit('confirmation', { toolCallId: Id, answer: Type.String() }),
  audit('schedule_fire', {
    scheduleId: Id,
    occurrence: Count,
    status: Type.String(),
    reason: Type.Optional(Type.String()),
    missed: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
  audit('handoff', { targetSessionId: Id, target: Type.String() }),
  audit('handoff_failed', { errorCode: Type.String() }),
  audit('handoff_origin', { sourceSessionId: Id, sourceSeq: Type.Integer({ minimum: 1 }) }),
  audit('agent_start', {
    agentId: Id,
    agentType: Type.String(),
    background: Type.Boolean(),
    name: Type.Optional(Type.String()),
    teammate: Type.Optional(Type.Boolean()),
  }),
  audit('agent_end', { agentId: Id, status: Type.String() }),
])
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

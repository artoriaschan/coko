// 审计派生（docs/subsystems/tracing.md#审计）：授权决定、权限模式与规则变更、Hook 结果、结果确认、定时投递、交接与子代理 / teammate 的生命周期，
// 按提交顺序。只取结构化字段：不带用户输入、模型输出、交接摘要等正文（command 与 Hook message 已在入库时脱敏）。
import type { TraceEntry } from './trace.ts'

interface AuditBase {
  seq: number
  at: number
  runId?: string
}

export type AuditEvent = AuditBase &
  (
    | {
        kind: 'approval'
        requestId: string
        toolCallId: string
        toolName: string
        approvalKind: string
        /** 审批对象（命令或路径，已脱敏）。 */
        subject: string
        requestedAt: number
        /** pending：没有回答（等待中或 Run 已中断）。 */
        outcome: string
        /** 回答者：user、hook（PermissionRequest Hook）或 headless（无界面运行的自动拒绝）。 */
        by?: string
        scope?: string
      }
    | { kind: 'permission_mode'; mode: string; prior?: string }
    | { kind: 'permission_rule'; op: string; rule: { behavior: string; tool: string; content?: string } }
    | {
        kind: 'hook'
        event: string
        hookId: string
        source: string
        plugin?: string
        outcome: string
        exitCode?: number
        durationMs: number
        message?: string
      }
    | { kind: 'confirmation'; toolCallId: string; answer: string }
    | { kind: 'schedule_fire'; scheduleId: string; occurrence: number; status: string; reason?: string; missed?: number }
    | { kind: 'handoff'; targetSessionId: string; target: string }
    | { kind: 'handoff_failed'; errorCode: string }
    | { kind: 'handoff_origin'; sourceSessionId: string; sourceSeq: number }
    | { kind: 'agent_start'; agentId: string; agentType: string; background: boolean; name?: string; teammate?: boolean }
    | { kind: 'agent_end'; agentId: string; status: string }
  )

export type AuditEventKind = AuditEvent['kind']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>))
const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** 审计时间序列。审批在回答时给出（seq 为决定条目），没有回答的审批以请求条目的位置给出 outcome pending。 */
export function deriveAudit(entries: readonly TraceEntry[]): AuditEvent[] {
  const events: AuditEvent[] = []
  const pending = new Map<string, { entry: TraceEntry; payload: Record<string, unknown> }>()
  const base = (entry: TraceEntry, runId = entry.runId ?? undefined): AuditBase => ({ seq: entry.seq, at: entry.createdAt, ...optional('runId', runId) })
  const approval = (asked: { entry: TraceEntry; payload: Record<string, unknown> }) => ({
    kind: 'approval' as const,
    requestId: String(asked.payload.requestId),
    toolCallId: String(asked.payload.toolCallId),
    toolName: String(asked.payload.toolName),
    approvalKind: String(asked.payload.kind),
    subject: String(asked.payload.subject),
    requestedAt: asked.entry.createdAt,
  })
  for (const entry of entries) {
    const p = entry.payload
    if (!isRecord(p)) continue
    switch (entry.kind) {
      case 'approval_request':
        pending.set(String(p.requestId), { entry, payload: p })
        break
      case 'approval_decision': {
        const asked = pending.get(String(p.requestId))
        if (!asked) break
        pending.delete(String(p.requestId))
        events.push({
          ...base(entry, entry.runId ?? asked.entry.runId ?? undefined),
          ...approval(asked),
          outcome: String(p.outcome),
          by: str(p.by) ?? 'user',
          ...optional('scope', str(p.scope)),
        })
        break
      }
      case 'permission_mode':
        events.push({ ...base(entry), kind: 'permission_mode', mode: String(p.mode), ...optional('prior', str(p.prior)) })
        break
      case 'permission_rule':
        events.push({ ...base(entry), kind: 'permission_rule', op: String(p.op), rule: p.rule as { behavior: string; tool: string; content?: string } })
        break
      case 'hook_run':
        events.push({
          ...base(entry),
          kind: 'hook',
          event: String(p.event),
          hookId: String(p.hookId),
          source: String(p.source),
          ...optional('plugin', str(p.plugin)),
          outcome: String(p.outcome),
          ...optional('exitCode', typeof p.exitCode === 'number' ? p.exitCode : undefined),
          durationMs: typeof p.durationMs === 'number' ? p.durationMs : 0,
          ...optional('message', str(p.message)),
        })
        break
      case 'confirmation_answer':
        events.push({ ...base(entry), kind: 'confirmation', toolCallId: String(p.toolCallId), answer: String(p.answer) })
        break
      case 'schedule_fire':
        events.push({
          ...base(entry, entry.runId ?? str(p.runId)),
          kind: 'schedule_fire',
          scheduleId: String(p.scheduleId),
          occurrence: Number(p.occurrence),
          status: String(p.status),
          ...optional('reason', str(p.reason)),
          ...optional('missed', typeof p.missed === 'number' ? p.missed : undefined),
        })
        break
      case 'handoff':
        events.push({ ...base(entry), kind: 'handoff', targetSessionId: String(p.targetSessionId), target: String(p.target) })
        break
      case 'handoff_failed':
        events.push({ ...base(entry), kind: 'handoff_failed', errorCode: isRecord(p.error) ? String(p.error.code) : 'unknown' })
        break
      case 'handoff_origin':
        events.push({ ...base(entry), kind: 'handoff_origin', sourceSessionId: String(p.sessionId), sourceSeq: Number(p.seq) })
        break
      case 'agent_start':
        events.push({
          ...base(entry),
          kind: 'agent_start',
          agentId: String(p.agentId),
          agentType: String(p.agentType),
          background: p.background === true,
          ...optional('name', str(p.name)),
          ...optional('teammate', typeof p.teammate === 'boolean' ? p.teammate : undefined),
        })
        break
      case 'agent_end':
        events.push({ ...base(entry), kind: 'agent_end', agentId: String(p.agentId), status: String(p.status) })
        break
    }
  }
  for (const asked of pending.values()) events.push({ ...base(asked.entry), ...approval(asked), outcome: 'pending' })
  return events.sort((a, b) => a.seq - b.seq)
}

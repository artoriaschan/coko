// 显式边界分支（ADR 0023）：新 Session 的条目由原 Session 已提交的条目推导。与 Rewind 共用有效上下文与目标校验（checkpoints/）。
import type { RunEntry } from '../engine/types.ts'
import { Value } from 'typebox/value'
import { requestUsageSchema } from '../session-entries/context.ts'
import type { ModelRequestPayload } from '../session-entries/observability.ts'
import type { ForkBoundary, ForkMessageOrigin, ForkOriginPayload } from '../session-entries/checkpoints.ts'
import { RewindTargetError, rewindTarget } from '../checkpoints/rewind.ts'
import { effectiveEntries } from '../entries/index.ts'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'

/**
 * 分叉时复制的条目种类：模型可见消息与 Session 的权限状态（模式、Session 规则）。Goal、Todo、计划与后台任务的条目属于原 Session，
 * 不复制（新 Session 从没有 Goal、Todo 与 Job 开始）。
 */
const FORK_KINDS = new Set(['message', 'permission_mode', 'permission_rule'])

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {})
const metadata = (entries: readonly CheckpointEntry[]) =>
  entries.flatMap((entry) => (entry.kind === 'fork_origin' ? ((entry.payload as ForkOriginPayload).messages ?? []) : []))

/** A successful source Run or an immutable copied-source proof; stop/length alone cannot prove a final reply. */
function replyOrigin(entries: readonly CheckpointEntry[], target: CheckpointEntry): ForkMessageOrigin['reply'] {
  const payload = record(target.payload)
  if (
    target.kind !== 'message' ||
    payload.role !== 'assistant' ||
    !['stop', 'length'].includes(String(payload.stopReason)) ||
    !Array.isArray(payload.content) ||
    !payload.content.some((block) => record(block).type === 'text' && typeof record(block).text === 'string' && String(record(block).text).trim())
  )
    return undefined
  if (!target.runId) return metadata(entries).find((item) => item.seq === target.seq)?.reply
  const end = entries.find((entry) => entry.kind === 'run_end' && entry.runId === target.runId && entry.seq > target.seq)
  const last =
    end &&
    entries.findLast((entry) => entry.seq < end.seq && entry.runId === target.runId && entry.kind === 'message' && record(entry.payload).role === 'assistant')
  if (!end || record(end.payload).status !== 'completed' || last?.seq !== target.seq) return undefined
  const run = entries.filter((entry) => entry.runId === target.runId && entry.seq <= end.seq)
  const requests = run.flatMap((entry) => (entry.kind === 'model_request' ? [entry.payload as ModelRequestPayload] : []))
  const legacy = run.flatMap((entry) => {
    const p = record(entry.payload)
    if (!(entry.kind === 'message' && p.role === 'assistant') && entry.kind !== 'compaction') return []
    if (!Value.Check(requestUsageSchema, p.usage)) return []
    return [{ usage: p.usage, ...(typeof p.provider === 'string' ? { provider: p.provider } : {}), ...(typeof p.model === 'string' ? { model: p.model } : {}) }]
  })
  const endedAt = (end as CheckpointEntry & { createdAt?: number }).createdAt
  return { runId: target.runId, ...(endedAt === undefined ? {} : { endedAt }), requests, legacy }
}

/** Copy effective model context at an explicit boundary; source Run identities remain source-owned. */
export function forkEntries(
  entries: readonly CheckpointEntry[],
  sessionId: string,
  targetSeq: number,
  boundary: ForkBoundary = 'user-before',
): { text: string; entries: RunEntry[] } {
  const effective = effectiveEntries(entries)
  const target = effective.find((entry) => entry.seq === targetSeq)
  const text = boundary === 'user-before' ? rewindTarget(entries, targetSeq).text : ''
  if (boundary === 'assistant-inclusive' && (!target || !replyOrigin(effective, target))) throw new RewindTargetError(targetSeq)
  const prefix = effective.filter((entry) => (boundary === 'assistant-inclusive' ? entry.seq <= targetSeq : entry.seq < targetSeq))
  const compacted = effectiveEntries(prefix, { compacted: true })
  const compaction = compacted.find((entry) => entry.kind === 'compaction')
  const kept = new Set(compacted.map((entry) => entry.seq))
  // Assistant branches inherit the current permission state, even when branching before a later restriction.
  const selected = effective.filter(
    (entry) =>
      FORK_KINDS.has(entry.kind) &&
      (entry.kind === 'message' ? kept.has(entry.seq) && prefix.includes(entry) : boundary === 'assistant-inclusive' || prefix.includes(entry)),
  )
  const copied = selected.map((entry) => ({ kind: entry.kind, payload: entry.payload }) as RunEntry)
  const previous = metadata(entries)
  const hasOrigin = entries.some((entry) => entry.kind === 'fork_origin')
  const firstSeq = compaction ? 3 : 2
  const messages: ForkMessageOrigin[] = selected.flatMap((entry, index) => {
    if (entry.kind !== 'message') return []
    const prior = previous.find((item) => item.seq === entry.seq)
    const createdAt = prior ? prior.createdAt : hasOrigin && !entry.runId ? undefined : (entry as CheckpointEntry & { createdAt?: number }).createdAt
    const reply = replyOrigin(effective, entry)
    return [{ seq: firstSeq + index, sourceSeq: entry.seq, ...(createdAt === undefined ? {} : { createdAt }), ...(reply ? { reply } : {}) }]
  })
  const origin: RunEntry = {
    kind: 'fork_origin',
    payload: { sessionId, seq: targetSeq, ...(boundary === 'assistant-inclusive' ? { boundary, messages } : {}) },
  }
  if (!compaction) return { text, entries: [origin, ...copied] }
  const firstMessage = copied.findIndex((entry) => entry.kind === 'message')
  const firstKeptSeq = firstMessage < 0 ? 3 + copied.length : 3 + firstMessage
  const summary: RunEntry = { kind: 'compaction', payload: { ...(compaction.payload as Extract<RunEntry, { kind: 'compaction' }>['payload']), firstKeptSeq } }
  return { text, entries: [origin, summary, ...copied] }
}

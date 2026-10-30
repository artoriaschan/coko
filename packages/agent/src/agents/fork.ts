// 从此分叉（ADR 0006）：新 Session 的条目由原 Session 已提交的条目推导。与 Rewind 共用有效上下文与目标校验（checkpoints/）。
import type { RunEntry } from '../engine/types.ts'
import { rewindTarget } from '../checkpoints/rewind.ts'
import { effectiveEntries } from '../entries/index.ts'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'

/**
 * 分叉时复制的条目种类：模型可见消息与 Session 的权限状态（模式、Session 规则）。Goal、Todo、计划与后台任务的条目属于原 Session，
 * 不复制（新 Session 从没有 Goal、Todo 与 Job 开始）。
 */
const FORK_KINDS = new Set(['message', 'permission_mode', 'permission_rule'])

/**
 * 从某条用户消息分叉（ADR 0006）：新 Session 的条目为 fork_origin，之后是目标之前的有效消息与权限条目（去掉 runId）。
 * Run 生命周期、审批、执行记录与快照引用不复制：它们的 Run 与锚点属于原 Session；Workspace 文件不复制。
 * 目标之前有压缩时只复制最后一个 compaction 保留的消息（docs/subsystems/context.md#压缩）：compaction 条目紧接 fork_origin、排在复制的
 * 条目之前，firstKeptSeq 指向新 Session 中第一条复制的消息（新 Session 从 seq 1 编号）。新 Session 的模型上下文与原 Session 在目标处
 * 相同；之后回退到任一复制的消息时 compaction 不在被回退的区间内，摘要仍然有效。目标不是有效的用户消息时抛 RewindTargetError。
 */
export function forkEntries(entries: readonly CheckpointEntry[], sessionId: string, targetSeq: number): { text: string; entries: RunEntry[] } {
  const { text } = rewindTarget(entries, targetSeq)
  const prefix = effectiveEntries(entries).filter((entry) => entry.seq < targetSeq)
  const compacted = effectiveEntries(prefix, { compacted: true })
  const compaction = compacted.find((entry) => entry.kind === 'compaction')
  const kept = new Set(compacted.map((entry) => entry.seq))
  const copied = prefix
    .filter((entry) => FORK_KINDS.has(entry.kind) && (entry.kind !== 'message' || kept.has(entry.seq)))
    .map((entry) => ({ kind: entry.kind, payload: entry.payload }) as RunEntry)
  const origin: RunEntry = { kind: 'fork_origin', payload: { sessionId, seq: targetSeq } }
  if (!compaction) return { text, entries: [origin, ...copied] }
  // 新 Session 的 seq：fork_origin 为 1、compaction 为 2，复制的条目从 3 开始。
  const firstMessage = copied.findIndex((entry) => entry.kind === 'message')
  const firstKeptSeq = firstMessage < 0 ? 3 + copied.length : 3 + firstMessage
  const summary: RunEntry = { kind: 'compaction', payload: { ...(compaction.payload as Extract<RunEntry, { kind: 'compaction' }>['payload']), firstKeptSeq } }
  return { text, entries: [origin, summary, ...copied] }
}

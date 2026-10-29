// 从此分叉（ADR 0006）：新 Session 的条目由原 Session 已提交的条目推导。与 Rewind 共用有效上下文与目标校验（checkpoints/）。
import type { RunEntry } from '../engine/types.ts'
import { rewindTarget } from '../checkpoints/rewind.ts'
import { effectiveEntries } from '../entries/index.ts'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'

/** 分叉时复制的条目种类：模型可见消息与 Session 的权限状态（模式、Session 规则）。 */
const FORK_KINDS = new Set(['message', 'permission_mode', 'permission_rule'])

/**
 * 从某条用户消息分叉（ADR 0006）：新 Session 的条目为 fork_origin，之后是目标之前的有效消息与权限条目（去掉 runId）。
 * Run 生命周期、审批、执行记录与快照引用不复制：它们的 Run 与锚点属于原 Session；Workspace 文件不复制。
 * 目标之前有压缩时（grilling F6）只复制最后一个 compaction 保留的消息，compaction 条目排在它们之后、firstKeptSeq 改为 1（新 Session
 * 重新编号）：新 Session 的模型上下文与原 Session 在目标处相同。目标不是有效的用户消息时抛 RewindTargetError。
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
  const summary: RunEntry[] = compaction
    ? [{ kind: 'compaction', payload: { ...(compaction.payload as Extract<RunEntry, { kind: 'compaction' }>['payload']), firstKeptSeq: 1 } }]
    : []
  return { text, entries: [{ kind: 'fork_origin', payload: { sessionId, seq: targetSeq } }, ...copied, ...summary] }
}

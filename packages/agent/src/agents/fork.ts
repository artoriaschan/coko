// 从此分叉（ADR 0006）：新 Session 的条目由原 Session 已提交的条目推导。与 Rewind 共用有效上下文与目标校验（checkpoints/）。
import type { RunEntry } from '../engine/types.ts'
import { effectiveEntries, rewindTarget } from '../checkpoints/rewind.ts'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'

/** 分叉时复制的条目种类：模型可见消息与 Session 的权限状态（模式、Session 规则）。 */
const FORK_KINDS = new Set(['message', 'permission_mode', 'permission_rule'])

/**
 * 从某条用户消息分叉（ADR 0006）：新 Session 的条目为 fork_origin，之后是目标之前的有效消息与权限条目（去掉 runId）。
 * Run 生命周期、审批、执行记录与快照引用不复制：它们的 Run 与锚点属于原 Session；Workspace 文件不复制。
 * 目标不是有效的用户消息时抛 RewindTargetError。
 */
export function forkEntries(entries: readonly CheckpointEntry[], sessionId: string, targetSeq: number): { text: string; entries: RunEntry[] } {
  const { text } = rewindTarget(entries, targetSeq)
  const copied = effectiveEntries(entries)
    .filter((entry) => entry.seq < targetSeq && FORK_KINDS.has(entry.kind))
    .map((entry) => ({ kind: entry.kind, payload: entry.payload }) as RunEntry)
  return { text, entries: [{ kind: 'fork_origin', payload: { sessionId, seq: targetSeq } }, ...copied] }
}

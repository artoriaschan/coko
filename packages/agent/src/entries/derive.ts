// 条目派生的唯一实现（M3 评审 S2）：有效条目（回退与压缩）、上一 Run 状态、未回答的结果确认与模型上下文。
// server、renderer 与 agent 内部都从这里导入。纯函数，泛型于 { seq, kind, payload, runId }。
import type { CompactionFields, ContextMessage, EntryLike, EntryRunStatus, RewoundRange, UnansweredConfirmation } from './types.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** 全部 rewind 条目的区间（按 rewind 条目顺序）。 */
export function rewoundRanges(entries: readonly EntryLike[]): RewoundRange[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== 'rewind' || !isRecord(entry.payload) || typeof entry.payload.targetSeq !== 'number') return []
    return [{ from: entry.payload.targetSeq, to: entry.seq }]
  })
}

export interface EffectiveOptions {
  /**
   * 同时应用压缩：最后一个有效 compaction 之前（firstKeptSeq 之前）的条目与更早的 compaction 不再有效，该 compaction 条目本身保留
   * （模型上下文把它变成合成摘要消息）。缺省 false：只应用回退（Checkpoint 列表、分叉与时间线仍能看到压缩之前的消息）。
   */
  compacted?: boolean
}

/**
 * 有效条目：不在任何被回退区间内、且不是 rewind 条目本身（ADR 0006）。compacted 时再应用最后一个有效的 compaction：
 * 落在被回退区间内的 compaction 不生效（原历史恢复）。
 */
export function effectiveEntries<E extends EntryLike>(entries: readonly E[], options: EffectiveOptions = {}): E[] {
  const ranges = rewoundRanges(entries)
  const rewound =
    ranges.length === 0 ? [...entries] : entries.filter((entry) => entry.kind !== 'rewind' && !ranges.some((r) => entry.seq >= r.from && entry.seq < r.to))
  if (!options.compacted) return rewound
  const last = lastCompaction(rewound)
  if (!last) return rewound
  const { firstKeptSeq } = last.payload as CompactionFields
  return rewound.filter((entry) => entry === last || (entry.kind !== 'compaction' && entry.seq >= firstKeptSeq))
}

/** 有效条目中最后一个合格的 compaction 条目。 */
function lastCompaction<E extends EntryLike>(entries: readonly E[]): E | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind !== 'compaction' || !isRecord(entry.payload)) continue
    if (typeof entry.payload.summary === 'string' && typeof entry.payload.firstKeptSeq === 'number') return entry
  }
  return undefined
}

/** 有效上下文中最后一条 run_end 的状态（被回退的 Run 不算）；没有结束的 Run 时为 undefined。 */
export function lastRunStatus(entries: readonly EntryLike[]): EntryRunStatus | undefined {
  const effective = effectiveEntries(entries)
  for (let i = effective.length - 1; i >= 0; i--) {
    const entry = effective[i]!
    if (entry.kind === 'run_end' && isRecord(entry.payload)) return entry.payload.status as EntryRunStatus
  }
  return undefined
}

/** 有 confirmation_request、还没有 confirmation_answer 的调用（按请求顺序），带请求所属的 runId。 */
export function unansweredConfirmations(entries: readonly EntryLike[]): UnansweredConfirmation[] {
  const asked = new Map<string, string | null>()
  for (const entry of entries) {
    const toolCallId = isRecord(entry.payload) ? entry.payload.toolCallId : undefined
    if (typeof toolCallId !== 'string') continue
    if (entry.kind === 'confirmation_request') asked.set(toolCallId, entry.runId ?? null)
    else if (entry.kind === 'confirmation_answer') asked.delete(toolCallId)
  }
  return [...asked].map(([toolCallId, runId]) => ({ toolCallId, runId }))
}

/** 合成摘要消息的前后缀（模型看到的压缩边界）。 */
export const COMPACTION_SUMMARY_PREFIX = 'The conversation history before this point was compacted into the following summary:\n\n<summary>\n'
export const COMPACTION_SUMMARY_SUFFIX = '\n</summary>'

/** compaction 条目对应的合成摘要消息（user 角色，时间戳为 0：不来自任何一次提交）。 */
export function compactionSummaryMessage(summary: string): ContextMessage {
  return { role: 'user', content: [{ type: 'text', text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX }], timestamp: 0 }
}

/**
 * 有效条目 → 模型消息：回退与压缩都应用；有压缩时为合成摘要消息 + firstKeptSeq 及之后的 message payload，否则为全部有效 message。
 */
export function modelContext(entries: readonly EntryLike[]): ContextMessage[] {
  const effective = effectiveEntries(entries, { compacted: true })
  // compaction 条目在被保留的消息之后提交，摘要却位于它们之前。
  const compaction = effective.find((entry) => entry.kind === 'compaction')
  const messages = effective.flatMap((entry) => (entry.kind === 'message' ? [entry.payload as ContextMessage] : []))
  return compaction ? [compactionSummaryMessage((compaction.payload as CompactionFields).summary), ...messages] : messages
}

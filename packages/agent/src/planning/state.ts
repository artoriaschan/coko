// Plan Mode 的条目派生（纯函数）：下一次提交的 planId 与 revision、计划修订历史、压缩后需要再注入的已批准计划。计划阶段见 entries/plan-phase.ts。
// 只依赖条目的最小形状（EntryLike），server 与测试共用。
import { randomUUID } from 'node:crypto'
import { effectiveEntries } from '../entries/derive.ts'
import type { EntryLike } from '../entries/types.ts'
import type { PlanPayload } from '../session-entries/index.ts'

const isPlan = (entry: EntryLike): entry is EntryLike & { payload: PlanPayload } => entry.kind === 'plan'

/** 这些状态之后再提交的计划是一份新计划。 */
const ENDED: ReadonlySet<string> = new Set(['approved', 'completed', 'abandoned'])

/** 一次提交的计划在条目中的位置。 */
export interface PlanRef {
  planId: string
  revision: number
}

/**
 * 下一次 exit_plan_mode 的 planId 与 revision（有效条目，回退的区间不算）：本次规划（最近一条 plan_phase planning 之后）已有未批准的计划时
 * 沿用其 planId、revision 加一；否则（还没有计划、上一份已批准 / 完成 / 放弃、或之后重新进入了规划）新建 planId，revision 为 1。
 */
export function nextPlanRef(entries: readonly EntryLike[], newId: () => string = randomUUID): PlanRef {
  const effective = effectiveEntries(entries)
  for (let i = effective.length - 1; i >= 0; i--) {
    const entry = effective[i]!
    if (isPlan(entry))
      return ENDED.has(entry.payload.status) ? { planId: newId(), revision: 1 } : { planId: entry.payload.planId, revision: entry.payload.revision + 1 }
    if (entry.kind === 'plan_phase' && (entry.payload as { phase: string }).phase === 'planning') break
  }
  return { planId: newId(), revision: 1 }
}

/** 某个 planId 的最新一条 plan 条目（有效条目）。 */
export function latestPlan(entries: readonly EntryLike[], planId?: string): PlanPayload | undefined {
  const effective = effectiveEntries(entries)
  for (let i = effective.length - 1; i >= 0; i--) {
    const entry = effective[i]!
    if (isPlan(entry) && (planId === undefined || entry.payload.planId === planId)) return entry.payload
  }
  return undefined
}

/**
 * 压缩后需要再注入的已批准计划：最新一条 approved 的 plan 条目早于最后一个有效 compaction 的 firstKeptSeq（已被摘要掉）时返回其 markdown；
 * 没有压缩、计划仍在保留的消息中或没有已批准的计划时 undefined。
 */
export function approvedPlanToReinject(entries: readonly EntryLike[]): string | undefined {
  const effective = effectiveEntries(entries)
  let approved: (EntryLike & { payload: PlanPayload }) | undefined
  let firstKeptSeq: number | undefined
  for (let i = effective.length - 1; i >= 0; i--) {
    const entry = effective[i]!
    if (!approved && isPlan(entry) && entry.payload.status === 'approved') approved = entry
    if (firstKeptSeq === undefined && entry.kind === 'compaction') {
      const seq = (entry.payload as { firstKeptSeq?: unknown }).firstKeptSeq
      if (typeof seq === 'number') firstKeptSeq = seq
    }
    if (approved && firstKeptSeq !== undefined) break
  }
  return approved && firstKeptSeq !== undefined && approved.seq < firstKeptSeq ? approved.payload.markdown : undefined
}

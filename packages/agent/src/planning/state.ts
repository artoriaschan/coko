// Plan Mode 的条目派生（纯函数）：下一次提交的 planId 与 revision、计划修订历史、压缩后需要再注入的已批准计划、进入 plan 之前的模式。
// 只依赖条目的最小形状（EntryLike），server 与测试共用。
import { randomUUID } from 'node:crypto'
import { effectiveEntries } from '../entries/derive.ts'
import type { EntryLike } from '../entries/types.ts'
import type { PlanPayload, PermissionModePayload } from '../session-entries/index.ts'

const isPlan = (entry: EntryLike): entry is EntryLike & { payload: PlanPayload } => entry.kind === 'plan'
const isMode = (entry: EntryLike): entry is EntryLike & { payload: PermissionModePayload } => entry.kind === 'permission_mode'

/** 一次提交的计划在条目中的位置。 */
export interface PlanRef {
  planId: string
  revision: number
}

/**
 * 下一次 exit_plan_mode 的 planId 与 revision（有效条目，回退的区间不算）：本次规划（最近一次进入 plan 之后）已有未批准的计划时沿用其
 * planId、revision 加一；否则（还没有计划、上一份已批准、或之后重新进入了 plan）新建 planId，revision 为 1。
 */
export function nextPlanRef(entries: readonly EntryLike[], newId: () => string = randomUUID): PlanRef {
  const effective = effectiveEntries(entries)
  for (let i = effective.length - 1; i >= 0; i--) {
    const entry = effective[i]!
    if (isPlan(entry))
      return entry.payload.status === 'approved' ? { planId: newId(), revision: 1 } : { planId: entry.payload.planId, revision: entry.payload.revision + 1 }
    if (isMode(entry) && entry.payload.mode === 'plan') break
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

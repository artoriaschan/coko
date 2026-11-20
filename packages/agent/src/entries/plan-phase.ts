// 计划阶段与活动 Plan 的派生（ADR 0028）：server、renderer 与 planning/ 共用。浏览器安全：只依赖本目录；
// 形状与 session-entries/planning.ts 的 plan_phase、plan 当前版本相同（这里不导入它，见 entries.test.ts 的导入守卫）。
import { effectiveEntries } from './derive.ts'
import type { EntryLike } from './types.ts'

export type PlanPhaseState = { phase: 'none' } | { phase: 'planning' } | { phase: 'executing'; planId: string }

export interface PlanState {
  planId: string
  revision: number
  markdown: string
  status: 'proposed' | 'approved' | 'rejected' | 'completed' | 'abandoned'
  feedback?: string
  report?: string
}

/** 当前计划阶段：有效条目（只应用回退）中最后一条 plan_phase；没有时 none。 */
export function planPhaseOf(entries: readonly EntryLike[]): PlanPhaseState {
  return (effectiveEntries(entries).findLast((entry) => entry.kind === 'plan_phase')?.payload as PlanPhaseState | undefined) ?? { phase: 'none' }
}

/**
 * 活动的 Plan：规划中为本次规划（最后一条进入规划之后）最后一条 plan，且它为 proposed；执行中为阶段 planId 的最后一条 plan；
 * 其余为 undefined。
 */
export function activePlanOf(entries: readonly EntryLike[]): PlanState | undefined {
  const effective = effectiveEntries(entries)
  const at = effective.findLastIndex((entry) => entry.kind === 'plan_phase')
  const current = (effective[at]?.payload as PlanPhaseState | undefined) ?? { phase: 'none' }
  if (current.phase === 'none') return undefined
  const plans = effective
    .filter((entry, index) => entry.kind === 'plan' && (current.phase === 'executing' || index > at))
    .map((entry) => entry.payload as PlanState)
  if (current.phase === 'executing') return plans.findLast((plan) => plan.planId === current.planId)
  const last = plans.at(-1)
  return last?.status === 'proposed' ? last : undefined
}

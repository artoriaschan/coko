// Goal 预算的派生（ADR 0011：用量从条目计算，不另存计数器；docs/subsystems/goal.md#预算）。属于 Goal 的 Run：Goal 处于非终态且非 paused 时
// 开始的 Run（含用户提交的），以及该 Goal 的 Goal Round。轮次 = Goal Round 数；工具调用 = 这些 Run 的 toolResult 数（工具调用上限拦下的错误
// 结果除外，按 details.hostBlock 识别）；Token = assistant usage 的 input + output + cacheRead + cacheWrite 加 compaction.usage；费用 = 同一组 usage 的 cost.total；
// 时间 = 各 Run run_end.createdAt − run_start.createdAt 之和（进行中的 Run 计到 now）。handoff 条目的 usage 与 compaction 相同，计入其 Run。子 Session 的条目（M5 接入）整体计入，不计轮次。
import type { EntryLike } from '../entries/types.ts'
import type { GoalPayload } from '../session-entries/goals.ts'
import { goalRounds, isTerminalPhase, type GoalUsageSnapshot } from './state.ts'

/** 派生用到的条目：另带提交时间（毫秒）。结构上与 @coko/session 的 SessionEntry 相容。 */
export interface BudgetEntry extends EntryLike {
  createdAt: number
}

/** 五维全部派生的用量。 */
export type GoalUsageTotals = Required<GoalUsageSnapshot>

type UsageLike = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const tokensOf = (usage: UsageLike) => num(usage.input) + num(usage.output) + num(usage.cacheRead) + num(usage.cacheWrite)

/** 按时间线判定属于该 Goal 的 Run：run_start 时 Goal 已存在且处于非终态、非 paused，或该 Run 是这个 Goal 的 Goal Round。 */
export function goalRunIds(entries: readonly EntryLike[], goalId: string): Set<string> {
  const runs = new Set<string>()
  let phase: GoalPayload['phase'] | undefined
  for (const entry of entries) {
    if (entry.kind === 'goal') {
      const goal = entry.payload as GoalPayload
      phase = goal.id === goalId ? goal.phase : undefined
      continue
    }
    if (entry.kind !== 'run_start' || !entry.runId) continue
    const own = (entry.payload as { goal?: { goalId: string } }).goal?.goalId === goalId
    if (own || (phase !== undefined && !isTerminalPhase(phase) && phase !== 'paused')) runs.add(entry.runId)
  }
  return runs
}

/** 一组 Run 的工具调用、Token、费用与时间；runs 省略时计入全部 Run（子 Session）。 */
function runTotals(entries: readonly BudgetEntry[], runs: ReadonlySet<string> | undefined, now: number): Omit<GoalUsageTotals, 'rounds'> {
  const totals = { toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 }
  const started = new Map<string, number>()
  const member = (runId: string | null | undefined): runId is string => !!runId && (runs === undefined || runs.has(runId))
  for (const entry of entries) {
    if (!member(entry.runId)) continue
    const runId = entry.runId
    switch (entry.kind) {
      case 'run_start':
        started.set(runId, entry.createdAt)
        break
      case 'run_end': {
        const at = started.get(runId)
        if (at !== undefined) totals.durationMs += Math.max(0, entry.createdAt - at)
        started.delete(runId)
        break
      }
      // 摘要请求的 usage：压缩与交接（trigger handoff 的 Run 不提交消息，只在 handoff 条目上记 usage）。
      case 'compaction':
      case 'handoff':
      case 'handoff_failed': {
        const usage = (entry.payload as { usage?: UsageLike }).usage
        if (usage) {
          totals.tokens += tokensOf(usage)
          totals.cost += num(usage.cost?.total)
        }
        break
      }
      case 'message': {
        const message = entry.payload as { role?: string; usage?: UsageLike; details?: unknown }
        if (message.role === 'assistant' && message.usage) {
          totals.tokens += tokensOf(message.usage)
          totals.cost += num(message.usage.cost?.total)
        } else if (message.role === 'toolResult' && !isBudgetBlocked(message)) totals.toolCalls++
        break
      }
    }
  }
  // 进行中的 Run（没有 run_end）计到 now。
  for (const at of started.values()) totals.durationMs += Math.max(0, now - at)
  return totals
}

/**
 * 工具调用上限拦下的调用：它没有执行，不计为一次调用。只认运行时写入的结构化标记 details.hostBlock（工具自身给出的会被运行时去掉），
 * 不看结果文本：命令输出可以伪造任何文字。
 */
function isBudgetBlocked(message: { details?: unknown }): boolean {
  const mark = (message.details as { hostBlock?: { by?: unknown } } | null | undefined)?.hostBlock
  return mark?.by === 'goal-budget'
}

export interface GoalUsageOptions {
  /** 进行中的 Run 计到这一时刻；缺省 Date.now()。 */
  now?: number
  /** 子 Session 的条目（M5 接入；M4 没有调用方）：全部 Run 计入，不计轮次。 */
  children?: readonly (readonly BudgetEntry[])[]
}

/** 该 Goal 的五维用量。 */
export function goalUsage(entries: readonly BudgetEntry[], goalId: string, options: GoalUsageOptions = {}): GoalUsageTotals {
  const now = options.now ?? Date.now()
  const own = runTotals(entries, goalRunIds(entries, goalId), now)
  const usage: GoalUsageTotals = { rounds: goalRounds(entries, goalId), ...own }
  for (const child of options.children ?? []) {
    const part = runTotals(child, undefined, now)
    usage.toolCalls += part.toolCalls
    usage.tokens += part.tokens
    usage.cost += part.cost
    usage.durationMs += part.durationMs
  }
  return usage
}

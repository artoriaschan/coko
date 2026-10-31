// Goal Round 的发起（ADR 0011，docs/subsystems/goal.md#推进）：Run 结束或等待的 Job 结束之后，若 Goal 为 running、Session 空闲、没有未送达的
// 用户追加指令且轮次有余量，则经 session-runs 的统一入口以 trigger goal 开始下一轮。调用方（GoalService）在该 Session 的锁内调用，
// 因此同一 Session 的推进串行；每次开始前重读 Goal，轮次取已提交的 run_start 中最大的 round 加一（同一轮不会发起两次）。
import {
  applyGoalChange,
  COST_UNPRICED_MESSAGE,
  currentGoal,
  exhaustedDimension,
  exhaustedMessage,
  goalRoundText,
  goalUsage,
  type GoalChange,
  type GoalPayload,
} from '@coko/agent'
import { isHostNotificationText } from '@coko/agent/entries'
import { getLogger } from '@coko/logging'
import type { SessionEntry as StoredEntry } from '@coko/session'
import { AppError } from './errors.ts'
import type { RunRequest } from './context/types.ts'

const log = getLogger(['application', 'goals'])

/** 推进需要的宿主能力（GoalService 提供）。 */
export interface GoalDriverHost {
  entries(sessionId: string): Promise<readonly StoredEntry[]>
  commit(sessionId: string, goal: GoalPayload): Promise<GoalPayload>
  isRunning(sessionId: string): boolean
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }>
  /** 该 Session 的模型是否已定价（设了费用上限时）。 */
  priced(sessionId: string): Promise<boolean>
  /** 该 Session 的 Goal 正在取消：不发起 Goal Round。 */
  isCancelling(sessionId: string): boolean
}

/**
 * Run 结束时退回的追加指令中是否有用户写的（有时不发起下一轮：它们回到输入区，等用户处理）。宿主通知（Job 与后台子代理的结束通知）
 * 不算用户的追加指令：它们由各自的服务重新挂起到下一个 Run。
 */
export const hasUserSteering = (undelivered: readonly string[] | undefined) => (undelivered ?? []).some((text) => !isHostNotificationText(text))

/** Goal Round 没能开始时的转换；undefined 表示 Goal 保持 running。 */
function notStartedChange(error: AppError): GoalChange | undefined {
  const reason = { code: error.code, message: error.message }
  if (error.code === 'model-not-configured' || error.code === 'model-required') return { type: 'block', reason }
  if (error.code === 'confirmation-pending') return { type: 'wait-input', reason }
  return undefined
}

export class GoalDriver {
  readonly #host: GoalDriverHost
  /** 正在发起 Goal Round 的 Session：其 Run 开始时的工具取值据此不注册 create_goal。 */
  readonly #starting = new Set<string>()

  constructor(host: GoalDriverHost) {
    this.#host = host
  }

  /** 该 Session 正在发起 Goal Round（工具取值期间为 true）。 */
  starting(sessionId: string): boolean {
    return this.#starting.has(sessionId)
  }

  /**
   * 在锁内调用：条件满足时开始下一轮，返回开始的 runId；不满足时 undefined。开始前检查五维：任一维度用尽时提交 budget-exhausted（reason
   * 为该维度）；设了费用上限而模型未定价时提交 blocked（cost-unpriced），都不开始 Run。用户先开始了 Run
   * （run-in-progress）或回退、分叉进行中时放弃这次发起。
   */
  async advance(sessionId: string): Promise<string | undefined> {
    const host = this.#host
    if (host.isRunning(sessionId) || host.isCancelling(sessionId)) return undefined
    const entries = await host.entries(sessionId)
    const goal = currentGoal(entries)
    if (!goal || goal.phase !== 'running') return undefined
    const usage = goalUsage(entries, goal.id)
    const rounds = usage.rounds
    const dimension = exhaustedDimension(goal.budget, usage)
    if (dimension) {
      await host.commit(
        sessionId,
        applyGoalChange(goal, { type: 'exhaust', reason: { code: dimension, message: exhaustedMessage(dimension, goal.budget, usage) } }, 'system', usage),
      )
      log.info('goal budget exhausted', { sessionId, goalId: goal.id, dimension })
      return undefined
    }
    if (goal.budget.maxCost !== undefined && !(await host.priced(sessionId))) {
      await host.commit(sessionId, applyGoalChange(goal, { type: 'block', reason: { code: 'cost-unpriced', message: COST_UNPRICED_MESSAGE } }, 'system', usage))
      log.info('goal blocked: model has no price', { sessionId, goalId: goal.id })
      return undefined
    }
    const round = rounds + 1
    this.#starting.add(sessionId)
    try {
      const { runId } = await host.startRun(sessionId, { trigger: 'goal', input: { text: goalRoundText(goal, round) }, goal: { goalId: goal.id, round } })
      log.info('goal round started', { sessionId, goalId: goal.id, round, runId })
      return runId
    } catch (error) {
      if (!(error instanceof AppError)) {
        log.warn('goal round failed to start', { sessionId, goalId: goal.id, round, error: error instanceof Error ? error.message : String(error) })
        return undefined
      }
      log.info('goal round not started', { sessionId, goalId: goal.id, round, code: error.code })
      // 用户的 Run 优先、回退或分叉进行中：Goal 保持 running，那个 Run（或操作之后的下一个 Run）结束后再判定。其余不会自然再判定的原因
      // 不让 Goal 停在 running：模型不可用为 blocked，结果确认待回答为 waiting-input（用户回答并提交后的 Run 结束时唤醒）。
      const change = notStartedChange(error)
      if (change) await host.commit(sessionId, applyGoalChange(goal, change, 'system', usage))
      return undefined
    } finally {
      this.#starting.delete(sessionId)
    }
  }
}

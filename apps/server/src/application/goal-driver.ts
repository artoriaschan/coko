// Goal Round 的发起（ADR 0011，docs/subsystems/goal.md#推进）：Run 结束或等待的 Job 结束之后，若 Goal 为 running、Session 空闲、没有未送达的
// 用户追加指令且轮次有余量，则经 session-runs 的统一入口以 trigger goal 开始下一轮。调用方（GoalService）在该 Session 的锁内调用，
// 因此同一 Session 的推进串行；每次开始前重读 Goal，轮次取已提交的 run_start 中最大的 round 加一（同一轮不会发起两次）。
import { applyGoalChange, currentGoal, exhaustedDimension, exhaustedMessage, goalRounds, goalRoundText, type GoalPayload } from '@coko/agent'
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
}

/** Job 的完成通知以这个标签开头（宿主生成）；Run 结束时退回的通知不算用户的追加指令。 */
const JOB_NOTIFICATION = '<job-notification>'

/** Run 结束时退回的追加指令中是否有用户写的（有时不发起下一轮：它们回到输入区，等用户处理）。 */
export const hasUserSteering = (undelivered: readonly string[] | undefined) => (undelivered ?? []).some((text) => !text.startsWith(JOB_NOTIFICATION))

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
   * 在锁内调用：条件满足时开始下一轮，返回开始的 runId；不满足时 undefined。轮次用尽时提交 budget-exhausted（rounds）。用户先开始了 Run
   * （run-in-progress）或回退、分叉进行中时放弃这次发起。
   */
  async advance(sessionId: string): Promise<string | undefined> {
    const host = this.#host
    if (host.isRunning(sessionId)) return undefined
    const entries = await host.entries(sessionId)
    const goal = currentGoal(entries)
    if (!goal || goal.phase !== 'running') return undefined
    const rounds = goalRounds(entries, goal.id)
    const dimension = exhaustedDimension(goal.budget, { rounds })
    if (dimension) {
      await host.commit(
        sessionId,
        applyGoalChange(
          goal,
          { type: 'exhaust', reason: { code: dimension, message: exhaustedMessage(dimension, goal.budget, { rounds }) } },
          'system',
          rounds,
        ),
      )
      log.info('goal budget exhausted', { sessionId, goalId: goal.id, dimension })
      return undefined
    }
    const round = rounds + 1
    this.#starting.add(sessionId)
    try {
      const { runId } = await host.startRun(sessionId, { trigger: 'goal', input: { text: goalRoundText(goal, round) }, goal: { goalId: goal.id, round } })
      log.info('goal round started', { sessionId, goalId: goal.id, round, runId })
      return runId
    } catch (error) {
      // 用户的 Run 优先；结果确认、回退或分叉、模型未配置时不推进（Goal 保持 running，下一次 Run 结束后再判定）。
      if (error instanceof AppError) log.info('goal round not started', { sessionId, goalId: goal.id, round, code: error.code })
      else log.warn('goal round failed to start', { sessionId, goalId: goal.id, round, error: error instanceof Error ? error.message : String(error) })
      return undefined
    } finally {
      this.#starting.delete(sessionId)
    }
  }
}

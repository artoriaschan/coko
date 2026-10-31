// Goal（ADR 0011，docs/subsystems/goal.md）：读写 goal 快照条目（每次变化一条完整快照，revision 递增）、用户的动作（暂停、恢复、编辑、标为
// 完成、取消与停止传播）、模型的 Goal 工具端口、Run 结束与 Job 结束后的阶段转换与推进（goal-driver.ts），以及启动恢复（重启后暂停）。
// 同一 Session 的 Goal 变化与推进经同一把锁串行；等待 Run 结束（取消）不持锁。runtime/layers.ts 装配一次。
import {
  applyGoalChange,
  COST_UNPRICED_MESSAGE,
  currentGoal,
  exhaustedDimension,
  exhaustedMessage,
  expectRevision,
  GoalError,
  goalRounds,
  goalRunIds,
  goalSection,
  goalUsage,
  goalView,
  isActivePhase,
  isTerminalPhase,
  planGoalCreate,
  planGoalUpdate,
  runAuthority,
  type GoalBudgetDimension as AgentGoalBudgetDimension,
  type GoalChange,
  type GoalPayload,
  type GoalToolPort,
  type JobEndPayload,
  type RunError,
  type RunResult,
  type SystemSection,
  type ToolBlockResult,
  type ToolHooks,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { GoalActionRequest, GoalBudgetDimension, GoalResponse, KnownGoalReasonCode } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import { AppError, errorMessage } from './errors.ts'
import type { RunEndInfo, RunRequest } from './context/types.ts'
import { GoalDriver, hasUserSteering } from './goal-driver.ts'
import type { JobService } from './jobs.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import type { RecoverySource } from './recovery.ts'
import type { SessionHub } from './hub.ts'
import { requireSession, toNewEntry } from './session-runtimes.ts'

const log = getLogger(['application', 'goals'])

// 预算维度在 agent 的描述表与协议的 GOAL_BUDGET_DIMENSION_KEYS 中各有一份（agent 不依赖 protocol）：两边的键必须相同。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type GoalBudgetDimensionsAgree = Assert<Equal<GoalBudgetDimension, AgentGoalBudgetDimension>>

/** 取消时等待进行中的 Run 结束的上限；超出记入 cleanup.failures，不阻止取消。 */
const CANCEL_RUN_WAIT_MS = 30_000

/** GoalService 需要的 Run 能力（runtime/layers.ts 以 SessionService 实现）：Goal Round 经统一入口开始，取消与暂停经它停止 Run。 */
export interface GoalRunHost {
  /** 该 Session 进行中的 Run 的 runId；没有时 undefined。 */
  activeRunId(sessionId: string): string | undefined
  /** 进行中的 Run 本批完成后以 paused 加该 error 结束；没有进行中的 Run 时 false。 */
  stopAfterBatch(sessionId: string, error: RunError): boolean
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }>
  /** 该 Session 当前（或将用的默认）模型是否已定价。 */
  modelPriced(sessionId: string): Promise<boolean>
  isRunning(sessionId: string): boolean
  /** 返回是否确有进行中的 Run 被要求停止。 */
  abort(sessionId: string): Promise<boolean>
  pause(sessionId: string): Promise<void>
}

/**
 * 子代理对 Goal 的接线（SubagentService，装配时 useSubagents）：取消 Goal 时停止它的 Run 派发的全部子代理（等待 agent_end），返回停止的数量。
 */
export interface GoalSubagents {
  stopForGoal(sessionId: string, goalId: string): Promise<number>
}

/** 根 Session 的 agent_start 条目给出的、属于该 Goal 的子 Session（派发它的 Run 属于该 Goal）。 */
function childSessionIds(entries: readonly StoredEntry[], goalId: string): string[] {
  const runs = goalRunIds(entries, goalId)
  return entries
    .filter((e) => e.kind === 'agent_start' && ((e.payload as { goalId?: string }).goalId === goalId || (e.runId !== null && runs.has(e.runId))))
    .map((e) => (e.payload as { agentId: string }).agentId)
}

export interface GoalServiceOptions {
  store: SessionStore
  /** Session 的条目推送（goal 快照）与订阅（run_end、job_end、审批）。 */
  hub: SessionHub
  jobs: JobService
  runs: GoalRunHost
}

/** GoalError → 协议错误（HTTP 与 /goal 动作）。 */
export function toGoalAppError(error: GoalError): AppError {
  switch (error.code) {
    case 'revision-conflict':
      return new AppError('revision-conflict', error.message, error.details)
    case 'invalid-transition':
      return new AppError('invalid-transition', error.message, error.details)
    case 'not-found':
      return new AppError('not-found', error.message)
    case 'already-exists':
      return new AppError('already-exists', error.message, error.details)
    case 'not-authorized':
      return new AppError('forbidden', error.message)
    case 'invalid-argument':
      return new AppError('bad-request', error.message)
  }
}

const rethrow = (error: unknown): never => {
  throw error instanceof GoalError ? toGoalAppError(error) : error
}

export class GoalService {
  readonly #options: GoalServiceOptions
  readonly #driver: GoalDriver
  /** 同一 Session 的 Goal 变化串行（前一个失败不影响后一个）。 */
  readonly #locks = new KeyedMutex()
  /** 正在取消的 Session：Run 结束、Job 结束与模型的工具调用都不再改变 Goal。 */
  readonly #cancelling = new Set<string>()
  /** 有推进中（running / waiting-*）Goal 的 Session 的 job_end 订阅。 */
  readonly #watches = new Map<string, () => void>()
  /** 工具调用上限：每个 Session 当前 Run 已放行、结果尚未提交的调用（同一批的调用先放行、后提交结果）。 */
  readonly #admitted = new Map<string, { runId: string; ids: Set<string> }>()
  /** 工具调用前检查按 Session 串行（同一批的调用并发进入 hook）。 */
  readonly #toolCallLocks = new KeyedMutex()
  #subagents: GoalSubagents | undefined

  constructor(options: GoalServiceOptions) {
    this.#options = options
    this.#driver = new GoalDriver({
      entries: (sessionId) => this.#entries(sessionId),
      commit: (sessionId, goal) => this.#commit(sessionId, goal),
      isRunning: (sessionId) => options.runs.isRunning(sessionId),
      startRun: (sessionId, request) => options.runs.startRun(sessionId, request),
      priced: (sessionId) => this.#priced(sessionId),
      isCancelling: (sessionId) => this.#cancelling.has(sessionId),
    })
    // 之后启动的 Job 记下 Session 当时未终结的 Goal（取消该 Goal 时终止它们）。
    options.jobs.useGoals(async (sessionId) => {
      const goal = currentGoal(await this.#entries(sessionId))
      return goal && !isTerminalPhase(goal.phase) ? goal.id : undefined
    })
  }

  /** 装配时接上子代理（取消 Goal 时停止其子代理）。 */
  useSubagents(subagents: GoalSubagents): void {
    this.#subagents = subagents
  }

  /**
   * 该 Session 的当前 Goal（非终态、非 paused）已用尽的预算维度；没有时 undefined。用量与 Goal 预算同一口径（含子 Session，#usage）：
   * 定时任务的准入（skipped budget）经它判定，不自行计算。
   */
  async exhaustedDimension(sessionId: string): Promise<string | undefined> {
    const entries = await this.#entries(sessionId)
    const goal = currentGoal(entries)
    if (!goal || isTerminalPhase(goal.phase) || goal.phase === 'paused') return undefined
    return exhaustedDimension(goal.budget, await this.#usage(entries, goal.id))
  }

  /** 该 Goal 的五维用量：根 Session 自己的 Run 加上它的 Run 派发的子 Session 的全部 Run（不计轮次，ADR 0014）。 */
  async #usage(entries: readonly StoredEntry[], goalId: string, extra: { now?: number } = {}) {
    const children = await Promise.all(childSessionIds(entries, goalId).map((id) => this.#entries(id)))
    return goalUsage(entries, goalId, { ...extra, ...(children.length > 0 ? { children } : {}) })
  }

  /**
   * 子 Session 的 Run 所属的 Goal（ADR 0014）：父 Session 当前 Goal 为 running，且派发它的 agent_start 属于该 Goal。根 Session 自己时为
   * 该 Session 的 Goal 与它的 Run 是否属于 Goal（own）。
   */
  async #governing(
    sessionId: string,
    runId: string,
  ): Promise<{ goal: GoalPayload; root: string; entries: readonly StoredEntry[]; member: boolean } | undefined> {
    const session = await this.#options.store.sessions.getSession(sessionId)
    if (!session) return undefined
    if (session.parentSessionId === null) {
      const entries = await this.#entries(sessionId)
      const goal = currentGoal(entries)
      return goal ? { goal, root: sessionId, entries, member: goalRunIds(entries, goal.id).has(runId) } : undefined
    }
    const root = session.parentSessionId
    const entries = await this.#entries(root)
    const goal = currentGoal(entries)
    if (!goal) return undefined
    return { goal, root, entries, member: childSessionIds(entries, goal.id).includes(sessionId) }
  }

  // ---- 读取 ----

  /** 当前 Goal（最新的 goal 条目）与已用量。 */
  async get(sessionId: string): Promise<GoalResponse> {
    await requireSession(this.#options.store, sessionId)
    const entries = await this.#entries(sessionId)
    const goal = currentGoal(entries)
    if (!goal) return { goal: null, usage: { rounds: 0 } }
    return { goal, usage: { ...(await this.#usage(entries, goal.id)), costUnpriced: !(await this.#priced(sessionId)) } }
  }

  /** Goal 未终结时的 <goal> section（已设维度的用量 / 上限）。 */
  async systemSection(sessionId: string): Promise<SystemSection | undefined> {
    const entries = await this.#entries(sessionId)
    const goal = currentGoal(entries)
    return goalSection(goal, goal ? await this.#usage(entries, goal.id) : { rounds: 0 })
  }

  // ---- 预算检查点（context/goal.ts 的 beforeRequest 与工具 hook） ----

  /**
   * 模型请求前（运行时 beforeRequest）：该 Run 属于 running 的 Goal 时检查 Token、费用与时间（进行中的 Run 计到此刻），设了费用上限而模型
   * 未定价时 cost_unpriced。返回停止的原因；Run 以 paused 加该 error 结束，Run 结束后 Goal 进入 budget-exhausted / blocked（runEnded）。
   */
  async beforeRequest(sessionId: string, runId: string): Promise<RunError | undefined> {
    // 子 Session 的 Run 检查父 Session 的 Goal（含其他子 Session 的已用）。
    const governing = await this.#governing(sessionId, runId)
    if (!governing || this.#cancelling.has(governing.root)) return undefined
    const { goal, entries } = governing
    if (goal.phase !== 'running' || !governing.member) return undefined
    const usage = await this.#usage(entries, goal.id)
    const dimension = exhaustedDimension(goal.budget, usage, ['tokens', 'cost', 'time'])
    if (dimension) return { code: 'budget_exhausted', message: exhaustedMessage(dimension, goal.budget, usage), dimension }
    if (goal.budget.maxCost !== undefined && !(await this.#priced(sessionId))) return { code: 'cost_unpriced', message: COST_UNPRICED_MESSAGE }
    return undefined
  }

  /**
   * 工具调用前（权限判定之后的 hook）：该 Run 属于 running 且设了 maxToolCalls 的 Goal 时，已提交的调用加本 Run 已放行未提交的调用达到上限，
   * 则该调用不执行（错误结果 "Goal budget exhausted: tool calls (n / max)"，带结构化标记 hostBlock，用量派生只认这个标记），并要求 Run
   * 本批完成后停止（stopAfterBatch）。
   */
  toolHooks(sessionId: string): ToolHooks {
    return { beforeToolCall: (context) => this.#toolCallLocks.run(sessionId, () => this.#checkToolCall(sessionId, context.toolCall.id)) }
  }

  async #checkToolCall(sessionId: string, toolCallId: string): Promise<ToolBlockResult | undefined> {
    const runs = this.#options.runs
    const runId = runs.activeRunId(sessionId)
    if (runId === undefined) return undefined
    const governing = await this.#governing(sessionId, runId)
    if (!governing || this.#cancelling.has(governing.root)) return undefined
    const { goal } = governing
    if (goal.phase !== 'running' || goal.budget.maxToolCalls === undefined || !governing.member) return undefined
    const entries = await this.#entries(sessionId)
    let admitted = this.#admitted.get(sessionId)
    if (admitted?.runId !== runId) {
      admitted = { runId, ids: new Set() }
      this.#admitted.set(sessionId, admitted)
    }
    const committed = new Set(
      entries.filter((e) => e.runId === runId && e.kind === 'message').map((e) => (e.payload as { role?: string; toolCallId?: string }).toolCallId),
    )
    const pending = [...admitted.ids].filter((id) => !committed.has(id)).length
    const usage = await this.#usage(governing.entries, goal.id)
    const used = { ...usage, toolCalls: usage.toolCalls + pending }
    if (exhaustedDimension(goal.budget, used, ['tool-calls'])) {
      const message = exhaustedMessage('tool-calls', goal.budget, used)
      runs.stopAfterBatch(sessionId, { code: 'budget_exhausted', message, dimension: 'tool-calls' })
      log.info('goal tool call blocked by budget', { sessionId, goalId: goal.id, toolCallId, used: used.toolCalls })
      return { block: true, reason: message, hostBlock: { by: 'goal-budget', dimension: 'tool-calls' } }
    }
    admitted.ids.add(toolCallId)
    return undefined
  }

  /** 该 Session 的模型是否已定价。 */
  #priced(sessionId: string): Promise<boolean> {
    return this.#options.runs.modelPriced(sessionId)
  }

  /**
   * 本 Run 注册的 Goal 工具：get_goal 在 Session 有 Goal 或本 Run 不是 Goal Round 时注册；create_goal 只在不是 Goal Round 时注册（Goal Round 中
   * 没有 create）；update_goal 只在 Session 有 Goal 时注册（没有 Goal 时它只能返回 not-found，不占用模型上下文）。授权在调用时按条目判定。
   */
  async toolNames(sessionId: string): Promise<{ read: boolean; create: boolean; update: boolean }> {
    const round = this.#driver.starting(sessionId)
    const has = currentGoal(await this.#entries(sessionId)) !== undefined
    return { read: has || !round, create: !round, update: has }
  }

  // ---- 用户的动作（HTTP 与 /goal） ----

  /** 用户的动作；见 GoalActionRequest。 */
  async act(sessionId: string, request: GoalActionRequest): Promise<GoalResponse> {
    await requireSession(this.#options.store, sessionId)
    if (request.action === 'cancel') return this.#cancel(sessionId, request.revision)
    let pause = false
    await this.#locks.run(sessionId, async () => {
      const entries = await this.#entries(sessionId)
      const goal = this.#require(entries)
      try {
        // 取消进行中：取消提交 cancelled 之前，用户的动作不再改变 Goal（否则 resume 会开出一个在取消之后继续运行的 Goal Round）。
        if (this.#cancelling.has(sessionId)) throw new GoalError('invalid-transition', 'The goal is being cancelled')
        expectRevision(goal, request.revision)
        const usage = await this.#usage(entries, goal.id)
        const change: GoalChange =
          request.action === 'pause'
            ? { type: 'pause', reason: { code: 'user-paused', message: 'Paused by the user' } }
            : request.action === 'resume'
              ? { type: 'resume' }
              : request.action === 'complete'
                ? { type: 'complete', by: 'user' }
                : {
                    type: 'edit',
                    ...(request.objective === undefined ? {} : { objective: request.objective }),
                    ...(request.constraints === undefined ? {} : { constraints: request.constraints }),
                    ...(request.criteria === undefined ? {} : { criteria: request.criteria }),
                    ...(request.budget === undefined ? {} : { budget: request.budget }),
                  }
        await this.#commit(sessionId, applyGoalChange(goal, change, 'user', usage))
      } catch (error) {
        rethrow(error)
      }
      log.info('goal action', { sessionId, goalId: goal.id, action: request.action })
      pause = request.action === 'pause' || request.action === 'complete'
      // 恢复：Session 空闲时立即开始下一轮。
      if (request.action === 'resume') await this.#driver.advance(sessionId)
    })
    // 暂停（与用户标为完成）：进行中的 Run 本批完成后停下；不终止 Job。
    if (pause && this.#options.runs.isRunning(sessionId)) await this.#options.runs.pause(sessionId).catch(() => undefined)
    return this.get(sessionId)
  }

  /** 当前 Goal 的 revision（/goal 的动作用）；没有 Goal 时 not-found。 */
  async revision(sessionId: string): Promise<number> {
    return this.#require(await this.#entries(sessionId)).revision
  }

  /** 取消：停止进行中的 Run（等待 run_end）、终止该 Goal 的 Job（等待 job_end），再提交 cancelled 快照与 cleanup。 */
  async #cancel(sessionId: string, revision: number): Promise<GoalResponse> {
    const goal = await this.#locks.run(sessionId, async () => {
      const current = this.#require(await this.#entries(sessionId))
      try {
        expectRevision(current, revision)
        if (isTerminalPhase(current.phase))
          throw new GoalError('invalid-transition', `Goal ${current.id} is already ${current.phase}`, { phase: current.phase })
      } catch (error) {
        rethrow(error)
      }
      this.#cancelling.add(sessionId)
      return current
    })
    const cleanup = { runsAborted: 0, jobsKilled: 0, agentsStopped: 0, failures: [] as string[] }
    try {
      // 子代理先停（前台子代理的 agent 调用随之结束，父 Run 才能停下；后台子代理不随父 Run 停止）。
      try {
        cleanup.agentsStopped = (await this.#subagents?.stopForGoal(sessionId, goal.id)) ?? 0
      } catch (error) {
        cleanup.failures.push('Stopping subagents failed: ' + errorMessage(error))
      }
      const runs = this.#options.runs
      const runId = runs.activeRunId(sessionId)
      if (runId !== undefined && runs.isRunning(sessionId)) {
        const ended = this.#runEnd(sessionId, runId)
        if (await runs.abort(sessionId)) cleanup.runsAborted++
        if (!(await ended)) cleanup.failures.push(`Run ${runId} did not end within ${CANCEL_RUN_WAIT_MS} ms`)
      }
      try {
        cleanup.jobsKilled = await this.#options.jobs.killSession(sessionId, goal.id)
      } catch (error) {
        cleanup.failures.push('Stopping background jobs failed: ' + errorMessage(error))
      }
      // 等待期间开始的 Run（取消进行中拒绝了 Goal 的动作与推进，这里是兜底）：提交 cancelled 之前同样停止它并等待 run_end。
      const late = runs.activeRunId(sessionId)
      if (late !== undefined && late !== runId && runs.isRunning(sessionId)) {
        const ended = this.#runEnd(sessionId, late)
        if (await runs.abort(sessionId)) cleanup.runsAborted++
        if (!(await ended)) cleanup.failures.push(`Run ${late} did not end within ${CANCEL_RUN_WAIT_MS} ms`)
      }
      await this.#locks.run(sessionId, async () => {
        const entries = await this.#entries(sessionId)
        const current = this.#require(entries)
        if (isTerminalPhase(current.phase)) return
        await this.#commit(sessionId, applyGoalChange(current, { type: 'cancel', cleanup }, 'user', goalRounds(entries, current.id)))
      })
      log.info('goal cancelled', { sessionId, goalId: goal.id, ...cleanup, failures: cleanup.failures.length })
    } finally {
      this.#cancelling.delete(sessionId)
    }
    return this.get(sessionId)
  }

  /** 等待该 Run 的 run_end（进度或条目）；超时 false。 */
  #runEnd(sessionId: string, runId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), CANCEL_RUN_WAIT_MS)
      const off = this.#options.hub.subscribe(sessionId, (m) => {
        if (
          (m.type === 'progress' && m.runId === runId && m.event.type === 'run_end') ||
          (m.type === 'entry' && m.entry.runId === runId && m.entry.kind === 'run_end')
        )
          finish(true)
      })
      const finish = (ended: boolean) => {
        clearTimeout(timer)
        off()
        resolve(ended)
      }
    })
  }

  // ---- 模型的工具（context/goal.ts） ----

  port(sessionId: string): GoalToolPort {
    const guard = () => {
      if (this.#cancelling.has(sessionId)) throw new GoalError('invalid-transition', 'The goal is being cancelled')
    }
    return {
      get: async () => {
        const entries = await this.#entries(sessionId)
        const goal = currentGoal(entries)
        return goalView(goal, goal ? goalRounds(entries, goal.id) : 0)
      },
      create: (args) =>
        this.#locks.run(sessionId, async () => {
          guard()
          const entries = await this.#entries(sessionId)
          const committed = await this.#commit(sessionId, planGoalCreate(args, { entries, authority: runAuthority(entries) }))
          log.info('goal created', { sessionId, goalId: committed.id, criteria: committed.criteria.length })
          return goalView(committed, 0)
        }),
      update: (args) =>
        this.#locks.run(sessionId, async () => {
          guard()
          const entries = await this.#entries(sessionId)
          const goal = currentGoal(entries)
          const rounds = goal ? goalRounds(entries, goal.id) : 0
          const jobs = this.#options.jobs.port(sessionId)
          const next = planGoalUpdate(goal, args, {
            entries,
            authority: runAuthority(entries),
            rounds,
            ...(goal ? { usage: await this.#usage(entries, goal.id) } : {}),
            jobRunning: (id) => jobs.get(id)?.running ?? false,
          })
          let committed = await this.#commit(sessionId, next)
          log.info('goal updated by the model', { sessionId, goalId: committed.id, action: args.action, phase: committed.phase })
          // 等待的 Job 恰在判定与提交之间结束：立即回到 running。
          if (committed.phase === 'waiting-external' && (await this.#jobsEnded(sessionId, committed)))
            committed = await this.#wake(sessionId, committed, rounds)
          return goalView(committed, rounds)
        }),
    }
  }

  // ---- Run 与 Job 结束（context/goal.ts 的 onRunEnd、job_end 订阅） ----

  /**
   * 交接完成（HandoffService 提交 handoff 条目之后）：源 Session 的 running Goal 以 handed-off 暂停，不与目标会话并行推进、不继续花费源 Goal 的
   * 预算；用户随时可以恢复。其余阶段不变（waiting-* 只由各自的条件唤醒）。
   */
  async handedOff(sessionId: string): Promise<void> {
    await this.#locks.run(sessionId, async () => {
      const entries = await this.#entries(sessionId)
      const goal = currentGoal(entries)
      if (!goal || goal.phase !== 'running') return
      const reason = { code: 'handed-off' satisfies KnownGoalReasonCode, message: 'The work was handed off to a new session' }
      await this.#commit(sessionId, applyGoalChange(goal, { type: 'pause', reason }, 'system', goalRounds(entries, goal.id)))
      log.info('goal paused after handoff', { sessionId, goalId: goal.id })
    })
  }

  /** Run 结束之后（run_end 已提交）：按规格转换阶段，Goal 为 running 时发起下一轮。 */
  async runEnded(info: RunEndInfo): Promise<void> {
    const { sessionId, result, trigger } = info
    // 手动压缩与交接的 Run 不推进 Goal；只有它在摘要请求前被预算检查停下时（paused 加 budget_exhausted / cost_unpriced）照常转换阶段。
    // 交接完成后源 Goal 暂停（handedOff），之后的工作在目标会话中进行。
    if ((trigger === 'compact' || trigger === 'handoff') && !budgetStop(result)) return
    await this.#locks.run(sessionId, async () => {
      if (this.#cancelling.has(sessionId)) return
      const entries = await this.#entries(sessionId)
      const goal = currentGoal(entries)
      if (!goal || isTerminalPhase(goal.phase)) return
      const rounds = goalRounds(entries, goal.id)
      const change = endChange(goal, info, entries)
      if (change) {
        await this.#commit(sessionId, applyGoalChange(goal, change, 'system', rounds))
        log.info('goal phase changed after run', { sessionId, goalId: goal.id, change: change.type, status: result.status })
      }
      const phase = change ? (change.type === 'wake' ? 'running' : undefined) : goal.phase
      if (phase === 'running' && result.status === 'completed' && !hasUserSteering(result.undeliveredSteering)) await this.#driver.advance(sessionId)
    })
  }

  async #jobEnded(sessionId: string): Promise<void> {
    await this.#locks.run(sessionId, async () => {
      if (this.#cancelling.has(sessionId)) return
      const entries = await this.#entries(sessionId)
      const goal = currentGoal(entries)
      if (!goal) return
      if (goal.phase !== 'waiting-external' || !(await this.#jobsEnded(sessionId, goal))) return
      await this.#wake(sessionId, goal, goalRounds(entries, goal.id))
      // Session 空闲时立即开始下一轮；Run 进行中时该 Run 结束后照常推进（advance 遇到进行中的 Run 不发起）。
      await this.#driver.advance(sessionId)
    })
  }

  /**
   * Goal Round 中的计划审阅（exit_plan_mode 等待用户）：请求提交时 Goal 进入 waiting-input（plan-review），使界面显示在等用户；回答（未被取消）
   * 之后同一 Run 中回到 running。审阅被停止取消时保持 waiting-input，等用户提交（Run 结束后的转换照常）。
   */
  async #planReview(sessionId: string, entry: { kind: string; runId: string | null; payload: unknown }): Promise<void> {
    await this.#locks.run(sessionId, async () => {
      if (this.#cancelling.has(sessionId)) return
      const entries = await this.#entries(sessionId)
      const goal = currentGoal(entries)
      if (!goal) return
      const rounds = goalRounds(entries, goal.id)
      if (entry.kind === 'approval_request') {
        const request = entry.payload as { kind?: string }
        if (request.kind !== 'plan' || goal.phase !== 'running' || entry.runId === null || !isGoalRound(entries, entry.runId, goal.id)) return
        await this.#commit(
          sessionId,
          applyGoalChange(goal, { type: 'wait-input', reason: { code: 'plan-review', message: 'Waiting for the user to review the plan' } }, 'system', rounds),
        )
        log.info('goal waiting for plan review', { sessionId, goalId: goal.id })
        return
      }
      const decision = entry.payload as { requestId: string; outcome: string }
      if (goal.phase !== 'waiting-input' || goal.reason?.code !== 'plan-review' || decision.outcome === 'cancelled') return
      const asked = entries.some(
        (e) =>
          e.kind === 'approval_request' &&
          (e.payload as { requestId: string; kind?: string }).requestId === decision.requestId &&
          (e.payload as { kind?: string }).kind === 'plan',
      )
      if (asked) await this.#wake(sessionId, goal, rounds)
    })
  }

  async #jobsEnded(sessionId: string, goal: GoalPayload): Promise<boolean> {
    const port = this.#options.jobs.port(sessionId)
    return (goal.waitingFor?.jobIds ?? []).every((id) => !(port.get(id)?.running ?? false))
  }

  async #wake(sessionId: string, goal: GoalPayload, rounds: number): Promise<GoalPayload> {
    const committed = await this.#commit(sessionId, applyGoalChange(goal, { type: 'wake' }, 'system', rounds))
    log.info('goal resumed after waiting', { sessionId, goalId: goal.id, from: goal.phase })
    return committed
  }

  // ---- 启动恢复 ----

  /** 启动恢复（Session 恢复之后）：running / waiting-* 的 Goal 提交为 paused（restarted）；返回暂停的数量。 */
  async recover(source: RecoverySource): Promise<number> {
    let count = 0
    for (const entry of await source.listLatestEntries('goal')) {
      const goal = entry.payload as unknown as GoalPayload
      if (!isActivePhase(goal.phase)) continue
      const entries = await this.#entries(entry.sessionId)
      const latest = currentGoal(entries)
      if (!latest || !isActivePhase(latest.phase)) continue
      const reason = { code: 'restarted', message: 'Coko restarted; resume the goal to continue' }
      await this.#commit(entry.sessionId, applyGoalChange(latest, { type: 'pause', reason }, 'system', goalRounds(entries, latest.id)))
      log.warn('goal paused after restart', { sessionId: entry.sessionId, goalId: latest.id, phase: latest.phase })
      count++
    }
    return count
  }

  // ---- 内部 ----

  #entries(sessionId: string): Promise<readonly StoredEntry[]> {
    return this.#options.store.sessions.listEntries(sessionId)
  }

  #require(entries: readonly StoredEntry[]): GoalPayload {
    const goal = currentGoal(entries)
    if (!goal) throw new AppError('not-found', 'This session has no goal')
    return goal
  }

  /** 提交一条 goal 快照（入库前替换登记明文）并推送；返回入库后的快照。推进中的 Goal 订阅本 Session 的 job_end。 */
  async #commit(sessionId: string, goal: GoalPayload): Promise<GoalPayload> {
    const [committed] = await this.#options.store.sessions.appendEntries(sessionId, [toNewEntry({ kind: 'goal', payload: goal })])
    this.#options.hub.publishEntry(committed!)
    const saved = committed!.payload as unknown as GoalPayload
    if (isActivePhase(saved.phase)) this.#watch(sessionId)
    else this.#unwatch(sessionId)
    return saved
  }

  #watch(sessionId: string): void {
    if (this.#watches.has(sessionId)) return
    const off = this.#options.hub.subscribe(sessionId, (m) => {
      if (m.type !== 'entry') return
      if (m.entry.kind === 'approval_request' || m.entry.kind === 'approval_decision') {
        const entry = m.entry
        void this.#planReview(sessionId, entry).catch((error: unknown) =>
          log.warn('goal plan review handling failed', { sessionId, error: errorMessage(error) }),
        )
        return
      }
      if (m.entry.kind !== 'job_end') return
      const jobId = (m.entry.payload as unknown as JobEndPayload).jobId
      void this.#jobEnded(sessionId).catch((error: unknown) => log.warn('goal job end handling failed', { sessionId, jobId, error: errorMessage(error) }))
    })
    this.#watches.set(sessionId, off)
  }

  #unwatch(sessionId: string): void {
    this.#watches.get(sessionId)?.()
    this.#watches.delete(sessionId)
  }
}

/** 该 Run 是否为该 Goal 的 Goal Round。 */
function isGoalRound(entries: readonly StoredEntry[], runId: string, goalId: string): boolean {
  const start = entries.find((e) => e.kind === 'run_start' && e.runId === runId)?.payload as { trigger?: string; goal?: { goalId: string } } | undefined
  return start?.trigger === 'goal' && start.goal?.goalId === goalId
}

/** 该 Run 中是否有审批以 cancelled 结束（停止时仍在等待回答）。 */
function approvalCancelled(entries: readonly StoredEntry[], runId: string): boolean {
  const requests = new Set(entries.filter((e) => e.kind === 'approval_request' && e.runId === runId).map((e) => (e.payload as { requestId: string }).requestId))
  return entries.some(
    (e) =>
      e.kind === 'approval_decision' &&
      requests.has((e.payload as { requestId: string; outcome: string }).requestId) &&
      (e.payload as { outcome: string }).outcome === 'cancelled',
  )
}

/**
 * Run 结束后的转换（规格的转换表）：
 * - 预算停止（budget_exhausted、cost_unpriced）→ budget-exhausted / blocked；
 * - Goal Round 以 error 结束 → failed（不自动重试）；
 * - running 时 Run 被停止（aborted，或 paused 且没有 error）→ Goal Round 停止时仍有等待回答的审批为 waiting-input，否则 paused（user-stopped）；
 * - running 时外部 Hook 以 continue: false 停下 Run（paused 加 hook_stopped）→ paused（hook-stopped，消息为 Hook 的 stopReason），等用户恢复；
 * - waiting-input 时用户的 Run（submit、continue、retry；含回答审批之后的）正常结束 → running；定时任务、交接与子代理的 Run 不唤醒；Goal 在本 Run 之中才进入 waiting-input 的（模型在这个 Run 里调用了
 *   wait_input）不唤醒：它等的用户输入还没有到来。
 */
function endChange(goal: GoalPayload, info: RunEndInfo, entries: readonly StoredEntry[]): GoalChange | undefined {
  const { result, trigger } = info
  const error = result.error
  if (goal.phase === 'running' && result.status === 'paused' && error?.code === 'budget_exhausted') {
    return { type: 'exhaust', reason: { code: error.dimension ?? 'budget', message: error.message } }
  }
  if (goal.phase === 'running' && result.status === 'paused' && error?.code === 'cost_unpriced')
    return { type: 'block', reason: { code: 'cost-unpriced', message: error.message } }
  if (goal.phase === 'running' && result.status === 'paused' && error?.code === 'hook_stopped')
    return { type: 'pause', reason: { code: 'hook-stopped' satisfies KnownGoalReasonCode, message: error.message } }
  if (trigger === 'goal' && goal.phase === 'running' && result.status === 'error')
    return { type: 'fail', reason: { code: error?.code ?? 'internal', message: error?.message ?? 'The goal round failed' } }
  if (goal.phase === 'running' && stopped(result)) {
    if (trigger === 'goal' && approvalCancelled(entries, info.runId))
      return { type: 'wait-input', reason: { code: 'approval-unanswered', message: 'The goal round stopped while an approval was waiting for an answer' } }
    return { type: 'pause', reason: { code: 'user-stopped', message: 'The run was stopped by the user' } }
  }
  if (goal.phase === 'waiting-input' && USER_TRIGGERS.has(trigger) && result.status === 'completed' && waitingBefore(goal, info.runId, entries))
    return { type: 'wake' }
  return undefined
}

/** Goal 进入当前这段 waiting-input 的快照（之后的 edit 不改变阶段）是否早于该 Run 的 run_start。 */
function waitingBefore(goal: GoalPayload, runId: string, entries: readonly StoredEntry[]): boolean {
  const started = entries.find((e) => e.kind === 'run_start' && e.runId === runId)?.seq
  let entered: number | undefined
  for (const e of entries) {
    if (e.kind !== 'goal') continue
    const snapshot = e.payload as unknown as GoalPayload
    if (snapshot.id !== goal.id) continue
    if (snapshot.phase !== 'waiting-input') entered = undefined
    else entered ??= e.seq
  }
  return started !== undefined && entered !== undefined && entered < started
}

/** 用户发起的 Run：只有它们的结束能唤醒 waiting-input 的 Goal（无人值守与宿主派生的 Run 不扩大权限与花费）。 */
const USER_TRIGGERS: ReadonlySet<string> = new Set(['submit', 'continue', 'retry'])

/** Run 被请求前的预算检查停下（beforeRequest 返回 stop，或工具调用上限的 stopAfterBatch）。 */
const budgetStop = (result: RunResult) => result.status === 'paused' && (result.error?.code === 'budget_exhausted' || result.error?.code === 'cost_unpriced')

const stopped = (result: RunResult) => result.status === 'aborted' || (result.status === 'paused' && !result.error)

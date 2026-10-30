import {
  ApprovalNotPendingError,
  effectiveSubagentMode,
  nextPlanRef,
  type AgentRuntime,
  type PermissionMode,
  type PermissionRule,
  type PlanRef,
  type PlanReview,
  type StandardPermissionMode,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import {
  planMarkdownProblem,
  type AnswerApprovalRequest,
  type PermissionsResponse,
  type SessionPermissionsResponse,
  type UpdatePermissionsRequest,
} from '@coko/protocol'
import type { Session as StoredSession, SessionStore } from '@coko/session'
import type { ContextContribution } from './context/index.ts'
import { bindPlanHost, type PlanHost } from './context/plan.ts'
import { AppError } from './errors.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import { capMode, PermissionService, sameRule, withRules } from './permissions.ts'
import { requireSession, type SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'sessions'])

/** Session 的模式与 Session 规则：由 permission_mode / permission_rule 条目回放，之后随提交更新。 */
export interface SessionPermissionState {
  workspaceId: string
  mode: PermissionMode
  /** plan 模式下：进入 plan 之前的模式（permission_mode 的 prior）。 */
  prior?: StandardPermissionMode
  rules: PermissionRule[]
}

const view = (state: SessionPermissionState): SessionPermissionsResponse => ({
  mode: state.mode,
  ...(state.mode === 'plan' && state.prior ? { prior: state.prior } : {}),
  rules: [...state.rules],
})

/**
 * 子 Session 的权限作用域（ADR 0014）：rootSessionId 为规则与"本会话总是允许"所属的根 Session；modeCap 为子代理定义的 permission-mode
 * （SubagentService 给出）。缺省：每个 Session 是自己的根，没有上限。子 Session 的有效模式在每次判定时取根 Session 当前模式（plan 按
 * read-only）与 modeCap 中较窄者（effectiveSubagentMode）；子 Session 没有自己的模式与规则，读写的都是根 Session 的状态。
 */
export interface PermissionScopeResolver {
  rootSessionId(sessionId: string): string
  modeCap(sessionId: string): StandardPermissionMode | undefined
}

export const ownPermissionScope: PermissionScopeResolver = { rootSessionId: (sessionId) => sessionId, modeCap: () => undefined }

/** 批准计划时模式的宽窄（plan 不会作为批准后的模式）。 */
const MODE_RANK: Record<Exclude<PermissionMode, 'plan'>, number> = { 'read-only': 0, default: 1, 'accept-edits': 2, 'full-access': 3 }

/** 待批准的计划没有审阅记录（状态不一致）：internal，记一条 error。 */
function missingPlan(sessionId: string, toolCallId: string): AppError {
  log.error('plan approval without a pending review', { sessionId, toolCallId })
  return new AppError('internal', 'The plan under review was not found')
}

/** 计划审阅中的一次 exit_plan_mode：提交时的位置与正文，以及批准时用户给出的编辑与模式（回答到达时登记）。 */
interface PendingPlan {
  ref: PlanRef
  markdown: string
  answer?: { editedPlan?: string; mode?: StandardPermissionMode }
}

/**
 * Session 的权限：模式与 Session 规则的状态回放、同一 Session 的修改串行（锁）、默认模式与全局 / Workspace 规则，以及规则或模式
 * 变化后对待审批请求的重新判定（ADR 0005）。
 */
export class SessionPermissions implements PlanHost {
  readonly #store: SessionStore
  readonly #runtimes: SessionRuntimes
  readonly #states = new Map<string, Promise<SessionPermissionState>>()
  /** 审阅中的计划，按 `<sessionId>:<toolCallId>`。 */
  readonly #plans = new Map<string, PendingPlan>()
  /** 每个 Session 的权限条目提交串行（回放后的内存状态与条目顺序一致）；结果确认也经它串行。 */
  readonly #locks = new KeyedMutex()
  #scopes: PermissionScopeResolver
  /** 已解析过的子 Session（重启后作用域中没有的子 Session 同样按子级计算模式）。 */
  readonly #children = new Set<string>()
  readonly service: PermissionService

  /** contributions：上下文装配的贡献；其中的 plan 贡献（context/plan.ts）经它读写模式与计划审阅。 */
  constructor(options: {
    store: SessionStore
    runtimes: SessionRuntimes
    service: PermissionService
    contributions?: readonly ContextContribution[]
    scopes?: PermissionScopeResolver
  }) {
    this.#store = options.store
    this.#runtimes = options.runtimes
    this.service = options.service
    this.#scopes = options.scopes ?? ownPermissionScope
    if (options.contributions) bindPlanHost(options.contributions, this)
  }

  /** 装配时接上子代理的作用域（之后每次判定现取）。 */
  useScopes(scopes: PermissionScopeResolver): void {
    this.#scopes = scopes
  }

  /** 该 Session 的权限作用域（根 Session 与模式上限）。 */
  get scopes(): PermissionScopeResolver {
    return this.#scopes
  }

  /**
   * Session 的权限状态。子 Session（parentSessionId 非空）取根 Session 的同一个状态对象：根中途切换模式或增删规则，子级的下一次判定即可见。
   */
  async state(session: StoredSession): Promise<SessionPermissionState> {
    if (session.parentSessionId === null) return this.#own(session)
    this.#children.add(session.id)
    const rootId = this.#rootOf(session)
    return this.#own(await requireSession(this.#store, rootId))
  }

  /** 子 Session → 根 Session（作用域给出的根优先；重启后作用域里没有时按 parentSessionId，深度为 1）。 */
  #rootOf(session: StoredSession): string {
    const root = this.#scopes.rootSessionId(session.id)
    return root !== session.id ? root : (session.parentSessionId ?? session.id)
  }

  /** 该 Session 是否为子 Session（拒绝直接切换模式与修改规则）。 */
  async #rejectChild(sessionId: string): Promise<StoredSession> {
    const session = await requireSession(this.#store, sessionId)
    if (session.parentSessionId !== null) throw new AppError('child-session', 'A subagent session uses the permissions of its root session')
    return session
  }

  #own(session: StoredSession): Promise<SessionPermissionState> {
    let state = this.#states.get(session.id)
    if (!state) {
      state = (async () => {
        await Promise.all([this.service.load(), this.service.loadWorkspace(session.workspaceId)])
        const replayed: SessionPermissionState = { workspaceId: session.workspaceId, mode: 'default', rules: [] }
        for (const entry of await this.#store.sessions.listEntries(session.id)) {
          if (entry.kind === 'permission_mode') {
            const { mode, prior } = entry.payload as { mode: PermissionMode; prior?: StandardPermissionMode }
            replayed.mode = mode
            if (mode !== 'plan') delete replayed.prior
            else if (prior) replayed.prior = prior
          } else if (entry.kind === 'permission_rule') {
            const { op, rule: stored } = entry.payload as unknown as { op: 'add' | 'remove'; rule: PermissionRule }
            const [rule] = this.service.canonical([stored]) as [PermissionRule]
            replayed.rules = op === 'add' ? withRules(replayed.rules, [rule]) : replayed.rules.filter((r) => !sameRule(r, rule))
          }
        }
        return replayed
      })()
      state.catch(() => this.#states.delete(session.id))
      this.#states.set(session.id, state)
    }
    return state
  }

  /** 同一 Session 的权限修改（与结果确认）串行执行。 */
  locked<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    return this.#locks.run(sessionId, task)
  }

  /**
   * 运行时每次调用现算的模式与规则：Session 规则在前，其后是全局与 Workspace 规则（判定不依赖顺序）。模式取 Session 模式与作用域上限中
   * 较窄者（capMode；缺省没有上限）。
   */
  runtimePermissions(state: SessionPermissionState, workspaceId: string, sessionId: string): { mode: () => PermissionMode; rules: () => PermissionRule[] } {
    // 子 Session：state 是根 Session 的状态；模式在每次判定时取根当前模式（plan 按 read-only）与定义上限中较窄者。
    const child = this.#scopes.rootSessionId(sessionId) !== sessionId || this.#children.has(sessionId)
    return {
      mode: () => (child ? effectiveSubagentMode(state.mode, this.#scopes.modeCap(sessionId)) : capMode(state.mode, this.#scopes.modeCap(sessionId))),
      rules: () => [...state.rules, ...this.service.rulesFor(workspaceId)],
    }
  }

  async sessionPermissions(sessionId: string): Promise<SessionPermissionsResponse> {
    return view(await this.state(await requireSession(this.#store, sessionId)))
  }

  /**
   * 切换模式：提交 permission_mode 条目（与当前相同时不提交），之后重新判定该 Session 的待审批请求。切到 plan 时记下当前模式为 prior
   * （已在 plan 时不变）；从 plan 切到其他模式即退出规划（不经审阅）。
   */
  async setMode(sessionId: string, mode: PermissionMode): Promise<SessionPermissionsResponse> {
    const session = await this.#rejectChild(sessionId)
    const result = await this.locked(sessionId, async () => {
      const state = await this.state(session)
      if (state.mode !== mode) {
        const prior = mode === 'plan' && state.mode !== 'plan' ? state.mode : undefined
        await this.#runtimes.commit(sessionId, { kind: 'permission_mode', payload: prior ? { mode, prior } : { mode } })
        state.mode = mode
        if (prior) state.prior = prior
        else delete state.prior
        log.info('permission mode changed', { sessionId, mode, ...(prior ? { prior } : {}) })
      }
      return view(state)
    })
    await this.reevaluate(this.#sameRoot(sessionId))
    return result
  }

  /** 匹配该根 Session 及其子 Session（重新判定待审批请求时：子 Session 按根的模式与规则判定）。 */
  #sameRoot(rootId: string): (sessionId: string) => boolean {
    return (sessionId) => sessionId === rootId || this.#scopes.rootSessionId(sessionId) === rootId
  }

  // ---- Plan Mode（context/plan.ts 经 PlanHost 调用） ----

  async mode(sessionId: string): Promise<PermissionMode> {
    return (await this.state(await requireSession(this.#store, sessionId))).mode
  }

  async enterPlan(sessionId: string): Promise<void> {
    await this.setMode(sessionId, 'plan')
  }

  /** 回到进入 plan 之前的模式（没有记录时 default）；不在 plan 时不变。 */
  async exitPlan(sessionId: string): Promise<void> {
    const state = await this.state(await requireSession(this.#store, sessionId))
    if (state.mode === 'plan') await this.setMode(sessionId, state.prior ?? 'default')
  }

  entries(sessionId: string) {
    return this.#store.sessions.listEntries(sessionId)
  }

  /** 该 Session 的计划审阅（exit_plan_mode 的权限 hook 与执行调用）。 */
  review(sessionId: string): PlanReview {
    const key = (toolCallId: string) => `${sessionId}:${toolCallId}`
    const commitPlan = (payload: { planId: string; revision: number; markdown: string; status: 'proposed' | 'approved' | 'rejected'; feedback?: string }) =>
      this.#runtimes.commit(sessionId, { kind: 'plan', payload })
    return {
      active: async () => (await this.mode(sessionId)) === 'plan',
      propose: (toolCallId, markdown) =>
        this.locked(sessionId, async () => {
          // 同一 Session 只有一个待审阅的计划：之前留下的（被停止的 Run）不再需要。
          for (const k of this.#plans.keys()) if (k.startsWith(`${sessionId}:`)) this.#plans.delete(k)
          const ref = nextPlanRef(await this.#store.sessions.listEntries(sessionId))
          await commitPlan({ ...ref, markdown, status: 'proposed' })
          this.#plans.set(key(toolCallId), { ref, markdown })
          log.info('plan proposed', { sessionId, planId: ref.planId, revision: ref.revision })
          return ref
        }),
      rejected: async (toolCallId, feedback) => {
        const pending = this.#plans.get(key(toolCallId))
        this.#plans.delete(key(toolCallId))
        if (!pending) return
        await commitPlan({ ...pending.ref, markdown: pending.markdown, status: 'rejected', ...(feedback === undefined ? {} : { feedback }) })
        log.info('plan rejected', { sessionId, planId: pending.ref.planId, revision: pending.ref.revision, feedback: feedback !== undefined })
      },
      approved: async (toolCallId) => {
        const pending = this.#plans.get(key(toolCallId))
        // propose 总在询问之前登记；没有记录说明状态不一致：不猜 revision（批准的计划须是提交的那一版）。
        if (!pending) throw missingPlan(sessionId, toolCallId)
        this.#plans.delete(key(toolCallId))
        const edited = pending.answer?.editedPlan
        const final = edited !== undefined && edited !== pending.markdown ? edited : pending.markdown
        const revision = final === pending.markdown ? pending.ref.revision : pending.ref.revision + 1
        await commitPlan({ planId: pending.ref.planId, revision, markdown: final, status: 'approved' })
        const state = await this.state(await requireSession(this.#store, sessionId))
        const mode: PermissionMode = pending.answer?.mode ?? (state.mode === 'plan' ? (state.prior ?? 'default') : state.mode)
        await this.setMode(sessionId, mode)
        log.info('plan approved', { sessionId, planId: pending.ref.planId, revision, mode, edited: final !== pending.markdown })
        return { markdown: final, mode }
      },
    }
  }

  /** 增删 Session 规则：提交 permission_rule 条目（无变化时不提交），之后重新判定该 Session 的待审批请求。 */
  async changeSessionRule(sessionId: string, op: 'add' | 'remove', rule: PermissionRule): Promise<SessionPermissionsResponse> {
    const session = await this.#rejectChild(sessionId)
    // 新增时校验并归一；删除时按读出的规范名比较（库中可能有旧的非规范写法）。
    const normalized = op === 'add' ? this.service.normalize([rule]) : this.service.canonical([rule])
    const result = await this.locked(sessionId, () => this.#applySessionRules(session, op, normalized))
    await this.reevaluate(this.#sameRoot(sessionId))
    return result
  }

  async #applySessionRules(session: StoredSession, op: 'add' | 'remove', rules: readonly PermissionRule[]): Promise<SessionPermissionsResponse> {
    const state = await this.state(session)
    for (const rule of rules) {
      const present = state.rules.some((r) => sameRule(r, rule))
      if (present === (op === 'add')) continue
      await this.#runtimes.commit(session.id, { kind: 'permission_rule', payload: { op, rule } })
      state.rules = op === 'add' ? [...state.rules, rule] : state.rules.filter((r) => !sameRule(r, rule))
    }
    return view(state)
  }

  get(workspaceId?: string): Promise<PermissionsResponse> {
    return this.service.get(workspaceId)
  }

  /** 修改默认模式或全局 / Workspace 规则；规则变化后重新判定受影响 Session 的待审批请求。 */
  async update(request: UpdatePermissionsRequest): Promise<PermissionsResponse> {
    const response = await this.service.update(request)
    if (request.target === 'global') await this.reevaluate(() => true)
    else if (request.target === 'workspace') await this.reevaluate((_id, workspaceId) => workspaceId === request.workspaceId)
    return response
  }

  /**
   * 回答待审批请求；决定条目提交后返回。请求不在等待中时 approval-not-pending。scope 为 session / workspace / global 时
   * 先保存请求的建议规则（Session 规则为条目，其余为设置），再允许；没有建议规则的请求（受保护路径、越界写入、提权、
   * 询问规则命中、无法拆分的命令）只能允许一次，否则 bad-request。保存后重新判定受影响的其他待审批请求。
   */
  async answerApproval(sessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<void> {
    const session = await requireSession(this.#store, sessionId)
    const runtime: AgentRuntime | undefined = this.#runtimes.get(sessionId)
    if (!runtime) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
    const scope = answer.decision === 'allow' ? (answer.scope ?? 'once') : 'once'
    const planAnswer = answer.decision === 'allow' && (answer.editedPlan !== undefined || answer.mode !== undefined)
    const request = runtime.pendingApprovals.find((p) => p.requestId === requestId)
    if (request?.kind === 'plan' && answer.decision === 'allow') return this.#answerPlan(sessionId, runtime, request.toolCallId, requestId, answer)
    if (planAnswer) {
      if (!request) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
      throw new AppError('bad-request', `editedPlan and mode only apply to plan approvals`)
    }
    if (scope !== 'once') {
      if (!request) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
      if (request.kind !== 'tool' || request.suggestions.length === 0)
        throw new AppError('bad-request', `Approval request ${requestId} can only be allowed once`)
      const state = await this.state(session)
      // 子 Session 的"本会话总是允许"写入根 Session 的规则（ADR 0014）。
      const root = session.parentSessionId === null ? session : await requireSession(this.#store, this.#rootOf(session))
      if (scope === 'session') await this.locked(root.id, () => this.#applySessionRules(root, 'add', request.suggestions))
      else await this.service.addRules(scope === 'global' ? { kind: 'global' } : { kind: 'workspace', workspaceId: state.workspaceId }, request.suggestions)
      log.info('permission rules saved', { sessionId, approvalId: requestId, scope, count: request.suggestions.length })
    }
    try {
      await runtime.answerApproval(requestId, answer)
    } catch (error) {
      if (error instanceof ApprovalNotPendingError) throw new AppError('approval-not-pending', error.message)
      throw error
    }
    log.info('approval answered', { sessionId, approvalId: requestId, decision: answer.decision, scope })
    if (scope === 'session') await this.reevaluate(this.#sameRoot(session.parentSessionId === null ? sessionId : this.#rootOf(session)))
    else if (scope === 'workspace') await this.reevaluate((_id, workspaceId) => workspaceId === session.workspaceId)
    else if (scope === 'global') await this.reevaluate(() => true)
  }

  /**
   * 批准计划：只能批准一次（scope once）；editedPlan 须以 # 标题开头。登记编辑与模式后放行，exit_plan_mode 执行时提交 approved 的计划与
   * 批准后的模式（缺省为进入 plan 之前的模式）。
   */
  async #answerPlan(
    sessionId: string,
    runtime: AgentRuntime,
    toolCallId: string,
    requestId: string,
    answer: Extract<AnswerApprovalRequest, { decision: 'allow' }>,
  ): Promise<void> {
    if ((answer.scope ?? 'once') !== 'once') throw new AppError('bad-request', `Approval request ${requestId} can only be allowed once`)
    if (answer.editedPlan !== undefined) {
      const problem = planMarkdownProblem(answer.editedPlan)
      if (problem) throw new AppError('bad-request', `Invalid editedPlan: ${problem}`)
    }
    if (answer.mode !== undefined) {
      // 用户故事：批准后回到进入规划前的模式，或用户选择的较窄模式；不借批准放宽设置。
      const state = await this.state(await requireSession(this.#store, sessionId))
      const restores = state.mode === 'plan' ? (state.prior ?? 'default') : state.mode
      if (MODE_RANK[answer.mode] > MODE_RANK[restores])
        throw new AppError('bad-request', `mode ${answer.mode} is wider than ${restores}, the mode before planning`, { mode: answer.mode, restores })
    }
    const pending = this.#plans.get(`${sessionId}:${toolCallId}`)
    if (!pending) throw missingPlan(sessionId, toolCallId)
    pending.answer = {
      ...(answer.editedPlan !== undefined ? { editedPlan: answer.editedPlan } : {}),
      ...(answer.mode !== undefined ? { mode: answer.mode } : {}),
    }
    try {
      await runtime.answerApproval(requestId, { decision: 'allow', scope: 'once' })
    } catch (error) {
      delete pending.answer
      if (error instanceof ApprovalNotPendingError) throw new AppError('approval-not-pending', error.message)
      throw error
    }
    log.info('approval answered', { sessionId, approvalId: requestId, decision: 'allow', kind: 'plan', mode: answer.mode ?? 'prior' })
  }

  /** 让匹配的 Session 的待审批请求按当前模式与规则重新判定（变为 allow / deny 的以 superseded 结束）。 */
  async reevaluate(match: (sessionId: string, workspaceId: string) => boolean): Promise<void> {
    const work: Promise<void>[] = []
    for (const [sessionId, runtime] of this.#runtimes.entries()) {
      const state = await this.#states.get(this.#scopes.rootSessionId(sessionId))?.catch(() => undefined)
      if (!state || !match(sessionId, state.workspaceId)) continue
      for (const request of runtime.pendingApprovals) {
        if (request.kind !== 'tool') continue
        work.push(
          runtime.answerApproval(request.requestId, { decision: 'reevaluate' }).catch((error: unknown) => {
            if (!(error instanceof ApprovalNotPendingError))
              log.error('approval re-decision failed', { sessionId, approvalId: request.requestId, error: String(error) })
          }),
        )
      }
    }
    await Promise.all(work)
  }
}

import { ApprovalNotPendingError, type AgentRuntime, type PermissionMode, type PermissionRule } from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { AnswerApprovalRequest, PermissionsResponse, SessionPermissionsResponse, UpdatePermissionsRequest } from '@coko/protocol'
import type { Session as StoredSession, SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import { PermissionService, sameRule, withRules } from './permissions.ts'
import { requireSession, type SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'sessions'])

/** Session 的模式与 Session 规则：由 permission_mode / permission_rule 条目回放，之后随提交更新。 */
export interface SessionPermissionState {
  workspaceId: string
  mode: PermissionMode
  rules: PermissionRule[]
}

const view = (state: SessionPermissionState): SessionPermissionsResponse => ({ mode: state.mode, rules: [...state.rules] })

/**
 * Session 的权限：模式与 Session 规则的状态回放、同一 Session 的修改串行（锁）、默认模式与全局 / Workspace 规则，以及规则或模式
 * 变化后对待审批请求的重新判定（ADR 0005）。
 */
export class SessionPermissions {
  readonly #store: SessionStore
  readonly #runtimes: SessionRuntimes
  readonly #states = new Map<string, Promise<SessionPermissionState>>()
  /** 每个 Session 的权限条目提交串行（回放后的内存状态与条目顺序一致）；结果确认也经它串行。 */
  readonly #locks = new Map<string, Promise<unknown>>()
  readonly service: PermissionService

  constructor(options: { store: SessionStore; runtimes: SessionRuntimes; service: PermissionService }) {
    this.#store = options.store
    this.#runtimes = options.runtimes
    this.service = options.service
  }

  state(session: StoredSession): Promise<SessionPermissionState> {
    let state = this.#states.get(session.id)
    if (!state) {
      state = (async () => {
        await Promise.all([this.service.load(), this.service.loadWorkspace(session.workspaceId)])
        const replayed: SessionPermissionState = { workspaceId: session.workspaceId, mode: 'default', rules: [] }
        for (const entry of await this.#store.sessions.listEntries(session.id)) {
          if (entry.kind === 'permission_mode') replayed.mode = (entry.payload as { mode: PermissionMode }).mode
          else if (entry.kind === 'permission_rule') {
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
    const previous = this.#locks.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.#locks.set(
      sessionId,
      next.catch(() => undefined),
    )
    return next
  }

  /** 运行时每次调用现算的模式与规则：Session 规则在前，其后是全局与 Workspace 规则（判定不依赖顺序）。 */
  runtimePermissions(state: SessionPermissionState, workspaceId: string): { mode: () => PermissionMode; rules: () => PermissionRule[] } {
    return {
      mode: () => state.mode,
      rules: () => [...state.rules, ...this.service.rulesFor(workspaceId)],
    }
  }

  async sessionPermissions(sessionId: string): Promise<SessionPermissionsResponse> {
    return view(await this.state(await requireSession(this.#store, sessionId)))
  }

  /** 切换模式：提交 permission_mode 条目（与当前相同时不提交），之后重新判定该 Session 的待审批请求。 */
  async setMode(sessionId: string, mode: PermissionMode): Promise<SessionPermissionsResponse> {
    const session = await requireSession(this.#store, sessionId)
    const result = await this.locked(sessionId, async () => {
      const state = await this.state(session)
      if (state.mode !== mode) {
        await this.#runtimes.commit(sessionId, { kind: 'permission_mode', payload: { mode } })
        state.mode = mode
        log.info('permission mode changed', { sessionId, mode })
      }
      return view(state)
    })
    await this.reevaluate((id) => id === sessionId)
    return result
  }

  /** 增删 Session 规则：提交 permission_rule 条目（无变化时不提交），之后重新判定该 Session 的待审批请求。 */
  async changeSessionRule(sessionId: string, op: 'add' | 'remove', rule: PermissionRule): Promise<SessionPermissionsResponse> {
    const session = await requireSession(this.#store, sessionId)
    // 新增时校验并归一；删除时按读出的规范名比较（库中可能有旧的非规范写法）。
    const normalized = op === 'add' ? this.service.normalize([rule]) : this.service.canonical([rule])
    const result = await this.locked(sessionId, () => this.#applySessionRules(session, op, normalized))
    await this.reevaluate((id) => id === sessionId)
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
    if (scope !== 'once') {
      const request = runtime.pendingApprovals.find((p) => p.requestId === requestId)
      if (!request) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
      if (request.kind !== 'tool' || request.suggestions.length === 0)
        throw new AppError('bad-request', `Approval request ${requestId} can only be allowed once`)
      const state = await this.state(session)
      if (scope === 'session') await this.locked(sessionId, () => this.#applySessionRules(session, 'add', request.suggestions))
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
    if (scope === 'session') await this.reevaluate((id) => id === sessionId)
    else if (scope === 'workspace') await this.reevaluate((_id, workspaceId) => workspaceId === session.workspaceId)
    else if (scope === 'global') await this.reevaluate(() => true)
  }

  /** 让匹配的 Session 的待审批请求按当前模式与规则重新判定（变为 allow / deny 的以 superseded 结束）。 */
  async reevaluate(match: (sessionId: string, workspaceId: string) => boolean): Promise<void> {
    const work: Promise<void>[] = []
    for (const [sessionId, runtime] of this.#runtimes.entries()) {
      const state = await this.#states.get(sessionId)?.catch(() => undefined)
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

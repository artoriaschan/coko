import type { ImageAttachment } from '@coko/protocol'
import type { ModelRegistry, PermissionMode, PermissionRule, RewindFiles, RewindMode, SecretProvider, ToolRegistry } from '@coko/agent'
import { getLogger } from '@coko/logging'
import type {
  AnswerApprovalRequest,
  Checkpoint,
  ConfirmationAnswer,
  PermissionsResponse,
  RewindResponse,
  Session,
  SessionBusyReason,
  SessionDetailResponse,
  SessionModel,
  SessionPermissionsResponse,
  ThinkingLevel,
  UpdatePermissionsRequest,
} from '@coko/protocol'
import { AppError } from './errors.ts'
import type { NewSession, Session as StoredSession, SessionStore } from '@coko/session'
import type { Model } from '@earendil-works/pi-ai'
import { SessionCheckpoints } from './checkpoints.ts'
import { emptyContextAssembly, type ActionResult, type ContextAssembly } from './context/index.ts'
import type { SessionHub } from './hub.ts'
import { hostToolNames, PermissionService } from './permissions.ts'
import { SessionRecovery, type RecoveryHook, type RecoveryReport, type RecoverySource } from './recovery.ts'
import { SessionModels } from './session-models.ts'
import { SessionPermissions, type PermissionScopeResolver } from './session-permissions.ts'
import { SessionRuns, type RunLauncher, type SessionCwd, type SessionExtension, type SessionExtensionContext } from './session-runs.ts'
import { requireSession, SessionRuntimes } from './session-runtimes.ts'

export type { RecoveryHook, RecoveryReport, RecoverySource } from './recovery.ts'
export type { RunLauncher, SessionCwd, SessionExtension, SessionExtensionContext } from './session-runs.ts'
export type { PermissionScopeResolver } from './session-permissions.ts'

const log = getLogger(['application', 'sessions'])

export interface SessionLifecycle {
  runningJobs(id: string): Promise<boolean>
  forget(ids: string[]): void
  quiesce<T>(ids: string[], task: () => Promise<T>): Promise<T>
}

export interface SessionServiceOptions {
  store: SessionStore
  registry: ModelRegistry
  hub: SessionHub
  runs: RunLauncher
  /** 没有设置默认模型时优先使用（faux provider 开启时）。 */
  fallbackModel?: SessionModel
  /** Workspace 的工具集；默认内置工具。桌面端以此覆盖 grep。 */
  tools?: (cwd: string) => ToolRegistry
  /**
   * 每个 Session 运行时的扩展（checkpoint 等经 runtime/layers.ts 注册，不改本文件）。hooks 排在权限判定之后；
   * onEntry 在每条条目提交并发布之后调用。
   */
  extensions?: (context: SessionExtensionContext) => SessionExtension
  /** 默认：基于 store 新建。 */
  permissions?: PermissionService
  /** 工具声明的 Secrets 的来源；只注入声明它们的那次调用。缺省：声明了 Secrets 的工具调用失败。 */
  secrets?: SecretProvider
  /** 回退代码读取快照正文与当前文件摘要（Sidecar 为 <dataDir>/blobs）。缺省：回退代码以 internal 失败。 */
  checkpoints?: RewindFiles
  /** M3 上下文装配（application/context/）。缺省：没有任何贡献，模型请求与 M2 相同。 */
  context?: ContextAssembly
  /** M5：Session 的工作目录（ADR 0016）。缺省 Workspace 目录。 */
  cwd?: SessionCwd
  /** M5：子 Session 的权限作用域（ADR 0014）。缺省每个 Session 是自己的根、没有上限。 */
  permissionScopes?: PermissionScopeResolver
  /**
   * 无人回答的运行（headless，ADR 0019）：需要审批的调用（含子代理的）在 PermissionRequest Hook 之后立即以 by headless 拒绝，模型看到
   * deniedText。缺省等待回答。
   */
  unattendedApprovals?: { deniedText: string }
}

/**
 * Session 的协议入口：DTO 与 Run 控制（开始、重试、继续、追加指令、暂停、停止）。运行时注册表、模型与档位、开始 Run 与运行时构造、
 * 权限、启动恢复与结果确认、Checkpoint 各在 session-runtimes.ts、session-models.ts、session-runs.ts、session-permissions.ts、
 * recovery.ts、checkpoints.ts，这里只转交。
 */
export class SessionService {
  readonly #hub: SessionHub
  readonly #store: SessionStore
  readonly #runtimes: SessionRuntimes
  readonly #permissions: SessionPermissions
  readonly #recovery: SessionRecovery
  readonly #checkpoints: SessionCheckpoints
  readonly #models: SessionModels
  readonly #runs: SessionRuns
  readonly #context: ContextAssembly
  readonly #deleting = new Set<string>()
  readonly #mutations = new Map<string, number>()
  #lifecycle: SessionLifecycle | undefined
  readonly permissions: PermissionService

  constructor(options: SessionServiceOptions) {
    const { store } = options
    this.#store = store
    this.#hub = options.hub
    this.#context = options.context ?? emptyContextAssembly()
    // 规则工具名：宿主工具集与各贡献声明的 ruleTools（skill 由 policy 固定为 Skill，mcp__ 前缀由 policy 原样接受）。
    this.permissions =
      options.permissions ??
      new PermissionService(store, hostToolNames({ ...(options.tools ? { tools: options.tools } : {}), ruleTools: this.#context.ruleTools }))
    this.#runtimes = new SessionRuntimes(store, options.hub)
    this.#permissions = new SessionPermissions({
      store,
      runtimes: this.#runtimes,
      service: this.permissions,
      contributions: this.#context.contributions,
      ...(options.permissionScopes ? { scopes: options.permissionScopes } : {}),
      ...(options.unattendedApprovals ? { unattended: options.unattendedApprovals } : {}),
    })
    this.#recovery = new SessionRecovery({
      store,
      runtimes: this.#runtimes,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      locked: (sessionId, task) => this.#permissions.locked(sessionId, task),
    })
    this.#checkpoints = new SessionCheckpoints({
      store,
      runtimes: this.#runtimes,
      recovery: this.#recovery,
      ...(options.checkpoints ? { files: options.checkpoints } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
    })
    this.#models = new SessionModels({
      store,
      registry: options.registry,
      runtimes: this.#runtimes,
      ...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
    })
    this.#runs = new SessionRuns({
      store,
      registry: options.registry,
      hub: options.hub,
      runs: options.runs,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.extensions ? { extensions: options.extensions } : {}),
      ...(options.secrets ? { secrets: options.secrets } : {}),
      context: this.#context,
      runtimes: this.#runtimes,
      permissions: this.#permissions,
      recovery: this.#recovery,
      checkpoints: this.#checkpoints,
      models: this.#models,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    })
    this.#runs.useAdmission((id) => this.assertAdmission(id))
  }

  useLifecycle(lifecycle: SessionLifecycle): void {
    this.#lifecycle = lifecycle
  }

  async #mutate<T>(id: string, task: () => Promise<T>): Promise<T> {
    this.assertAdmission(id)
    this.#mutations.set(id, (this.#mutations.get(id) ?? 0) + 1)
    try {
      return await task()
    } finally {
      const left = this.#mutations.get(id)! - 1
      if (left) this.#mutations.set(id, left)
      else this.#mutations.delete(id)
    }
  }

  /** Short detached writes share deletion admission without making the whole request a running Run. */
  async completeTitle(sessionId: string, expected: string, title: string | undefined, payload: import('@coko/agent').ModelRequestPayload): Promise<void> {
    await this.#mutate(sessionId, async () => {
      if (!(await this.#store.sessions.getSession(sessionId))) return
      const updated = title ? await this.#store.sessions.replaceSessionTitle(sessionId, expected, title) : undefined
      if (updated) this.#hub.publishTitle(sessionId, updated.title)
      await this.#runtimes.commitDetached(sessionId, { kind: 'model_request', payload })
    })
  }

  assertAdmission(sessionId: string): void {
    if (this.#deleting.has(sessionId)) throw new AppError('session-busy', 'The conversation is being deleted')
  }

  async delete(sessionId: string): Promise<{ sessionIds: string[] }> {
    this.assertAdmission(sessionId)
    this.#deleting.add(sessionId)
    const tree: StoredSession[] = []
    try {
      const visit = async (id: string) => {
        this.#deleting.add(id)
        tree.push(await requireSession(this.#store, id))
        for (const child of await this.#store.sessions.listChildren(id)) await visit(child.id)
      }
      await visit(sessionId)
      const reasons = new Set<SessionBusyReason>()
      const busy: { id: string; title: string }[] = []
      for (const session of tree) {
        let involved = false
        if (this.#runs.busy(session.id) || this.#mutations.has(session.id)) {
          reasons.add(session.id === sessionId ? 'run' : 'agent')
          involved = true
        }
        if (await this.#lifecycle?.runningJobs(session.id)) {
          reasons.add('job')
          involved = true
        }
        if (involved) busy.push({ id: session.id, title: session.title })
      }
      if (reasons.size) throw new AppError('session-busy', 'The conversation has ongoing work', { reasons: [...reasons], sessions: busy })
      const ids = tree.map((session) => session.id)
      const remove = async () => {
        const sessionIds = await this.#store.sessions.deleteSession(sessionId)
        for (const id of sessionIds) {
          this.#runtimes.forget(id)
          this.#permissions.forget(id)
          this.#recovery.forget(id)
        }
        this.#lifecycle?.forget(sessionIds)
        return { sessionIds }
      }
      return this.#lifecycle ? await this.#lifecycle.quiesce(ids, remove) : await remove()
    } finally {
      this.#deleting.delete(sessionId)
      for (const session of tree) this.#deleting.delete(session.id)
    }
  }

  /** 开始 Run 的统一入口与运行控制（session-runs.ts）；Goal 与后台任务经它开始 Goal Round、送达通知。 */
  get runs(): SessionRuns {
    return this.#runs
  }

  isRunning(sessionId: string): boolean {
    return this.#runtimes.isRunning(sessionId)
  }

  activeRuns(): number {
    return this.#runtimes.activeRuns()
  }

  /** 协议 DTO：parentSessionId 只在子 Session 上出现，worktree 为创建时绑定的 worktree（含已移除的）。 */
  async toDto(stored: StoredSession): Promise<Session> {
    const { parentSessionId, worktreeId, ...rest } = stored
    let root = stored
    while (root.parentSessionId !== null) {
      const parent = await this.#store.sessions.getSession(root.parentSessionId)
      if (!parent) break
      root = parent
    }
    const worktree = worktreeId === null ? undefined : await this.#store.worktrees.get(worktreeId)
    const session = {
      ...rest,
      projectId: root.projectId,
      thinkingLevel: this.#models.effectiveLevel(stored),
      ...(parentSessionId === null ? {} : { parentSessionId }),
      ...(worktree ? { worktree: { id: worktree.id, name: worktree.name, branch: worktree.branch, status: worktree.status } } : {}),
    }
    const runtime = this.#runtimes.get(session.id)
    const running = runtime?.isRunning ?? false
    // 任一 running 子代理在等待审批时父 Session 也是 awaiting-approval（审批在父会话中回答，ADR 0014）。
    const waiting = (runtime?.pendingApprovals.length ?? 0) > 0 || this.#runs.childAwaitingApproval(session.id)
    if (running) return { ...session, running, activity: waiting ? 'awaiting-approval' : 'running' }
    if (waiting) return { ...session, running, activity: 'awaiting-approval' }
    if (this.#recovery.failed(session.id)) return { ...session, running, activity: 'interrupted' }
    if (this.#recovery.awaitsConfirmation(session.id)) return { ...session, running, activity: 'awaiting-confirmation' }
    const last = this.#runtimes.lastStatus(session.id)
    return { ...session, running, activity: last === 'paused' || last === 'interrupted' ? last : 'idle' }
  }

  // ---- 启动恢复与结果确认（recovery.ts） ----

  recover(source: RecoverySource, hooks?: readonly RecoveryHook[]): Promise<RecoveryReport> {
    return this.#recovery.recover(source, hooks)
  }

  answerConfirmation(sessionId: string, toolCallId: string, answer: ConfirmationAnswer): Promise<void> {
    return this.#recovery.answerConfirmation(sessionId, toolCallId, answer)
  }

  // ---- 权限（session-permissions.ts） ----

  sessionPermissions(sessionId: string): Promise<SessionPermissionsResponse> {
    return this.#permissions.sessionPermissions(sessionId)
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<SessionPermissionsResponse> {
    return this.#permissions.setMode(sessionId, mode)
  }

  changeSessionRule(sessionId: string, op: 'add' | 'remove', rule: PermissionRule): Promise<SessionPermissionsResponse> {
    return this.#permissions.changeSessionRule(sessionId, op, rule)
  }

  getPermissions(workspaceId?: string): Promise<PermissionsResponse> {
    return this.#permissions.get(workspaceId)
  }

  updatePermissions(request: UpdatePermissionsRequest): Promise<PermissionsResponse> {
    return this.#permissions.update(request)
  }

  answerApproval(sessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<void> {
    return this.#permissions.answerApproval(sessionId, requestId, answer)
  }

  // ---- Checkpoint：回退与分叉（checkpoints.ts，ADR 0006） ----

  checkpoints(sessionId: string): Promise<Checkpoint[]> {
    return this.#checkpoints.list(sessionId)
  }

  rewind(sessionId: string, input: { targetSeq: number; mode: RewindMode; dryRun?: boolean }): Promise<RewindResponse> {
    return this.#mutate(sessionId, () => this.#checkpoints.rewind(sessionId, input))
  }

  fork(sessionId: string, targetSeq: number, title?: string): Promise<{ sessionId: string; text: string }> {
    return this.#mutate(sessionId, () => this.#checkpoints.fork(sessionId, targetSeq, title))
  }

  // ---- DTO 与模型（session-models.ts） ----

  async list(workspaceId?: string): Promise<Session[]> {
    // 子 Session 不在列表中（store 的 listSessions 只列根 Session）。
    const sessions = await this.#store.sessions.listSessions(workspaceId ? { workspaceId } : {})
    return Promise.all(sessions.map((session) => this.toDto(session)))
  }

  async moveToProject(sessionId: string, projectId: string | null): Promise<Session> {
    const session = await requireSession(this.#store, sessionId)
    if (session.parentSessionId !== null) throw new AppError('bad-request', 'Only root sessions can be moved')
    if (projectId !== null && !(await this.#store.projects.get(projectId))) throw new AppError('not-found', 'Project not found')
    return this.toDto(await this.#store.sessions.setSessionOrganization(sessionId, { projectId }))
  }

  async setPinned(sessionId: string, pinned: boolean): Promise<Session> {
    const session = await requireSession(this.#store, sessionId)
    if (session.parentSessionId !== null) throw new AppError('bad-request', 'Only root sessions can be pinned')
    return this.toDto(await this.#store.sessions.setSessionOrganization(sessionId, { pinnedAt: pinned ? (session.pinnedAt ?? Date.now()) : null }))
  }

  async rename(sessionId: string, input: string): Promise<Session> {
    const title = input.trim()
    if (!title || Array.from(title).length > 200) throw new AppError('bad-request', 'Session title must contain 1 to 200 characters')
    await requireSession(this.#store, sessionId)
    return this.toDto(await this.#store.sessions.setSessionTitle(sessionId, title))
  }

  /** 子 Session（子代理）按创建顺序。 */
  async children(parentSessionId: string): Promise<Session[]> {
    return Promise.all((await this.#store.sessions.listChildren(parentSessionId)).map((session) => this.toDto(session)))
  }

  /**
   * 新建 Session。worktreeId 绑定同一 Workspace 的 worktree（ADR 0016，工作目录见 SessionCwd）；parentSessionId 创建子 Session
   * （子代理，ADR 0014）。两者必须属于同一 Workspace，否则 400。
   */
  async create(input: {
    id?: string
    workspaceId: string
    projectId?: string | null
    permissionMode?: PermissionMode
    title?: string
    model?: SessionModel
    thinkingLevel?: ThinkingLevel
    worktreeId?: string
    parentSessionId?: string
  }): Promise<Session> {
    const { model, thinkingLevel } = await this.#models.initial(input)
    const mode = input.permissionMode ?? (await this.permissions.defaultMode())
    const session = await this.createRecord({
      ...(input.id === undefined ? {} : { id: input.id }),
      workspaceId: input.workspaceId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      model: model ?? null,
      thinkingLevel,
      ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
      ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    })
    // 初始模式也是条目：之后默认模式改变不影响已有 Session（ADR 0005）。
    await this.#runtimes.commit(session.id, { kind: 'permission_mode', payload: { mode } })
    log.info('session created', { sessionId: session.id, workspaceId: session.workspaceId, mode })
    return this.toDto(session)
  }

  /**
   * 会话记录的唯一创建入口（根 Session、子代理的子 Session、交接的目标）：绑定的 worktree 已移除时 409 worktree-removed（ADR 0016：移除后
   * 绑定的会话只读，新建一个一开始就只读的会话没有意义）。首条条目由调用方提交（permission_mode、subagent_origin 或 handoff_origin）。
   */
  async createRecord(input: NewSession): Promise<StoredSession> {
    if (input.worktreeId) {
      const worktree = await this.#store.worktrees.get(input.worktreeId)
      if (worktree?.status === 'removed') throw new AppError('worktree-removed', `Worktree ${worktree.name} was removed; create the session elsewhere`)
    }
    if (!input.parentSessionId) return this.#store.sessions.createSession(input)
    const parent = input.parentSessionId
    return this.#mutate(parent, () => this.#store.sessions.createSession(input))
  }

  async detail(sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.#get(sessionId)
    const entries = await this.#store.sessions.listEntries(sessionId)
    this.#runtimes.rememberStatus(sessionId, entries)
    return { session: await this.toDto(session), entries }
  }

  /** 设置 defaultModel → faux（测试）→ 第一个 Provider 的第一个模型；都不可用时为 undefined。 */
  defaultModel(): Promise<SessionModel | undefined> {
    return this.#models.defaultModel()
  }

  /** 该 Session 当前（或将用的默认）模型是否已定价（见 SessionModels.modelPriced；Goal 的费用上限）。 */
  modelPriced(sessionId: string): Promise<boolean> {
    return this.#models.modelPriced(sessionId)
  }

  /** 上下文用量接口的模型：给定的 Session 模型，否则缺省模型；都不能解析时 undefined。 */
  contextModel(model: SessionModel | null | undefined): Promise<Model<any> | undefined> {
    return this.#models.contextModel(model)
  }

  /** 该 Workspace 的基础工具集（与运行时相同的工厂；上下文用量接口按其定义计工具分项）。 */
  baseTools(cwd: string): ToolRegistry {
    return this.#runs.baseTools(cwd)
  }

  /** 模型与 Thinking Level 一起切换并写入 Session（见 SessionModels.setModel）。 */
  async setModel(sessionId: string, model: SessionModel, thinkingLevel?: ThinkingLevel): Promise<Session> {
    return this.toDto(await this.#models.setModel(sessionId, model, thinkingLevel))
  }

  // ---- Run 控制（开始 Run 与运行时构造在 session-runs.ts） ----

  /** 提交一条消息：开始 Run（{ runId }）或执行不开始 Run 的动作（{ done: true }）；见 SessionRuns.submit。 */
  submit(sessionId: string, text: string, images?: ImageAttachment[]): Promise<ActionResult> {
    return this.#runs.submit(sessionId, text, false, images)
  }

  /** 首次发送的成功边界是首条用户消息提交，而不是同步的 Run 进度。 */
  submitFirst(sessionId: string, text: string, images?: ImageAttachment[]): Promise<ActionResult> {
    return this.#runs.submit(sessionId, text, true, images)
  }

  /** 首次发送的预接受失败：Run 尚未提交用户输入，释放运行时后回滚新建记录。 */
  async rollbackFirst(sessionId: string): Promise<void> {
    this.#runtimes.discard(sessionId)
    await this.#store.sessions.deleteSession(sessionId)
  }

  /** 自动压缩是否因连续失败暂停（运行时内存；还没有运行时的 Session 为 false）。 */
  compactionPaused(sessionId: string): boolean {
    return this.#runtimes.get(sessionId)?.compaction.paused ?? false
  }

  /** 重新执行出错的上一轮（不追加用户消息）；上一轮没有出错时以 nothing-to-retry 拒绝。 */
  retry(sessionId: string): Promise<{ runId: string }> {
    return this.#runs.startRun(sessionId, { trigger: 'retry' })
  }

  /**
   * 接着暂停或中断的上一 Run 开始新 Run（trigger continue）。上一 Run 不是 paused / interrupted 时 nothing-to-continue；
   * 有未回答的结果确认时 confirmation-pending（未配对的调用会破坏模型请求）。
   */
  continue(sessionId: string): Promise<{ runId: string }> {
    return this.#runs.startRun(sessionId, { trigger: 'continue' })
  }

  /** 把追加指令送进当前 Run（先经上下文装配展开；展开为动作时 bad-request）；没有进行中的 Run 时 no-active-run。 */
  steer(sessionId: string, text: string): Promise<void> {
    return this.#runs.steer(sessionId, text)
  }

  /** 暂停当前 Run（本批完成后以 paused 结束）；没有进行中的 Run 时 no-active-run。 */
  pause(sessionId: string): Promise<void> {
    return this.#runs.pause(sessionId)
  }

  /** 返回是否确有进行中的 Run 被要求停止。 */
  abort(sessionId: string): Promise<boolean> {
    return this.#runs.abort(sessionId)
  }

  #get(sessionId: string): Promise<StoredSession> {
    return requireSession(this.#store, sessionId)
  }
}

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import {
  createAgentRuntime,
  effectiveMessages,
  lastRunStatus,
  ModelConfigError,
  NoActiveRunError,
  NothingToContinueError,
  NothingToRetryError,
  resolveModel,
  type AgentRuntime,
  type ModelRegistry,
  type PermissionMode,
  type PermissionRule,
  type RewindFiles,
  type RewindMode,
  type RunEntry,
  type RunResult,
  type SecretProvider,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import {
  type ConfirmationAnswer,
  DEFAULT_MODEL_SETTING,
  SessionModel as SessionModelSchema,
  type AnswerApprovalRequest,
  type Checkpoint,
  type RewindResponse,
  type Session,
  type SessionPermissionsResponse,
  type UpdatePermissionsRequest,
  type PermissionsResponse,
  type SessionDetailResponse,
  type SessionModel,
} from '@coko/protocol'
import type { SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { SessionCheckpoints } from './checkpoints.ts'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import { PermissionService } from './permissions.ts'
import { SessionRecovery, type RecoveryReport, type RecoverySource } from './recovery.ts'
import { SessionPermissions } from './session-permissions.ts'
import { requireSession, SessionRuntimes, toProgress } from './session-runtimes.ts'

export type { RecoveryReport, RecoverySource } from './recovery.ts'

const log = getLogger(['application', 'sessions'])

/** 受管的 Run 执行：关闭 sidecar 时中断并等待 Run 结束（run_end 已提交）。由 runtime 层用 Effect 实现。 */
export interface RunLauncher {
  /** key 每个 Run 唯一。run 不会 reject。 */
  launch(key: string, run: Promise<unknown>, abort: () => void): void
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
}

export interface SessionExtensionContext {
  sessionId: string
  /** Workspace 目录。 */
  cwd: string
  /** 提交并发布一条条目（payload 按注册表校验）。 */
  commit: (entry: RunEntry) => Promise<StoredEntry>
}

export interface SessionExtension {
  hooks?: ToolHooks[]
  onEntry?: (entry: StoredEntry) => void
}

/**
 * Session 的协议入口：DTO 与 Run 控制（开始、重试、继续、追加指令、暂停、停止）。运行时注册表、权限、启动恢复与结果确认、
 * Checkpoint 各在 session-runtimes.ts、session-permissions.ts、recovery.ts、checkpoints.ts，这里只转交。
 */
export class SessionService {
  readonly #options: SessionServiceOptions
  readonly #runtimes: SessionRuntimes
  readonly #permissions: SessionPermissions
  readonly #recovery: SessionRecovery
  readonly #checkpoints: SessionCheckpoints
  readonly permissions: PermissionService

  constructor(options: SessionServiceOptions) {
    this.#options = options
    this.permissions = options.permissions ?? new PermissionService(options.store, () => this.#hostToolNames())
    this.#runtimes = new SessionRuntimes(options.store, options.hub)
    this.#permissions = new SessionPermissions({ store: options.store, runtimes: this.#runtimes, service: this.permissions })
    this.#recovery = new SessionRecovery({
      store: options.store,
      runtimes: this.#runtimes,
      ...(options.tools ? { tools: options.tools } : {}),
      locked: (sessionId, task) => this.#permissions.locked(sessionId, task),
    })
    this.#checkpoints = new SessionCheckpoints({
      store: options.store,
      runtimes: this.#runtimes,
      recovery: this.#recovery,
      ...(options.checkpoints ? { files: options.checkpoints } : {}),
    })
  }

  #toolNames: readonly string[] | undefined
  /** 宿主注册的工具名（与 Workspace 无关；第一次需要时从工具工厂读取）。 */
  #hostToolNames(): readonly string[] {
    this.#toolNames ??= this.#options.tools
      ? this.#options
          .tools(process.cwd())
          .list()
          .map((tool) => tool.name)
      : []
    return this.#toolNames
  }

  isRunning(sessionId: string): boolean {
    return this.#runtimes.isRunning(sessionId)
  }

  activeRuns(): number {
    return this.#runtimes.activeRuns()
  }

  toDto(session: StoredSession): Session {
    const runtime = this.#runtimes.get(session.id)
    const running = runtime?.isRunning ?? false
    if (running) return { ...session, running, activity: runtime!.pendingApprovals.length > 0 ? 'awaiting-approval' : 'running' }
    if (this.#recovery.failed(session.id)) return { ...session, running, activity: 'interrupted' }
    if (this.#recovery.awaitsConfirmation(session.id)) return { ...session, running, activity: 'awaiting-confirmation' }
    const last = this.#runtimes.lastStatus(session.id)
    return { ...session, running, activity: last === 'paused' || last === 'interrupted' ? last : 'idle' }
  }

  // ---- 启动恢复与结果确认（recovery.ts） ----

  recover(source: RecoverySource): Promise<RecoveryReport> {
    return this.#recovery.recover(source)
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
    return this.#checkpoints.rewind(sessionId, input)
  }

  fork(sessionId: string, targetSeq: number, title?: string): Promise<{ sessionId: string; text: string }> {
    return this.#checkpoints.fork(sessionId, targetSeq, title)
  }

  // ---- DTO ----

  async list(workspaceId?: string): Promise<Session[]> {
    const sessions = await this.#options.store.sessions.listSessions(workspaceId ? { workspaceId } : {})
    return sessions.map((session) => this.toDto(session))
  }

  async create(input: { workspaceId: string; title?: string; model?: SessionModel }): Promise<Session> {
    if (input.model) this.#resolve(input.model, 'bad-request')
    const model = input.model ?? (await this.defaultModel())
    const mode = await this.permissions.defaultMode()
    const session = await this.#options.store.sessions.createSession({
      workspaceId: input.workspaceId,
      ...(input.title === undefined ? {} : { title: input.title }),
      model: model ?? null,
    })
    // 初始模式也是条目：之后默认模式改变不影响已有 Session（ADR 0005）。
    await this.#runtimes.commit(session.id, { kind: 'permission_mode', payload: { mode } })
    log.info('session created', { sessionId: session.id, workspaceId: session.workspaceId, mode })
    return this.toDto(session)
  }

  async detail(sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.#get(sessionId)
    const entries = await this.#options.store.sessions.listEntries(sessionId)
    this.#runtimes.rememberStatus(sessionId, entries)
    return { session: this.toDto(session), entries }
  }

  /** 设置 defaultModel → faux（测试）→ 第一个 Provider 的第一个模型；都不可用时为 undefined。 */
  async defaultModel(): Promise<SessionModel | undefined> {
    const setting = await this.#options.store.settings.get(DEFAULT_MODEL_SETTING)
    const candidates: unknown[] = [setting?.value, this.#options.fallbackModel]
    for (const provider of await this.#options.store.providers.list()) {
      if (provider.models[0]) candidates.push({ providerId: provider.id, modelId: provider.models[0] })
    }
    for (const candidate of candidates) {
      if (!Value.Check(SessionModelSchema, candidate)) continue
      if (this.#options.registry.models.getModel(candidate.providerId, candidate.modelId))
        return { providerId: candidate.providerId, modelId: candidate.modelId }
    }
    return undefined
  }

  async setModel(sessionId: string, model: SessionModel): Promise<Session> {
    await this.#get(sessionId)
    const resolved = this.#resolve(model, 'bad-request')
    const runtime = this.#runtimes.get(sessionId)
    if (runtime?.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    const session = await this.#options.store.sessions.setSessionModel(sessionId, model)
    runtime?.setModel(resolved)
    return this.toDto(session)
  }

  // ---- Run 控制 ----

  /** 开始一个 Run 并立即返回 runId；Run 的条目与进度经 hub 推送。 */
  submit(sessionId: string, text: string): Promise<{ runId: string }> {
    return this.#start(sessionId, (runtime) => runtime.run(text))
  }

  /** 重新执行出错的上一轮（不追加用户消息）；上一轮没有出错时以 nothing-to-retry 拒绝。 */
  retry(sessionId: string): Promise<{ runId: string }> {
    return this.#start(sessionId, (runtime) => runtime.retry())
  }

  /**
   * 接着暂停或中断的上一 Run 开始新 Run（trigger continue）。上一 Run 不是 paused / interrupted 时 nothing-to-continue；
   * 有未回答的结果确认时 confirmation-pending（未配对的调用会破坏模型请求）。
   */
  continue(sessionId: string): Promise<{ runId: string }> {
    return this.#start(sessionId, (runtime) => runtime.continue())
  }

  /** 把追加指令送进当前 Run；没有进行中的 Run 时 no-active-run。 */
  async steer(sessionId: string, text: string): Promise<void> {
    await this.#get(sessionId)
    const runtime = this.#runtimes.get(sessionId)
    try {
      if (!runtime) throw new NoActiveRunError()
      runtime.steer(text)
    } catch (error) {
      if (error instanceof NoActiveRunError) throw new AppError('no-active-run', error.message)
      throw error
    }
    log.info('steering queued', { sessionId })
  }

  /** 暂停当前 Run（本批完成后以 paused 结束）；没有进行中的 Run 时 no-active-run。 */
  async pause(sessionId: string): Promise<void> {
    await this.#get(sessionId)
    const runtime = this.#runtimes.get(sessionId)
    try {
      if (!runtime) throw new NoActiveRunError()
      runtime.pause()
    } catch (error) {
      if (error instanceof NoActiveRunError) throw new AppError('no-active-run', error.message)
      throw error
    }
    log.info('run pause requested', { sessionId })
  }

  async #start(sessionId: string, start: (runtime: AgentRuntime) => Promise<RunResult>): Promise<{ runId: string }> {
    let session = await this.#get(sessionId)
    await this.#recovery.ensureRecovered(sessionId)
    // 未回答的结果确认之后不能开始任何 Run（submit、retry、continue）：未配对的调用会破坏模型请求（recovery.md）。
    if (this.#recovery.awaitsConfirmation(sessionId)) throw new AppError('confirmation-pending', 'An outcome confirmation is waiting for an answer')
    if (!session.model) {
      const model = await this.defaultModel()
      if (!model) throw new AppError('model-not-configured', 'No model is configured; add a Provider in settings')
      session = await this.#options.store.sessions.setSessionModel(sessionId, model)
    }
    const model = this.#resolve(session.model!, 'model-not-configured')
    const runtime = await this.#runtimes.obtain(session.id, () => this.#createRuntime(session, model))
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    // 回退或分叉进行中：运行时可能即将按新的有效上下文重建。
    if (this.#checkpoints.busy(sessionId)) throw new AppError('session-busy', 'The session is being rewound or forked')
    runtime.setModel(model)

    // run() 在第一个 await 之前同步发出 run_start，借此在 Run 结束前拿到 runId。
    let runId: string | undefined
    const off = runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'run_start') runId ??= event.event.runId
    })
    const run = start(runtime)
    off()
    if (runId === undefined) {
      const error = await run.then(
        () => undefined,
        (e: unknown) => e,
      )
      if (error instanceof NothingToRetryError) throw new AppError('nothing-to-retry', error.message)
      if (error instanceof NothingToContinueError) throw new AppError('nothing-to-continue', error.message)
      throw new AppError('run-in-progress', 'A Run is in progress')
    }
    const started = runId
    log.info('run started', { sessionId, runId: started, providerId: session.model!.providerId, modelId: session.model!.modelId })
    const done = run.then(
      (result) =>
        log.info('run ended', {
          sessionId,
          runId: started,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
          ...(result.undeliveredSteering ? { undeliveredSteering: result.undeliveredSteering.length } : {}),
        }),
      (error: unknown) => log.error('run failed', { sessionId, runId: started, error: String(error) }),
    )
    this.#options.runs.launch(`${sessionId}:${started}`, done, () => runtime.abort())
    return { runId: started }
  }

  /** 返回是否确有进行中的 Run 被要求停止。 */
  async abort(sessionId: string): Promise<boolean> {
    await this.#get(sessionId)
    const runtime = this.#runtimes.get(sessionId)
    if (!runtime?.isRunning) return false
    runtime.abort()
    log.info('run abort requested', { sessionId })
    return true
  }

  #get(sessionId: string): Promise<StoredSession> {
    return requireSession(this.#options.store, sessionId)
  }

  #resolve(model: SessionModel, code: 'bad-request' | 'model-not-configured'): Model<any> {
    try {
      return resolveModel(this.#options.registry, model.providerId, model.modelId)
    } catch (error) {
      if (error instanceof ModelConfigError) throw new AppError(code, error.message)
      throw error
    }
  }

  async #createRuntime(session: StoredSession, model: Model<any>): Promise<AgentRuntime> {
    const { store, registry, hub } = this.#options
    const workspace = await store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    // 恢复 Session：已提交的 message 条目就是模型可见的对话记录。
    const entries = await store.sessions.listEntries(session.id)
    // 被回退的区间不进入模型上下文（ADR 0006）。
    const messages: AgentMessage[] = effectiveMessages(entries)
    const previous = lastRunStatus(entries)
    if (previous) this.#runtimes.setLastStatus(session.id, previous)
    const permissions = await this.#permissions.state(session)
    let extension: SessionExtension = {}
    const publish = this.#runtimes.publisher(session.id, () => extension.onEntry)
    if (this.#options.extensions) extension = this.#options.extensions({ sessionId: session.id, cwd: workspace.path, commit: publish })
    const runtime = createAgentRuntime({
      models: registry.models,
      model,
      cwd: workspace.path,
      ...(this.#options.tools ? { tools: this.#options.tools(workspace.path) } : {}),
      sessionId: session.id,
      messages,
      ...(previous ? { lastRunStatus: previous } : {}),
      permissions: this.#permissions.runtimePermissions(permissions, session.workspaceId),
      ...(extension.hooks ? { hooks: extension.hooks } : {}),
      ...(this.#options.secrets ? { secrets: this.#options.secrets } : {}),
      commit: async (entry) => {
        await publish(entry)
      },
    })
    runtime.subscribe((event) => {
      if (event.kind === 'progress') hub.publishProgress(session.id, event.event.runId, toProgress(event.event))
    })
    return runtime
  }
}

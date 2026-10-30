import type { ModelRegistry, PermissionMode, PermissionRule, RewindFiles, RewindMode, SecretProvider, ToolRegistry } from '@coko/agent'
import { getLogger } from '@coko/logging'
import type {
  AnswerApprovalRequest,
  Checkpoint,
  ConfirmationAnswer,
  PermissionsResponse,
  RewindResponse,
  Session,
  SessionDetailResponse,
  SessionModel,
  SessionPermissionsResponse,
  ThinkingLevel,
  UpdatePermissionsRequest,
} from '@coko/protocol'
import type { Session as StoredSession, SessionStore } from '@coko/session'
import type { Model } from '@earendil-works/pi-ai'
import { SessionCheckpoints } from './checkpoints.ts'
import { emptyContextAssembly, type ContextAssembly } from './context/index.ts'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import { hostToolNames, PermissionService } from './permissions.ts'
import { SessionRecovery, type RecoveryReport, type RecoverySource } from './recovery.ts'
import { SessionModels } from './session-models.ts'
import { SessionPermissions } from './session-permissions.ts'
import { SessionRuns, type RunLauncher, type SessionExtension, type SessionExtensionContext } from './session-runs.ts'
import { requireSession, SessionRuntimes } from './session-runtimes.ts'

export type { RecoveryReport, RecoverySource } from './recovery.ts'
export type { RunLauncher, SessionExtension, SessionExtensionContext } from './session-runs.ts'

const log = getLogger(['application', 'sessions'])

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
}

/**
 * Session 的协议入口：DTO 与 Run 控制（开始、重试、继续、追加指令、暂停、停止）。运行时注册表、模型与档位、开始 Run 与运行时构造、
 * 权限、启动恢复与结果确认、Checkpoint 各在 session-runtimes.ts、session-models.ts、session-runs.ts、session-permissions.ts、
 * recovery.ts、checkpoints.ts，这里只转交。
 */
export class SessionService {
  readonly #store: SessionStore
  readonly #runtimes: SessionRuntimes
  readonly #permissions: SessionPermissions
  readonly #recovery: SessionRecovery
  readonly #checkpoints: SessionCheckpoints
  readonly #models: SessionModels
  readonly #runs: SessionRuns
  readonly #context: ContextAssembly
  readonly permissions: PermissionService

  constructor(options: SessionServiceOptions) {
    const { store } = options
    this.#store = store
    this.#context = options.context ?? emptyContextAssembly()
    // 规则工具名：宿主工具集与各贡献声明的 ruleTools（skill 由 policy 固定为 Skill，mcp__ 前缀由 policy 原样接受）。
    this.permissions =
      options.permissions ??
      new PermissionService(store, hostToolNames({ ...(options.tools ? { tools: options.tools } : {}), ruleTools: this.#context.ruleTools }))
    this.#runtimes = new SessionRuntimes(store, options.hub)
    this.#permissions = new SessionPermissions({ store, runtimes: this.#runtimes, service: this.permissions })
    this.#recovery = new SessionRecovery({
      store,
      runtimes: this.#runtimes,
      ...(options.tools ? { tools: options.tools } : {}),
      locked: (sessionId, task) => this.#permissions.locked(sessionId, task),
    })
    this.#checkpoints = new SessionCheckpoints({
      store,
      runtimes: this.#runtimes,
      recovery: this.#recovery,
      ...(options.checkpoints ? { files: options.checkpoints } : {}),
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
    })
  }

  isRunning(sessionId: string): boolean {
    return this.#runtimes.isRunning(sessionId)
  }

  activeRuns(): number {
    return this.#runtimes.activeRuns()
  }

  toDto(stored: StoredSession): Session {
    const session = { ...stored, thinkingLevel: this.#models.effectiveLevel(stored) }
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

  // ---- DTO 与模型（session-models.ts） ----

  async list(workspaceId?: string): Promise<Session[]> {
    const sessions = await this.#store.sessions.listSessions(workspaceId ? { workspaceId } : {})
    return sessions.map((session) => this.toDto(session))
  }

  async create(input: { workspaceId: string; title?: string; model?: SessionModel; thinkingLevel?: ThinkingLevel }): Promise<Session> {
    const { model, thinkingLevel } = await this.#models.initial(input)
    const mode = await this.permissions.defaultMode()
    const session = await this.#store.sessions.createSession({
      workspaceId: input.workspaceId,
      ...(input.title === undefined ? {} : { title: input.title }),
      model: model ?? null,
      thinkingLevel,
    })
    // 初始模式也是条目：之后默认模式改变不影响已有 Session（ADR 0005）。
    await this.#runtimes.commit(session.id, { kind: 'permission_mode', payload: { mode } })
    log.info('session created', { sessionId: session.id, workspaceId: session.workspaceId, mode })
    return this.toDto(session)
  }

  async detail(sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.#get(sessionId)
    const entries = await this.#store.sessions.listEntries(sessionId)
    this.#runtimes.rememberStatus(sessionId, entries)
    return { session: this.toDto(session), entries }
  }

  /** 设置 defaultModel → faux（测试）→ 第一个 Provider 的第一个模型；都不可用时为 undefined。 */
  defaultModel(): Promise<SessionModel | undefined> {
    return this.#models.defaultModel()
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

  /**
   * 开始一个 Run 并立即返回 runId；Run 的条目与进度经 hub 推送。Run 进行中先以 run-in-progress 拒绝，不展开输入（展开可能调用 MCP
   * prompts/get、读取 Skill 与引用的文件）。之后提交的文本经上下文装配展开（命令 → File Reference）；展开为动作（例如 /compact）时调用
   * 该动作。展开期间另一个 Run 开始时，start 与动作照常再检查一次。
   */
  async submit(sessionId: string, text: string): Promise<{ runId: string }> {
    const session = await this.#get(sessionId)
    if (this.#runtimes.isRunning(sessionId)) throw new AppError('run-in-progress', 'A Run is in progress')
    const expanded = await this.#context.expandInput(text, await this.#runs.scope(session))
    if (expanded.kind === 'input') return this.#runs.start(sessionId, (runtime) => runtime.run(expanded.input))
    if (this.#runtimes.isRunning(sessionId)) throw new AppError('run-in-progress', 'A Run is in progress')
    const action = this.#context.action(expanded.name)
    if (!action) throw new AppError('bad-request', `Unknown action ${expanded.name}`)
    return action({
      scope: await this.#runs.scope(session),
      sessionId,
      args: expanded.args,
      session: { entries: () => this.#store.sessions.listEntries(sessionId), start: (run) => this.#runs.start(sessionId, run) },
    })
  }

  /** 自动压缩是否因连续失败暂停（运行时内存；还没有运行时的 Session 为 false）。 */
  compactionPaused(sessionId: string): boolean {
    return this.#runtimes.get(sessionId)?.compaction.paused ?? false
  }

  /** 重新执行出错的上一轮（不追加用户消息）；上一轮没有出错时以 nothing-to-retry 拒绝。 */
  retry(sessionId: string): Promise<{ runId: string }> {
    return this.#runs.start(sessionId, (runtime) => runtime.retry())
  }

  /**
   * 接着暂停或中断的上一 Run 开始新 Run（trigger continue）。上一 Run 不是 paused / interrupted 时 nothing-to-continue；
   * 有未回答的结果确认时 confirmation-pending（未配对的调用会破坏模型请求）。
   */
  continue(sessionId: string): Promise<{ runId: string }> {
    return this.#runs.start(sessionId, (runtime) => runtime.continue())
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

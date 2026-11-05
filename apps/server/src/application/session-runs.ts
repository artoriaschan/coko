import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { type ImageAttachment } from '@coko/protocol'
// 开始 Run：检查、按需构造 Session 的运行时（恢复对话记录、权限、扩展、上下文装配与压缩接线），每个 Run 开始时向上下文装配取值，
// 交给 RunLauncher 受管执行。submit、Goal Round、重试、继续与动作开始的 Run 都经统一入口 startRun。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import {
  BUILTIN_COMMANDS,
  MAX_IMAGE_BYTES,
  detectImageMimeType,
  createAgentRuntime,
  createBuiltinToolRegistry,
  createLocalExecPort,
  effectiveMessages,
  lastRunStatus,
  NoActiveRunError,
  NothingToContinueError,
  NothingToRetryError,
  parseCommandInvocation,
  type AgentRuntime,
  type BackgroundJobLauncher,
  type BashExecutionContext,
  type CokoTool,
  type ModelRegistry,
  type PermissionHookPort,
  type RunEntry,
  type RunError,
  type RunInput,
  type RunResult,
  type SecretProvider,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import { hookContextText } from '@coko/agent/entries'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { SessionEntry as StoredEntry, Session as StoredSession, SessionStore, Workspace } from '@coko/session'
import type { SessionCheckpoints } from './checkpoints.ts'
import {
  dynamicHooks,
  layeredTools,
  type ActionResult,
  type ContextAction,
  type ContextActionSession,
  type ContextAssembly,
  type ContextScope,
  type PendingInput,
  type RunRequest,
} from './context/index.ts'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import type { SessionRecovery } from './recovery.ts'
import { createProgressRedactor, redactModelMessages, secretRedactionHook } from './secret-redaction.ts'
import type { SessionModels } from './session-models.ts'
import type { SessionPermissions } from './session-permissions.ts'
import { requireSession, toProgress, type SessionRuntimes } from './session-runtimes.ts'
import { sessionProject } from './session-project.ts'

const log = getLogger(['application', 'sessions'])

/** 待送达内容合并到 user message 开头；其 before 条目排在输入自身的 before（例如 command）之前。 */
function withPending(input: RunInput, pending: PendingInput | undefined): RunInput {
  if (!pending || (pending.content.length === 0 && (pending.before ?? []).length === 0)) return input
  const content = [...pending.content, ...(input.content ?? [{ type: 'text' as const, text: input.text }])]
  const before = [...(pending.before ?? []), ...(input.before ?? [])]
  return { ...input, content, ...(before.length > 0 ? { before } : {}) }
}

/** 提交前检查给出的上下文：作为 user message 中单独标注的文本块（排在输入之后，hookContextText）。 */
function withSubmitContext(input: RunInput, context: string | undefined): RunInput {
  if (context === undefined) return input
  const content = [...(input.content ?? [{ type: 'text' as const, text: input.text }]), { type: 'text' as const, text: hookContextText(context) }]
  return { ...input, content }
}

/** 按请求在运行时上开始 Run（run() 在第一个 await 之前同步发出 run_start）。 */
function launch(runtime: AgentRuntime, request: RunRequest, pending: PendingInput | undefined): Promise<RunResult> {
  switch (request.trigger) {
    case 'submit':
      return runtime.run(withPending(request.input, pending))
    case 'goal':
      return runtime.run({ ...withPending(request.input, pending), trigger: 'goal', goal: request.goal })
    case 'schedule':
      return runtime.run({ ...withPending(request.input, pending), trigger: 'schedule', schedule: request.schedule })
    case 'subagent':
      return runtime.run({ ...request.input, trigger: 'subagent', ...(request.triggerRunId ? { subagent: { triggerRunId: request.triggerRunId } } : {}) })
    case 'handoff':
      return runtime.run({ ...request.input, trigger: 'handoff' })
    case 'retry':
      return runtime.retry()
    case 'continue':
      return runtime.continue()
    case 'compact':
      return runtime.compact(request.instructions)
  }
}

/** 带 pendingInput 的 trigger（用户与无人值守的输入）。 */
const takesPending = (trigger: RunRequest['trigger']) => trigger === 'submit' || trigger === 'goal' || trigger === 'schedule'

/**
 * Session 的工作目录（ADR 0016）：Session 创建时确定，生命周期内不变。缺省为 Workspace 目录；worktree 绑定由 worktree 的实现给出
 * （worktree 路径 + Workspace 相对仓库根的路径）。指令、项目设置、项目 Hook 与 MCP、Skills、子代理定义都从这个目录读取。
 */
export interface SessionCwd {
  resolve(session: StoredSession, workspace: Workspace): Promise<string>
}

export const workspaceCwd: SessionCwd = { resolve: async (_session, workspace) => workspace.path }

/** 受管的 Run 执行：关闭 sidecar 时中断并等待 Run 结束（run_end 已提交）。由 runtime 层用 Effect 实现。 */
export interface RunLauncher {
  /** key 每个 Run 唯一。run 不会 reject。 */
  launch(key: string, run: Promise<unknown>, abort: () => void): void
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

export interface SessionRunsOptions {
  store: SessionStore
  registry: ModelRegistry
  hub: SessionHub
  runs: RunLauncher
  tools?: (cwd: string) => ToolRegistry
  extensions?: (context: SessionExtensionContext) => SessionExtension
  secrets?: SecretProvider
  context: ContextAssembly
  runtimes: SessionRuntimes
  permissions: SessionPermissions
  recovery: SessionRecovery
  checkpoints: SessionCheckpoints
  models: SessionModels
  /** Session 的工作目录；缺省 Workspace 目录（workspaceCwd）。 */
  cwd?: SessionCwd
}

/** 后台任务对 Run 的接线（runtime/layers.ts 以 JobService 给出）：bash 的启动入口与追加指令到达的通知。 */
export interface SessionJobs {
  launcher(sessionId: string): BackgroundJobLauncher
  /** 有追加指令送进该 Session 的 Run（用户的或通知）：唤醒等待中的 job_output。 */
  steered(sessionId: string): void
}

/**
 * 子代理对 Run 的接线（runtime/layers.ts 以 SubagentService 给出，ADR 0014）：子 Session 的定义（作用域的 subagent）、追加指令到达的通知
 * （唤醒等待中的 agent_wait）与父 Session 的 running 子代理（activity 的 awaiting-approval）。
 */
export interface SessionSubagents {
  definition(sessionId: string): ContextScope['subagent'] | undefined
  steered(sessionId: string): void
  runningChildren(parentSessionId: string): readonly string[]
}

const childSession = () => new AppError('child-session', 'A subagent session cannot take messages directly; it is driven by its parent')

/** 基础工具集中的 bash 在执行上下文中拿到本 Session 的后台任务入口（其余工具不变）。 */
function withJobs(base: ToolRegistry, launcher: BackgroundJobLauncher): ToolRegistry {
  let source: CokoTool | undefined
  let wrapped: CokoTool | undefined
  const bash = (tool: CokoTool): CokoTool => {
    if (tool !== source) {
      source = tool
      wrapped = {
        ...tool,
        execute: (id, params, signal, onUpdate, context) => tool.execute(id, params, signal, onUpdate, { ...context, jobs: launcher } as BashExecutionContext),
      }
    }
    return wrapped!
  }
  const pick = (tool: CokoTool | undefined) => (tool?.name === 'bash' ? bash(tool) : tool)
  return {
    register: (tool, options) => base.register(tool, options),
    get: (name) => pick(base.get(name)),
    list: () => base.list().map((tool) => pick(tool)!),
    implementations: () => base.implementations(),
    permissionClass: (name) => base.permissionClass(name),
  }
}

/** 运行时每个 Run 开始时刷新的上下文取值（运行时创建后其工具集与 hook 链不变，经这里间接替换）。 */
interface RunContext {
  scope: ContextScope
  tools: ReturnType<typeof layeredTools>
  hooks: ReturnType<typeof dynamicHooks>
  /** 准入 hook（只拦截、无副作用），排在扩展之前。 */
  admission: ReturnType<typeof dynamicHooks>
  /** 观察 hook，排在登记明文替换之后（收到已脱敏的结果）。 */
  observe: ReturnType<typeof dynamicHooks>
  readRoots: readonly string[]
  workspaceRoots: readonly string[]
  /** 该 Run 的外部 Hook 权限端口；没有时 gate 与没有 Hook 时相同。 */
  permissionHooks: PermissionHookPort | undefined
}

/** 运行时的 PermissionHookPort：转交该 Run 的端口；没有端口时没有决定。 */
const NO_VERDICT = Promise.resolve({})

export class SessionRuns {
  readonly #options: SessionRunsOptions
  readonly #runContexts = new WeakMap<AgentRuntime, RunContext>()
  /** 每个 Session 进行中的 Run（后台任务的进度带发起它的 runId）。 */
  readonly #activeRuns = new Map<string, string>()
  #jobs: SessionJobs | undefined
  #directoryAdmission: ((cwd: string) => void) | undefined
  useDirectoryAdmission(assert: (cwd: string) => void): void {
    this.#directoryAdmission = assert
  }
  #subagents: SessionSubagents | undefined

  constructor(options: SessionRunsOptions) {
    this.#options = options
  }

  /** 装配时接上后台任务（之后创建的运行时的 bash 可以 run_in_background）。 */
  useJobs(jobs: SessionJobs): void {
    this.#jobs = jobs
  }

  /** 装配时接上子代理（作用域的定义、追加指令通知与父级的审批状态）。 */
  useSubagents(subagents: SessionSubagents): void {
    this.#subagents = subagents
  }

  /** 该 Session 本次 Run 可用的工具名（filterTools 之后）；还没有运行时时 undefined。子代理的工具交集以派发时父级的这组工具为准。 */
  visibleTools(sessionId: string): string[] | undefined {
    const runtime = this.#options.runtimes.get(sessionId)
    const context = runtime && this.#runContexts.get(runtime)
    return context?.tools.registry.list().map((tool) => tool.name)
  }

  /** 父 Session 是否有 running 的子代理或 Teammate（Session 的 agentsRunning；Background Job 不算）。 */
  childrenRunning(parentSessionId: string): boolean {
    return (this.#subagents?.runningChildren(parentSessionId).length ?? 0) > 0
  }

  /** 父 Session 的 running 子代理中是否有在等待审批的（父 Session 的 activity 为 awaiting-approval）。 */
  childAwaitingApproval(parentSessionId: string): boolean {
    return (this.#subagents?.runningChildren(parentSessionId) ?? []).some((id) => (this.#options.runtimes.get(id)?.pendingApprovals.length ?? 0) > 0)
  }

  /** 子代理的模型（<providerId>/<modelId> 或 Session 模型）：解析不到时 bad-request；priced 为是否已定价（Goal 的 maxCost）。 */
  resolveModel(model: { providerId: string; modelId: string }): { priced: boolean } {
    return { priced: this.#options.registry.priced(this.#options.models.resolve(model, 'bad-request')) }
  }

  /** 该 Session 进行中的 Run 的 runId；没有时 undefined。 */
  activeRunId(sessionId: string): string | undefined {
    return this.#activeRuns.get(sessionId)
  }

  /**
   * 把宿主生成的内容（后台任务的完成通知）作为追加指令送进当前 Run，不经输入展开；返回是否送出（没有进行中的 Run 时 false）。
   * 是否真正送达以 Run 结束时的 undeliveredSteering 为准。
   */
  deliver(sessionId: string, input: RunInput): boolean {
    const runtime = this.#options.runtimes.get(sessionId)
    if (!runtime?.isRunning) return false
    try {
      runtime.steer(input)
    } catch (error) {
      if (error instanceof NoActiveRunError) return false
      throw error
    }
    this.#jobs?.steered(sessionId)
    this.#subagents?.steered(sessionId)
    return true
  }

  /**
   * 宿主停止（Goal 预算）：进行中的 Run 本批完成后以 paused 加该 error 结束（运行时 stopAfterBatch，第一次为准）；没有进行中的 Run 时 false。
   */
  stopAfterBatch(sessionId: string, error: RunError): boolean {
    const runtime = this.#options.runtimes.get(sessionId)
    if (!runtime?.isRunning) return false
    try {
      runtime.stopAfterBatch(error)
    } catch (e) {
      if (e instanceof NoActiveRunError) return false
      throw e
    }
    log.info('run stop after batch requested', { sessionId, code: error.code })
    return true
  }

  /**
   * Run 进行中重新取贡献的工具（例如第一次派发后台子代理之后注册 agent_wait / agent_cancel）：下一次请求生效，不必等下一个 Run。
   * 没有进行中的 Run 时什么也不做（下一个 Run 开始时照常取值）。
   */
  async refreshTools(sessionId: string): Promise<void> {
    const runtime = this.#options.runtimes.get(sessionId)
    const runContext = runtime && this.#runContexts.get(runtime)
    if (!runtime?.isRunning || !runContext) return
    const context = this.#options.context
    const contributed = await context.tools(runContext.scope)
    runContext.tools.set(contributed)
    const names = [...this.baseTools(runContext.scope.cwd).list(), ...contributed.map((c) => c.tool)].map((tool) => tool.name)
    const visible = context.filterTools(names, runContext.scope)
    runContext.tools.allow(visible.length === names.length && visible.every((name, i) => name === names[i]) ? undefined : new Set(visible))
    runtime.refreshTools()
  }

  /** 该 Workspace 的基础工具集（与运行时相同的工厂；上下文用量接口按其定义计工具分项）。 */
  baseTools(cwd: string): ToolRegistry {
    return this.#options.tools?.(cwd) ?? createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() })
  }

  /** 进行中的 Run 开始时取值的作用域（steer 展开输入用）；运行时还没有 Run 上下文时 undefined。 */
  runScope(runtime: AgentRuntime): ContextScope | undefined {
    return this.#runContexts.get(runtime)?.scope
  }

  /** Session 的工作目录（SessionCwd；缺省 Workspace 目录）。 */
  async cwd(session: StoredSession): Promise<{ workspace: Workspace; cwd: string }> {
    const workspace = await this.#options.store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    return { workspace, cwd: await (this.#options.cwd ?? workspaceCwd).resolve(session, workspace) }
  }

  /** 只拓宽文件能力；配置发现始终只接收固定 cwd。子 Session 从持久化父链取根归属。 */
  async #workspaceRoots(session: StoredSession, cwd: string): Promise<readonly string[]> {
    const store = this.#options.store
    const project = await sessionProject(store, session)
    const primary = project ? await store.sessions.getWorkspace(project.primaryWorkspaceId) : undefined
    const roots = await Promise.all(
      [cwd, ...(primary ? [primary.path] : []), ...(project?.additionalFolders ?? [])].map((path, index) =>
        realpath(path).catch(() => (index === 0 ? cwd : undefined)),
      ),
    )
    // Worktree 的来源不随项目移动/更换主要文件夹而改变。拒绝重叠根，避免祖先目录重新授予主检出。
    const worktree = session.worktreeId ? await store.worktrees.get(session.worktreeId) : undefined
    const original = worktree ? await realpath(worktree.repoRoot).catch(() => worktree.repoRoot) : undefined
    const contains = (a: string, b: string) => {
      const rel = relative(a, b)
      return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
    }
    return Object.freeze([
      ...new Set(
        roots.filter(
          (path, index): path is string => path !== undefined && (index === 0 || !original || (!contains(path, original) && !contains(original, path))),
        ),
      ),
    ])
  }

  async scope(session: StoredSession): Promise<ContextScope> {
    const { cwd } = await this.cwd(session)
    const [project, model] = await Promise.all([sessionProject(this.#options.store, session), this.#options.models.contextModel(session.model)])
    const permissions = this.#options.permissions
    // 规则在取用时现算（steer 时为当时的规则）：Session 规则与全局、Workspace、project 规则，与运行时的判定相同。
    const permissionRules = async () => permissions.runtimePermissions(await permissions.state(session), session.workspaceId, session.id, cwd).rules()
    const subagent = session.parentSessionId ? this.#subagents?.definition(session.id) : undefined
    return this.#options.context.scope({
      workspaceId: session.workspaceId,
      cwd,
      additionalFolders: project?.additionalFolders ?? [],
      ...(model ? { model: { providerId: model.provider, modelId: model.id } } : {}),
      sessionId: session.id,
      permissionRules,
      ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
      ...(session.worktreeId ? { worktreeId: session.worktreeId } : {}),
      ...(subagent ? { subagent } : {}),
    })
  }

  /**
   * 开始一个 Run 并立即返回 runId（统一入口）。submit 与 goal 的 user message 开头合并各领域的待送达内容（pendingInput），
   * 其 before 条目排在输入自身的 before 之前；Run 开始之后才确认送达，没能开始时内容留到下一次。Run 结束后通知各领域（onRunEnd）。
   */
  readonly #admitting = new Map<string, number>()
  readonly #settling = new Map<string, number>()
  readonly #admissionTasks = new Map<string, Set<Promise<unknown>>>()
  readonly #completions = new Map<string, Set<Promise<unknown>>>()
  #assertAdmission: (id: string) => void = () => {}

  useAdmission(assert: (id: string) => void): void {
    this.#assertAdmission = assert
  }
  busy(sessionId: string): boolean {
    return this.#admitting.has(sessionId) || this.#settling.has(sessionId) || this.#options.runtimes.isRunning(sessionId)
  }
  async #admit<T>(id: string, task: () => Promise<T>): Promise<T> {
    this.#assertAdmission(id)
    this.#admitting.set(id, (this.#admitting.get(id) ?? 0) + 1)
    const pending = (async () => {
      const session = await requireSession(this.#options.store, id)
      if (session.archivedAt !== null) throw new AppError('session-archived', 'Restore this conversation before starting a Run')
      return task()
    })()
    const tasks = this.#admissionTasks.get(id) ?? new Set<Promise<unknown>>()
    tasks.add(pending)
    this.#admissionTasks.set(id, tasks)
    try {
      return await pending
    } finally {
      tasks.delete(pending)
      if (!tasks.size) this.#admissionTasks.delete(id)
      const left = this.#admitting.get(id)! - 1
      if (left) this.#admitting.set(id, left)
      else this.#admitting.delete(id)
    }
  }

  /** Caller holds Session admission. Wait for preparation, then abort and await domain completion too. */
  async stopAndWait(sessionId: string): Promise<void> {
    const completions = new Set(this.#completions.get(sessionId))
    await Promise.allSettled(this.#admissionTasks.get(sessionId) ?? [])
    for (const completion of this.#completions.get(sessionId) ?? []) completions.add(completion)
    await this.abort(sessionId)
    await Promise.all(completions)
  }

  startRun(sessionId: string, request: RunRequest, waitForInput = false): Promise<{ runId: string }> {
    return this.#admit(sessionId, () => this.#start(sessionId, request, waitForInput))
  }

  async #start(sessionId: string, request: RunRequest, waitForInput: boolean): Promise<{ runId: string }> {
    const { store, recovery, models, context, checkpoints } = this.#options
    let session = await requireSession(store, sessionId)
    // 子 Session 只由派发它的 agent 调用开始 Run（ADR 0014）：用户提交、重试、继续、压缩与其他来源都拒绝。
    if (session.parentSessionId !== null && request.trigger !== 'subagent') throw childSession()
    await recovery.ensureRecovered(sessionId)
    // 未回答的结果确认之后不能开始任何 Run（submit、retry、continue）：未配对的调用会破坏模型请求（recovery.md）。
    if (recovery.awaitsConfirmation(sessionId)) throw new AppError('confirmation-pending', 'An outcome confirmation is waiting for an answer')
    if (!session.model) {
      const model = await models.defaultModel()
      if (!model) throw new AppError('model-not-configured', 'No model is configured; add a Provider in settings')
      // 模型字段被清空（Provider 被删除或升级时清除）：不自动选用，提示重新选择。从未设置时取默认模型。
      if (session.modelCleared) throw new AppError('model-required', 'Choose a model for this session before running')
      session = await store.sessions.setSessionModel(sessionId, { model })
    }
    const model = models.resolve(session.model!, 'model-not-configured')
    const runtime = await this.#options.runtimes.obtain(session.id, () => this.#createRuntime(session, model))
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    // 每个 Run 开始时向上下文装配取值（工具、读取根、hook）；取值之后再检查，检查与开始 Run 之间没有 await。
    const scope = await this.scope(session)
    const [contributed, readRoots, workspaceRoots] = await Promise.all([
      context.tools(scope),
      context.readRoots(scope),
      this.#workspaceRoots(session, scope.cwd),
    ])
    const hooks = context.hooks(scope)
    const admission = context.admissionHooks(scope)
    const observe = context.observeHooks(scope)
    const permissionHooks = context.permissionHooks(scope)
    const pending = takesPending(request.trigger) ? await context.pendingInput(scope) : undefined
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    // 回退或分叉进行中：运行时可能即将按新的有效上下文重建。
    if (checkpoints.busy(sessionId)) throw new AppError('session-busy', 'The session is being rewound or forked')
    const runContext = this.#runContexts.get(runtime)
    if (runContext) {
      runContext.scope = scope
      runContext.tools.set(contributed)
      runContext.hooks.set(hooks)
      runContext.admission.set(admission)
      runContext.observe.set(observe)
      runContext.readRoots = readRoots
      runContext.workspaceRoots = workspaceRoots
      runContext.permissionHooks = permissionHooks
      // 本次 Run 可用的工具（子代理的工具交集等）：没有领域过滤时不限。
      const names = [...this.baseTools(scope.cwd).list(), ...contributed.map((c) => c.tool)].map((tool) => tool.name)
      const visible = context.filterTools(names, scope)
      runContext.tools.allow(visible.length === names.length && visible.every((name, i) => name === names[i]) ? undefined : new Set(visible))
    }
    runtime.setModel(model)
    runtime.setThinkingLevel(models.effectiveLevel(session))

    this.#directoryAdmission?.(scope.cwd)
    this.#assertAdmission(sessionId)
    // run() 在第一个 await 之前同步发出 run_start，借此在 Run 结束前拿到 runId。
    let runId: string | undefined
    let acceptInput: (() => void) | undefined
    const accepted = waitForInput
      ? new Promise<void>((resolve) => {
          acceptInput = resolve
        })
      : undefined
    const off = runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'run_start') runId ??= event.event.runId
      if (event.kind === 'entry' && event.entry.kind === 'message' && event.entry.payload.role === 'user') acceptInput?.()
    })
    const run = launch(runtime, request, pending)
    if (!waitForInput) off()
    if (runId === undefined) {
      off()
      const error = await run.then(
        () => undefined,
        (e: unknown) => e,
      )
      if (error instanceof NothingToRetryError) throw new AppError('nothing-to-retry', error.message)
      if (error instanceof NothingToContinueError) throw new AppError('nothing-to-continue', error.message)
      throw new AppError('run-in-progress', 'A Run is in progress')
    }
    const started = runId
    this.#activeRuns.set(sessionId, started)
    pending?.delivered()
    log.info('run started', {
      sessionId,
      runId: started,
      providerId: session.model!.providerId,
      modelId: session.model!.modelId,
      thinkingLevel: models.effectiveLevel(session),
    })
    const goal = request.trigger === 'goal' ? request.goal : undefined
    const schedule = request.trigger === 'schedule' ? request.schedule : undefined
    this.#settling.set(sessionId, (this.#settling.get(sessionId) ?? 0) + 1)
    const done = run.then(
      async (result) => {
        if (this.#activeRuns.get(sessionId) === started) this.#activeRuns.delete(sessionId)
        log.info('run ended', {
          sessionId,
          runId: started,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
          ...(result.undeliveredSteering ? { undeliveredSteering: result.undeliveredSteering.length } : {}),
        })
        // 关闭时 RunLauncher 等待到这里：领域在 Run 结束后的处理（例如 Goal 推进的判定）也在关闭存储之前完成。
        await context.onRunEnd(scope, {
          sessionId,
          runId: started,
          trigger: request.trigger,
          ...(goal ? { goal } : {}),
          ...(schedule ? { schedule } : {}),
          result,
        })
      },
      (error: unknown) => {
        if (this.#activeRuns.get(sessionId) === started) this.#activeRuns.delete(sessionId)
        log.error('run failed', { sessionId, runId: started, error: String(error) })
      },
    )
    const completed = done.finally(() => {
      const left = this.#settling.get(sessionId)! - 1
      if (left) this.#settling.set(sessionId, left)
      else this.#settling.delete(sessionId)
      completions.delete(completed)
      if (!completions.size) this.#completions.delete(sessionId)
    })
    const completions = this.#completions.get(sessionId) ?? new Set<Promise<unknown>>()
    completions.add(completed)
    this.#completions.set(sessionId, completions)
    this.#options.runs.launch(`${sessionId}:${started}`, completed, () => runtime.abort())
    if (accepted) {
      try {
        await Promise.race([
          accepted,
          run.then(() => {
            throw new AppError('internal', 'First message was not accepted')
          }),
        ])
      } finally {
        off()
      }
    }
    return { runId: started }
  }

  /**
   * 提交一条消息：开始一个 Run 并立即返回 runId，或执行不开始 Run 的动作（{ done: true }）；Run 的条目与进度经 hub 推送。Run 进行中
   * 不展开输入（展开可能调用 MCP prompts/get、读取 Skill 与引用的文件）：只查内置命令表，声明 Run 中可用的动作（例如 /goal pause）照常
   * 执行，其余以 run-in-progress 拒绝。之后提交的文本经上下文装配展开（命令 → File Reference）；展开为动作（例如 /compact）时调用该动作。
   * 展开期间另一个 Run 开始时，startRun 与动作照常再检查一次。
   */
  submit(sessionId: string, text: string, waitForInput = false, images: ImageAttachment[] = []): Promise<ActionResult> {
    return this.#admit(sessionId, () => this.#submit(sessionId, text, waitForInput, images))
  }

  async #submit(sessionId: string, text: string, waitForInput: boolean, images: ImageAttachment[]): Promise<ActionResult> {
    const { store, runtimes, context } = this.#options
    const session = await requireSession(store, sessionId)
    if (session.parentSessionId !== null) throw childSession()
    if (runtimes.isRunning(sessionId)) {
      if (images.length) throw new AppError('run-in-progress', 'Wait for the current Run to finish before sending images')
      const invocation = parseCommandInvocation(text)
      const builtin = invocation && BUILTIN_COMMANDS.find((command) => command.name === invocation.name)
      const action = builtin ? context.action(builtin.action) : undefined
      if (invocation && action?.whileRunning?.(invocation.args)) return this.#act(session, action, invocation.args)
      throw new AppError('run-in-progress', 'A Run is in progress')
    }
    if (!text.trim() && !images.length) throw new AppError('bad-request', 'A message is required')
    if (images.length) {
      const model = await this.#options.models.contextModel(session.model)
      if (!model?.input.includes('image')) throw new AppError('bad-request', 'The selected model does not support image input')
      for (const image of images) {
        const bytes = Buffer.from(image.data, 'base64')
        if (detectImageMimeType(bytes) !== image.mimeType || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image.data)
          throw new AppError('bad-request', 'Invalid image or image exceeds the 4.5 MB limit')
      }
    }
    const scope = await this.scope(session)
    const expanded = text.trim() ? await context.expandInput(text, scope) : { kind: 'input' as const, input: { text: '' } }
    if (expanded.kind === 'input') {
      // 提交前检查（UserPromptSubmit 等）：reject 时不提交 user message、不开始 Run。
      const verdict = await context.beforeSubmit(scope, text)
      if (verdict && 'reject' in verdict) throw new AppError('hook-blocked', verdict.reject.slice(0, 2048), { reason: verdict.reject.slice(0, 2048) })
      return this.startRun(
        sessionId,
        {
          trigger: 'submit',
          input: withSubmitContext(
            images.length
              ? {
                  ...expanded.input,
                  content: [
                    ...(expanded.input.content ?? (expanded.input.text ? [{ type: 'text' as const, text: expanded.input.text }] : [])),
                    ...images.map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
                  ],
                }
              : expanded.input,
            verdict?.context,
          ),
        },
        waitForInput,
      )
    }
    if (images.length) throw new AppError('bad-request', 'Images require a message, not an action command')
    if (waitForInput) throw new AppError('bad-request', 'Send a message to start a new conversation')
    const action = context.action(expanded.name)
    if (!action) throw new AppError('bad-request', `Unknown action ${expanded.name}`)
    if (runtimes.isRunning(sessionId) && !action.whileRunning?.(expanded.args)) throw new AppError('run-in-progress', 'A Run is in progress')
    return this.#act(session, action, expanded.args)
  }

  async #act(session: StoredSession, action: ContextAction, args: string): Promise<ActionResult> {
    const sessionId = session.id
    const actions: ContextActionSession = {
      entries: () => this.#options.store.sessions.listEntries(sessionId),
      start: (request) => this.startRun(sessionId, request),
      submit: async (text) => {
        const result = await this.submit(sessionId, text)
        if (!('runId' in result)) throw new AppError('bad-request', 'The message did not start a Run')
        return result
      },
      running: () => this.#options.runtimes.isRunning(sessionId),
    }
    return action({ scope: await this.scope(session), sessionId, args, session: actions })
  }

  /** 把追加指令送进当前 Run（先经上下文装配展开；展开为动作时 bad-request）；没有进行中的 Run 时 no-active-run。 */
  async steer(sessionId: string, text: string): Promise<void> {
    const session = await requireSession(this.#options.store, sessionId)
    if (session.parentSessionId !== null) throw childSession()
    const runtime = this.#options.runtimes.get(sessionId)
    try {
      if (!runtime?.isRunning) throw new NoActiveRunError()
      const expanded = await this.#options.context.expandInput(text, this.runScope(runtime) ?? (await this.scope(session)))
      if (expanded.kind === 'action') throw new AppError('bad-request', `${expanded.name} cannot be sent while a Run is in progress`)
      runtime.steer(expanded.input)
    } catch (error) {
      if (error instanceof NoActiveRunError) throw new AppError('no-active-run', error.message)
      throw error
    }
    this.#jobs?.steered(sessionId)
    this.#subagents?.steered(sessionId)
    log.info('steering queued', { sessionId })
  }

  /** 暂停当前 Run（本批完成后以 paused 结束）；没有进行中的 Run 时 no-active-run。 */
  async pause(sessionId: string): Promise<void> {
    await requireSession(this.#options.store, sessionId)
    const runtime = this.#options.runtimes.get(sessionId)
    try {
      if (!runtime) throw new NoActiveRunError()
      runtime.pause()
    } catch (error) {
      if (error instanceof NoActiveRunError) throw new AppError('no-active-run', error.message)
      throw error
    }
    log.info('run pause requested', { sessionId })
  }

  /** 返回是否确有进行中的 Run 被要求停止。 */
  async abort(sessionId: string): Promise<boolean> {
    await requireSession(this.#options.store, sessionId)
    const runtime = this.#options.runtimes.get(sessionId)
    if (!runtime?.isRunning) return false
    runtime.abort()
    log.info('run abort requested', { sessionId })
    return true
  }

  async #createRuntime(session: StoredSession, model: Model<any>): Promise<AgentRuntime> {
    const { store, registry, hub, runtimes, permissions: sessionPermissions } = this.#options
    const { cwd } = await this.cwd(session)
    // 恢复 Session：已提交的 message 条目就是模型可见的对话记录。
    const entries = await store.sessions.listEntries(session.id)
    // 被回退的区间不进入模型上下文（ADR 0006）。
    const messages: AgentMessage[] = effectiveMessages(entries)
    const previous = lastRunStatus(entries)
    if (previous) runtimes.setLastStatus(session.id, previous)
    const permissions = await sessionPermissions.state(session)
    let extension: SessionExtension = {}
    const publish = runtimes.publisher(session.id, () => extension.onEntry)
    if (this.#options.extensions) extension = this.#options.extensions({ sessionId: session.id, cwd, commit: publish })
    const runContext: RunContext = {
      scope: await this.scope(session),
      // 子 Session 没有后台任务入口：bash 的 run_in_background / tty 为参数错误（ADR 0014）。
      tools: layeredTools(
        this.#jobs && session.parentSessionId === null ? withJobs(this.baseTools(cwd), this.#jobs.launcher(session.id)) : this.baseTools(cwd),
      ),
      hooks: dynamicHooks(),
      admission: dynamicHooks(),
      observe: dynamicHooks(),
      readRoots: [],
      workspaceRoots: [],
      permissionHooks: undefined,
    }
    // 运行时在构造时以当时的工具组成开头的系统消息（不提交）：先放入贡献的工具，使默认开启的贡献（如 memory_*）不在第一个 Run
    // 产生 toolsAdded 的 system 条目；之后各 Run 开始时照常重新取值，只有真正的变化才提交。
    const context = this.#options.context
    const seeded = await context.tools(runContext.scope)
    runContext.tools.set(seeded)
    // 开头的系统消息只列本 Session 可用的工具（子代理的工具交集）：构造前就按 filterTools 限定，不先列出再撤回。
    const seedNames = [...this.baseTools(cwd).list(), ...seeded.map((c) => c.tool)].map((tool) => tool.name)
    const seedVisible = context.filterTools(seedNames, runContext.scope)
    if (seedVisible.length !== seedNames.length) runContext.tools.allow(new Set(seedVisible))
    const runtime = createAgentRuntime({
      models: registry.models,
      model,
      thinkingLevel: this.#options.models.effectiveLevel(session),
      cwd,
      tools: runContext.tools.registry,
      sessionId: session.id,
      messages,
      ...(previous ? { lastRunStatus: previous } : {}),
      permissions: {
        ...sessionPermissions.runtimePermissions(permissions, session.workspaceId, session.id, cwd),
        readRoots: () => runContext.readRoots,
        workspaceRoots: () => runContext.workspaceRoots,
        // 外部 Hook 的端口按 Run 现取；没有端口时没有决定（gate 与没有 Hook 时相同）。
        hooks: {
          preToolUse: (call, signal) => runContext.permissionHooks?.preToolUse(call, signal) ?? NO_VERDICT,
          permissionRequest: (call, signal) => runContext.permissionHooks?.permissionRequest(call, signal) ?? NO_VERDICT,
        },
      },
      // 权限判定在链首；之后是贡献的准入 hook（只拦截，例如 Goal 预算），被拦下的调用不经过扩展（checkpoint 备份）等有副作用的 hook；
      // 其余贡献的 hook 排在扩展之后。登记明文的替换排在最后：之前的 hook 附加的内容（如嵌套指令）也被替换，结果进入运行时之前已不含明文
      // （secret-redaction.ts）。
      hooks: [runContext.admission.hooks, ...(extension.hooks ?? []), runContext.hooks.hooks, secretRedactionHook, runContext.observe.hooks],
      ...(this.#options.secrets ? { secrets: this.#options.secrets } : {}),
      context: {
        systemSections: () => context.systemSections(runContext.scope),
        stateUpdates: () => context.stateUpdates(runContext.scope, () => store.sessions.listEntries(session.id)),
        // 预算等请求前检查（各领域的 beforeRequest）；没有领域检查时放行。
        beforeRequest: async (state) => (context.beforeRequest ? ((await context.beforeRequest(state, runContext.scope)) ?? undefined) : undefined),
        // 每次模型请求的上下文都替换登记明文（模型回显、压缩摘要），之后才是各领域的改写。
        transformMessages: (messages: AgentMessage[]) => {
          const redacted = redactModelMessages(messages)
          return context.transformMessages ? context.transformMessages(redacted, runContext.scope) : redacted
        },
        // M5：压缩前（PreCompact）与 Run 正常结束前（Stop）；没有领域时不装，运行时与之前相同。
        ...(context.beforeCompact ? { beforeCompact: (info) => context.beforeCompact!(runContext.scope, info) } : {}),
        ...(context.onStop ? { onStop: (info) => context.onStop!(runContext.scope, info) } : {}),
      },
      // 压缩：切点与重建读已提交的条目（入库时已替换登记明文，摘要请求同样看不到明文）；context.autoCompact 取该 Run 开始时的有效配置。
      compaction: {
        entries: async () => (await store.sessions.listEntries(session.id)).map((entry) => (entry.kind === 'message' ? redactSecretsDeep(entry) : entry)),
        autoCompact: () => runContext.scope.config.context.autoCompact,
      },
      commit: async (entry) => {
        await publish(entry)
        if (entry.kind === 'model_request') {
          const { runId, model, durationMs, ttftMs, usage, cost, retries, purpose, errorCode } = entry.payload
          log.info('model request finished', {
            sessionId: session.id,
            runId,
            model,
            purpose,
            durationMs,
            ttftMs,
            tokens: usage.total,
            cost,
            retries,
            ...(errorCode ? { errorCode } : {}),
          })
        }
      },
    })
    this.#runContexts.set(runtime, runContext)
    const progress = createProgressRedactor()
    runtime.subscribe((event) => {
      if (event.kind === 'entry') return progress.reset()
      const redacted = progress.redact(event.event)
      if (redacted) hub.publishProgress(session.id, redacted.runId, toProgress(redacted))
    })
    return runtime
  }
}

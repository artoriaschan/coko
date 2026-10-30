// 开始 Run：检查、按需构造 Session 的运行时（恢复对话记录、权限、扩展、上下文装配与压缩接线），每个 Run 开始时向上下文装配取值，
// 交给 RunLauncher 受管执行。submit、Goal Round、重试、继续与动作开始的 Run 都经统一入口 startRun。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import {
  createAgentRuntime,
  createBuiltinToolRegistry,
  createLocalExecPort,
  effectiveMessages,
  lastRunStatus,
  NoActiveRunError,
  NothingToContinueError,
  NothingToRetryError,
  type AgentRuntime,
  type ModelRegistry,
  type RunEntry,
  type RunInput,
  type RunResult,
  type SecretProvider,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import type { SessionCheckpoints } from './checkpoints.ts'
import { dynamicHooks, layeredTools, type ContextAssembly, type ContextScope, type PendingInput, type RunRequest } from './context/index.ts'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import type { SessionRecovery } from './recovery.ts'
import { createProgressRedactor, redactModelMessages, secretRedactionHook } from './secret-redaction.ts'
import type { SessionModels } from './session-models.ts'
import type { SessionPermissions } from './session-permissions.ts'
import { requireSession, toProgress, type SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'sessions'])

/** 待送达内容合并到 user message 开头；其 before 条目排在输入自身的 before（例如 command）之前。 */
function withPending(input: RunInput, pending: PendingInput | undefined): RunInput {
  if (!pending || (pending.content.length === 0 && (pending.before ?? []).length === 0)) return input
  const content = [...pending.content, ...(input.content ?? [{ type: 'text' as const, text: input.text }])]
  const before = [...(pending.before ?? []), ...(input.before ?? [])]
  return { ...input, content, ...(before.length > 0 ? { before } : {}) }
}

/** 按请求在运行时上开始 Run（run() 在第一个 await 之前同步发出 run_start）。 */
function launch(runtime: AgentRuntime, request: RunRequest, pending: PendingInput | undefined): Promise<RunResult> {
  switch (request.trigger) {
    case 'submit':
      return runtime.run(withPending(request.input, pending))
    case 'goal':
      return runtime.run({ ...withPending(request.input, pending), trigger: 'goal', goal: request.goal })
    case 'retry':
      return runtime.retry()
    case 'continue':
      return runtime.continue()
    case 'compact':
      return runtime.compact(request.instructions)
  }
}

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
}

/** 运行时每个 Run 开始时刷新的上下文取值（运行时创建后其工具集与 hook 链不变，经这里间接替换）。 */
interface RunContext {
  scope: ContextScope
  tools: ReturnType<typeof layeredTools>
  hooks: ReturnType<typeof dynamicHooks>
  readRoots: readonly string[]
}

export class SessionRuns {
  readonly #options: SessionRunsOptions
  readonly #runContexts = new WeakMap<AgentRuntime, RunContext>()

  constructor(options: SessionRunsOptions) {
    this.#options = options
  }

  /** 该 Workspace 的基础工具集（与运行时相同的工厂；上下文用量接口按其定义计工具分项）。 */
  baseTools(cwd: string): ToolRegistry {
    return this.#options.tools?.(cwd) ?? createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() })
  }

  /** 进行中的 Run 开始时取值的作用域（steer 展开输入用）；运行时还没有 Run 上下文时 undefined。 */
  runScope(runtime: AgentRuntime): ContextScope | undefined {
    return this.#runContexts.get(runtime)?.scope
  }

  async scope(session: StoredSession): Promise<ContextScope> {
    const workspace = await this.#options.store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    const permissions = this.#options.permissions
    // 规则在取用时现算（steer 时为当时的规则）：Session 规则与全局、Workspace、project 规则，与运行时的判定相同。
    const permissionRules = async () => permissions.runtimePermissions(await permissions.state(session), session.workspaceId).rules()
    return this.#options.context.scope({ workspaceId: session.workspaceId, cwd: workspace.path, sessionId: session.id, permissionRules })
  }

  /**
   * 开始一个 Run 并立即返回 runId（统一入口）。submit 与 goal 的 user message 开头合并各领域的待送达内容（pendingInput），
   * 其 before 条目排在输入自身的 before 之前；Run 开始之后才确认送达，没能开始时内容留到下一次。Run 结束后通知各领域（onRunEnd）。
   */
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }> {
    return this.#start(sessionId, request)
  }

  async #start(sessionId: string, request: RunRequest): Promise<{ runId: string }> {
    const { store, recovery, models, context, checkpoints } = this.#options
    let session = await requireSession(store, sessionId)
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
    const [contributed, readRoots] = await Promise.all([context.tools(scope), context.readRoots(scope)])
    const hooks = context.hooks(scope)
    const pending = request.trigger === 'submit' || request.trigger === 'goal' ? await context.pendingInput(scope) : undefined
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    // 回退或分叉进行中：运行时可能即将按新的有效上下文重建。
    if (checkpoints.busy(sessionId)) throw new AppError('session-busy', 'The session is being rewound or forked')
    const runContext = this.#runContexts.get(runtime)
    if (runContext) {
      runContext.scope = scope
      runContext.tools.set(contributed)
      runContext.hooks.set(hooks)
      runContext.readRoots = readRoots
    }
    runtime.setModel(model)
    runtime.setThinkingLevel(models.effectiveLevel(session))

    // run() 在第一个 await 之前同步发出 run_start，借此在 Run 结束前拿到 runId。
    let runId: string | undefined
    const off = runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'run_start') runId ??= event.event.runId
    })
    const run = launch(runtime, request, pending)
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
    pending?.delivered()
    log.info('run started', {
      sessionId,
      runId: started,
      providerId: session.model!.providerId,
      modelId: session.model!.modelId,
      thinkingLevel: models.effectiveLevel(session),
    })
    const goal = request.trigger === 'goal' ? request.goal : undefined
    const done = run.then(
      async (result) => {
        log.info('run ended', {
          sessionId,
          runId: started,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
          ...(result.undeliveredSteering ? { undeliveredSteering: result.undeliveredSteering.length } : {}),
        })
        // 关闭时 RunLauncher 等待到这里：领域在 Run 结束后的处理（例如 Goal 推进的判定）也在关闭存储之前完成。
        await context.onRunEnd(scope, { sessionId, runId: started, trigger: request.trigger, ...(goal ? { goal } : {}), result })
      },
      (error: unknown) => log.error('run failed', { sessionId, runId: started, error: String(error) }),
    )
    this.#options.runs.launch(`${sessionId}:${started}`, done, () => runtime.abort())
    return { runId: started }
  }

  /** 把追加指令送进当前 Run（先经上下文装配展开；展开为动作时 bad-request）；没有进行中的 Run 时 no-active-run。 */
  async steer(sessionId: string, text: string): Promise<void> {
    const session = await requireSession(this.#options.store, sessionId)
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
    const workspace = await store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    // 恢复 Session：已提交的 message 条目就是模型可见的对话记录。
    const entries = await store.sessions.listEntries(session.id)
    // 被回退的区间不进入模型上下文（ADR 0006）。
    const messages: AgentMessage[] = effectiveMessages(entries)
    const previous = lastRunStatus(entries)
    if (previous) runtimes.setLastStatus(session.id, previous)
    const permissions = await sessionPermissions.state(session)
    let extension: SessionExtension = {}
    const publish = runtimes.publisher(session.id, () => extension.onEntry)
    if (this.#options.extensions) extension = this.#options.extensions({ sessionId: session.id, cwd: workspace.path, commit: publish })
    const runContext: RunContext = {
      scope: await this.scope(session),
      tools: layeredTools(this.baseTools(workspace.path)),
      hooks: dynamicHooks(),
      readRoots: [],
    }
    // 运行时在构造时以当时的工具组成开头的系统消息（不提交）：先放入贡献的工具，使默认开启的贡献（如 memory_*）不在第一个 Run
    // 产生 toolsAdded 的 system 条目；之后各 Run 开始时照常重新取值，只有真正的变化才提交。
    const context = this.#options.context
    runContext.tools.set(await context.tools(runContext.scope))
    const runtime = createAgentRuntime({
      models: registry.models,
      model,
      thinkingLevel: this.#options.models.effectiveLevel(session),
      cwd: workspace.path,
      tools: runContext.tools.registry,
      sessionId: session.id,
      messages,
      ...(previous ? { lastRunStatus: previous } : {}),
      permissions: { ...sessionPermissions.runtimePermissions(permissions, session.workspaceId), readRoots: () => runContext.readRoots },
      // 贡献的 hook 排在扩展（checkpoint）之后；权限判定仍在链首。登记明文的替换排在最后：之前的 hook 附加的内容（如嵌套指令）也被替换，
      // 结果进入运行时之前已不含明文（secret-redaction.ts）。
      hooks: [...(extension.hooks ?? []), runContext.hooks.hooks, secretRedactionHook],
      ...(this.#options.secrets ? { secrets: this.#options.secrets } : {}),
      context: {
        systemSections: () => context.systemSections(runContext.scope),
        // 预算等请求前检查（各领域的 beforeRequest）；没有领域检查时放行。
        beforeRequest: async (state) => (context.beforeRequest ? ((await context.beforeRequest(state, runContext.scope)) ?? undefined) : undefined),
        // 每次模型请求的上下文都替换登记明文（模型回显、压缩摘要），之后才是各领域的改写。
        transformMessages: (messages: AgentMessage[]) => {
          const redacted = redactModelMessages(messages)
          return context.transformMessages ? context.transformMessages(redacted, runContext.scope) : redacted
        },
      },
      // 压缩：切点与重建读已提交的条目（入库时已替换登记明文，摘要请求同样看不到明文）；context.autoCompact 取该 Run 开始时的有效配置。
      compaction: {
        entries: async () => (await store.sessions.listEntries(session.id)).map((entry) => (entry.kind === 'message' ? redactSecretsDeep(entry) : entry)),
        autoCompact: () => runContext.scope.config.context.autoCompact,
      },
      commit: async (entry) => {
        await publish(entry)
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

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import {
  ApprovalNotPendingError,
  createAgentRuntime,
  ModelConfigError,
  NothingToRetryError,
  resolveModel,
  type AgentRuntime,
  type ModelRegistry,
  type ProgressEvent as AgentProgress,
  type RunEntry,
  type RunResult,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import {
  DEFAULT_MODEL_SETTING,
  SessionModel as SessionModelSchema,
  type ProgressEvent,
  type AnswerApprovalRequest,
  type Session,
  type SessionDetailResponse,
  type SessionModel,
} from '@coko/protocol'
import type { JsonValue, NewSessionEntry, SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'

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

const toJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/**
 * 模型服务的错误文本可能回显请求凭据（例如 "Incorrect API key provided: sk-…"），入库与推送前都经同一函数脱敏
 * （ADR 0004）。用户输入与工具输出保持原样。
 */
const redactModelError = redactText

/** 运行时条目按注册的 kind 原样提交（session 校验 payload）；只有回显模型错误的字段先脱敏。 */
function toNewEntry(entry: RunEntry): NewSessionEntry {
  let payload: unknown = entry.payload
  if (entry.kind === 'message' && entry.payload.role === 'assistant' && entry.payload.errorMessage) {
    payload = { ...entry.payload, errorMessage: redactModelError(entry.payload.errorMessage) }
  } else if (entry.kind === 'run_end' && entry.payload.error) {
    payload = { ...entry.payload, error: { ...entry.payload.error, message: redactModelError(entry.payload.error.message) } }
  }
  return { kind: entry.kind, ...(entry.runId === undefined ? {} : { runId: entry.runId }), payload: toJson(payload) }
}

function toProgress(event: AgentProgress): ProgressEvent {
  const { runId: _runId, ...rest } = event
  if (rest.type === 'retry') return { ...rest, errorMessage: redactModelError(rest.errorMessage) }
  if (rest.type === 'run_end' && rest.error) return { ...rest, error: { ...rest.error, message: redactModelError(rest.error.message) } }
  return toJson(rest) as ProgressEvent
}

/** Session 的协议入口：把 HTTP 命令映射到 agent 运行时与 session 存储。 */
export class SessionService {
  readonly #options: SessionServiceOptions
  /** 正在创建或已创建的运行时；创建失败时移除。 */
  readonly #pending = new Map<string, Promise<AgentRuntime>>()
  readonly #runtimes = new Map<string, AgentRuntime>()

  constructor(options: SessionServiceOptions) {
    this.#options = options
  }

  isRunning(sessionId: string): boolean {
    return this.#runtimes.get(sessionId)?.isRunning ?? false
  }

  activeRuns(): number {
    let count = 0
    for (const runtime of this.#runtimes.values()) if (runtime.isRunning) count++
    return count
  }

  toDto(session: StoredSession): Session {
    const runtime = this.#runtimes.get(session.id)
    const running = runtime?.isRunning ?? false
    const activity = !running ? 'idle' : runtime!.pendingApprovals.length > 0 ? 'awaiting-approval' : 'running'
    return { ...session, running, activity }
  }

  async list(workspaceId?: string): Promise<Session[]> {
    const sessions = await this.#options.store.sessions.listSessions(workspaceId ? { workspaceId } : {})
    return sessions.map((session) => this.toDto(session))
  }

  async create(input: { workspaceId: string; title?: string; model?: SessionModel }): Promise<Session> {
    if (input.model) this.#resolve(input.model, 'bad-request')
    const model = input.model ?? (await this.defaultModel())
    const session = await this.#options.store.sessions.createSession({
      workspaceId: input.workspaceId,
      ...(input.title === undefined ? {} : { title: input.title }),
      model: model ?? null,
    })
    log.info('session created', { sessionId: session.id, workspaceId: session.workspaceId })
    return this.toDto(session)
  }

  async detail(sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.#get(sessionId)
    const entries = await this.#options.store.sessions.listEntries(sessionId)
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

  /** 开始一个 Run 并立即返回 runId；Run 的条目与进度经 hub 推送。 */
  submit(sessionId: string, text: string): Promise<{ runId: string }> {
    return this.#start(sessionId, (runtime) => runtime.run(text))
  }

  /** 重新执行出错的上一轮（不追加用户消息）；上一轮没有出错时以 nothing-to-retry 拒绝。 */
  retry(sessionId: string): Promise<{ runId: string }> {
    return this.#start(sessionId, (runtime) => runtime.retry())
  }

  async #start(sessionId: string, start: (runtime: AgentRuntime) => Promise<RunResult>): Promise<{ runId: string }> {
    let session = await this.#get(sessionId)
    if (!session.model) {
      const model = await this.defaultModel()
      if (!model) throw new AppError('model-not-configured', 'No model is configured; add a Provider in settings')
      session = await this.#options.store.sessions.setSessionModel(sessionId, model)
    }
    const model = this.#resolve(session.model!, 'model-not-configured')
    const runtime = await this.#runtime(session, model)
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
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
      throw new AppError('run-in-progress', 'A Run is in progress')
    }
    const started = runId
    log.info('run started', { sessionId, runId: started, providerId: session.model!.providerId, modelId: session.model!.modelId })
    const done = run.then(
      (result) => log.info('run ended', { sessionId, runId: started, status: result.status, ...(result.error ? { error: result.error } : {}) }),
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

  /**
   * 回答待审批请求；决定条目提交后返回。请求不在等待中时 approval-not-pending。M2 票 02 只支持仅本次；
   * 保存规则的作用域（session / workspace / global）由票 03 交付，此前以 bad-request 拒绝。
   */
  async answerApproval(sessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<void> {
    await this.#get(sessionId)
    if (answer.decision === 'allow' && answer.scope !== undefined && answer.scope !== 'once')
      throw new AppError('bad-request', `Approval scope ${answer.scope} is not supported yet`)
    const runtime = this.#runtimes.get(sessionId)
    if (!runtime) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
    try {
      await runtime.answerApproval(requestId, answer)
    } catch (error) {
      if (error instanceof ApprovalNotPendingError) throw new AppError('approval-not-pending', error.message)
      throw error
    }
    log.info('approval answered', { sessionId, requestId, decision: answer.decision })
  }

  async #get(sessionId: string): Promise<StoredSession> {
    const session = await this.#options.store.sessions.getSession(sessionId)
    if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
    return session
  }

  #resolve(model: SessionModel, code: 'bad-request' | 'model-not-configured'): Model<any> {
    try {
      return resolveModel(this.#options.registry, model.providerId, model.modelId)
    } catch (error) {
      if (error instanceof ModelConfigError) throw new AppError(code, error.message)
      throw error
    }
  }

  #runtime(session: StoredSession, model: Model<any>): Promise<AgentRuntime> {
    const existing = this.#pending.get(session.id)
    if (existing) return existing
    const created = this.#createRuntime(session, model)
    this.#pending.set(session.id, created)
    created.then(
      (runtime) => this.#runtimes.set(session.id, runtime),
      () => this.#pending.delete(session.id),
    )
    return created
  }

  async #createRuntime(session: StoredSession, model: Model<any>): Promise<AgentRuntime> {
    const { store, registry, hub } = this.#options
    const workspace = await store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    // 恢复 Session：已提交的 message 条目就是模型可见的对话记录。
    const entries = await store.sessions.listEntries(session.id)
    const messages = entries.filter((entry) => entry.kind === 'message').map((entry) => entry.payload as unknown as AgentMessage)
    let extension: SessionExtension = {}
    const publish = async (entry: RunEntry): Promise<StoredEntry> => {
      const [committed] = await store.sessions.appendEntries(session.id, [toNewEntry(entry)])
      hub.publishEntry(committed!)
      extension.onEntry?.(committed!)
      return committed!
    }
    if (this.#options.extensions) extension = this.#options.extensions({ sessionId: session.id, cwd: workspace.path, commit: publish })
    const runtime = createAgentRuntime({
      models: registry.models,
      model,
      cwd: workspace.path,
      ...(this.#options.tools ? { tools: this.#options.tools(workspace.path) } : {}),
      sessionId: session.id,
      messages,
      // 票 02：模式固定为 default、没有规则；模式与规则的回放与持久化由票 03 接入。
      permissions: { mode: () => 'default', rules: () => [] },
      ...(extension.hooks ? { hooks: extension.hooks } : {}),
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

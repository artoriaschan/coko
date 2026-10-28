import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import {
  ApprovalNotPendingError,
  confirmationResult,
  createAgentRuntime,
  effectiveEntries,
  effectiveMessages,
  emptyRewindReport,
  forkEntries,
  realLocation,
  planRewind,
  restoreFiles,
  RewindTargetError,
  createBuiltinToolRegistry,
  createLocalExecPort,
  planRecovery,
  toolNameOf,
  unansweredConfirmations,
  ModelConfigError,
  NoActiveRunError,
  NothingToContinueError,
  NothingToRetryError,
  resolveModel,
  type AgentRuntime,
  type ModelRegistry,
  type PermissionMode,
  type PermissionRule,
  type ProgressEvent as AgentProgress,
  type RewindFiles,
  type RewindMode,
  type RunEntry,
  type RunResult,
  type RunStatus,
  type SecretProvider,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import {
  type ConfirmationAnswer,
  DEFAULT_MODEL_SETTING,
  SessionModel as SessionModelSchema,
  type ProgressEvent,
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
import type { JsonValue, NewSessionEntry, SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'
import { PermissionService, sameRule, withRules } from './permissions.ts'

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

/** Session 的模式与 Session 规则：由 permission_mode / permission_rule 条目回放，之后随提交更新。 */
interface SessionPermissionState {
  workspaceId: string
  mode: PermissionMode
  rules: PermissionRule[]
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

/** 有效上下文中最后一条 run_end 的状态（被回退的 Run 不算）；没有结束的 Run 时为 undefined。 */
function lastRunStatus(all: readonly StoredEntry[]): RunStatus | undefined {
  const entries = all.some((e) => e.kind === 'rewind') ? effectiveEntries(all) : all
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'run_end') return (entry.payload as { status: RunStatus }).status
  }
  return undefined
}

/** 启动恢复读取的跨 Session 查询（SQLite 存储提供，见 @coko/session/sqlite 的 recovery）。 */
export interface RecoverySource {
  listUnfinishedRuns(): Promise<{ sessionId: string; runId: string }[]>
  listLatestEntries(kind: string): Promise<StoredEntry[]>
}

/** 一次启动扫描的结果（计数用于日志与测试观察）。 */
export interface RecoveryReport {
  interruptedRuns: number
  pendingConfirmations: number
  failedSessions: number
}

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
  readonly #permissionStates = new Map<string, Promise<SessionPermissionState>>()
  /** 每个 Session 的权限条目提交串行（回放后的内存状态与条目顺序一致）。 */
  readonly #permissionLocks = new Map<string, Promise<unknown>>()
  /** 运行时的条目发布（含扩展的 onEntry）；没有运行时的 Session 直接提交并发布。 */
  readonly #publishers = new Map<string, (entry: RunEntry) => Promise<StoredEntry>>()
  /** 已知的上一 Run 结束状态（读过条目或本进程内结束的 Run）；用于 Session 不在运行时的 activity。 */
  readonly #lastStatus = new Map<string, RunStatus>()
  /**
   * 有未回答结果确认的 Session：条目派生的缓存（confirmation_request 与 confirmation_answer 只经 #commitBatch 提交，并在那里更新它；
   * 启动扫描从条目建立）。#start、#exclusively 与 toDto 都只读它（#awaitsConfirmation）。
   */
  readonly #awaitingConfirmation = new Set<string>()
  /** 启动恢复失败的 Session 与其未结束的 Run：恢复成功之前拒绝 Run、回退与分叉，下次操作时重试。 */
  readonly #recoveryFailed = new Map<string, string[]>()
  /** 正在回退或分叉的 Session：其间不能开始 Run（#start 在调用运行时之前检查）。 */
  readonly #exclusive = new Set<string>()
  readonly permissions: PermissionService

  constructor(options: SessionServiceOptions) {
    this.#options = options
    this.permissions = options.permissions ?? new PermissionService(options.store, () => this.#hostToolNames())
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
    if (running) return { ...session, running, activity: runtime!.pendingApprovals.length > 0 ? 'awaiting-approval' : 'running' }
    if (this.#recoveryFailed.has(session.id)) return { ...session, running, activity: 'interrupted' }
    if (this.#awaitsConfirmation(session.id)) return { ...session, running, activity: 'awaiting-confirmation' }
    const last = this.#lastStatus.get(session.id)
    return { ...session, running, activity: last === 'paused' || last === 'interrupted' ? last : 'idle' }
  }

  /**
   * 启动扫描（打开存储之后、开始监听之前；recovery.md）：每个有 run_start 而无 run_end 的 Run 按 planRecovery 补齐条目
   * （过期的审批、补齐的工具结果、confirmation_request、run_end interrupted），同一 Run 的条目一次事务提交。之后从各 Session
   * 最后一条 run_end 建立 activity，使未打开的 Session 在列表中也显示 interrupted / paused / awaiting-confirmation。
   * 单个 Session 失败不阻止启动：记错误，该 Session 在恢复成功之前拒绝 Run、回退与分叉（recovery-failed），下次操作时重试。
   */
  async recover(source: RecoverySource): Promise<RecoveryReport> {
    const report: RecoveryReport = { interruptedRuns: 0, pendingConfirmations: 0, failedSessions: 0 }
    const bySession = new Map<string, string[]>()
    for (const run of await source.listUnfinishedRuns()) bySession.set(run.sessionId, [...(bySession.get(run.sessionId) ?? []), run.runId])
    for (const [sessionId, runIds] of bySession) {
      const recovered = await this.#recoverSession(sessionId, runIds)
      if (recovered === undefined) report.failedSessions++
      else {
        report.interruptedRuns += recovered.runs
        report.pendingConfirmations += recovered.confirmations
      }
    }
    for (const end of await source.listLatestEntries('run_end')) {
      let status: RunStatus | undefined = (end.payload as { status: RunStatus }).status
      // 暂停或中断的 Run 可能已被回退（之后的 rewind 条目把它移出有效上下文）：按有效条目重算。
      if (status === 'paused' || status === 'interrupted') status = lastRunStatus(await this.#options.store.sessions.listEntries(end.sessionId))
      if (status === undefined) continue
      this.#lastStatus.set(end.sessionId, status)
      // 待确认只出现在被中断的 Run 之后（之前的确认未回答时不能开始新 Run）。
      if (status === 'interrupted' && unansweredConfirmations(await this.#options.store.sessions.listEntries(end.sessionId)).length > 0)
        this.#awaitingConfirmation.add(end.sessionId)
    }
    return report
  }

  /** 恢复一个 Session 中未结束的 Run（已有 run_end 的跳过）；失败时登记到 #recoveryFailed 并返回 undefined。 */
  async #recoverSession(sessionId: string, runIds: readonly string[]): Promise<{ runs: number; confirmations: number } | undefined> {
    const result = { runs: 0, confirmations: 0 }
    try {
      const session = await this.#get(sessionId)
      const workspace = await this.#options.store.sessions.getWorkspace(session.workspaceId)
      if (!workspace) throw new Error(`workspace ${session.workspaceId} not found`)
      const tools = this.#options.tools?.(workspace.path) ?? createBuiltinToolRegistry({ cwd: workspace.path, exec: createLocalExecPort() })
      for (const runId of runIds) {
        const entries = await this.#options.store.sessions.listEntries(sessionId)
        if (entries.some((e) => e.kind === 'run_end' && e.runId === runId)) continue
        const planned = await planRecovery(entries, { runId, tool: (name) => tools.get(name), cwd: workspace.path })
        await this.#commitBatch(sessionId, planned)
        const confirmations = planned.filter((e) => e.kind === 'confirmation_request').length
        result.runs++
        result.confirmations += confirmations
        log.warn('interrupted run recovered', { sessionId, runId, entries: planned.length, confirmations })
      }
      this.#recoveryFailed.delete(sessionId)
      return result
    } catch (error) {
      this.#recoveryFailed.set(sessionId, [...runIds])
      log.error('run recovery failed', { sessionId, error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /** 恢复失败的 Session：先重试恢复，仍失败时以 recovery-failed 拒绝（未配对的调用会破坏模型请求，补齐的条目也会错位）。 */
  async #ensureRecovered(sessionId: string): Promise<void> {
    const runIds = this.#recoveryFailed.get(sessionId)
    if (runIds === undefined) return
    if ((await this.#recoverSession(sessionId, runIds)) === undefined)
      throw new AppError('recovery-failed', 'This session could not be recovered after Coko stopped; see the logs for details')
    this.#rememberStatus(sessionId, await this.#options.store.sessions.listEntries(sessionId))
  }

  /** 是否有未回答的结果确认（单一来源：#awaitingConfirmation）。 */
  #awaitsConfirmation(sessionId: string): boolean {
    return this.#awaitingConfirmation.has(sessionId)
  }

  /**
   * 回答恢复时结果不明的调用：confirmation_answer 与补齐的 toolResult 一次事务提交（之后"继续"的模型上下文含该结果）。
   * 该调用没有待回答的确认时 not-found。
   */
  async answerConfirmation(sessionId: string, toolCallId: string, answer: ConfirmationAnswer): Promise<void> {
    await this.#get(sessionId)
    await this.#locked(sessionId, async () => {
      const entries = await this.#options.store.sessions.listEntries(sessionId)
      const pending = unansweredConfirmations(entries)
      const target = pending.find((p) => p.toolCallId === toolCallId)
      if (!target) throw new AppError('not-found', `No outcome confirmation is waiting for tool call ${toolCallId}`)
      const runId = target.runId ?? undefined
      const toolName = toolNameOf(entries, toolCallId) ?? 'unknown'
      await this.#commitBatch(sessionId, [
        { kind: 'confirmation_answer', ...(runId ? { runId } : {}), payload: { toolCallId, answer } },
        { kind: 'message', ...(runId ? { runId } : {}), payload: confirmationResult({ toolCallId, toolName, answer }) },
      ])
      // 已建立的运行时的对话记录不含补齐的结果：丢弃它，下次开始 Run 时从条目重建。
      const runtime = this.#runtimes.get(sessionId)
      if (runtime && !runtime.isRunning) {
        this.#runtimes.delete(sessionId)
        this.#pending.delete(sessionId)
        this.#publishers.delete(sessionId)
      }
      log.info('outcome confirmed', { sessionId, toolCallId, answer })
    })
  }

  /**
   * 一次事务提交一批条目，之后逐条发布（没有运行时扩展的场景：启动扫描、结果确认与分叉）。含 confirmation_* 条目时按提交后的条目
   * 重算 #awaitingConfirmation。
   */
  async #commitBatch(sessionId: string, entries: readonly RunEntry[]): Promise<void> {
    const committed = await this.#options.store.sessions.appendEntries(sessionId, entries.map(toNewEntry))
    for (const entry of committed) {
      if (entry.kind === 'run_end') this.#lastStatus.set(sessionId, (entry.payload as { status: RunStatus }).status)
      this.#options.hub.publishEntry(entry)
    }
    if (committed.some((e) => e.kind === 'confirmation_request' || e.kind === 'confirmation_answer')) {
      const pending = unansweredConfirmations(await this.#options.store.sessions.listEntries(sessionId))
      if (pending.length > 0) this.#awaitingConfirmation.add(sessionId)
      else this.#awaitingConfirmation.delete(sessionId)
    }
  }

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
    await this.#commit(session.id, { kind: 'permission_mode', payload: { mode } })
    log.info('session created', { sessionId: session.id, workspaceId: session.workspaceId, mode })
    return this.toDto(session)
  }

  // ---- 权限：模式、Session 规则、默认模式与全局 / Workspace 规则 ----

  async #commit(sessionId: string, entry: RunEntry): Promise<StoredEntry> {
    const publish = this.#publishers.get(sessionId)
    if (publish) return publish(entry)
    const [committed] = await this.#options.store.sessions.appendEntries(sessionId, [toNewEntry(entry)])
    this.#options.hub.publishEntry(committed!)
    return committed!
  }

  #permissionState(session: StoredSession): Promise<SessionPermissionState> {
    let state = this.#permissionStates.get(session.id)
    if (!state) {
      state = (async () => {
        await Promise.all([this.permissions.load(), this.permissions.loadWorkspace(session.workspaceId)])
        const replayed: SessionPermissionState = { workspaceId: session.workspaceId, mode: 'default', rules: [] }
        for (const entry of await this.#options.store.sessions.listEntries(session.id)) {
          if (entry.kind === 'permission_mode') replayed.mode = (entry.payload as { mode: PermissionMode }).mode
          else if (entry.kind === 'permission_rule') {
            const { op, rule: stored } = entry.payload as unknown as { op: 'add' | 'remove'; rule: PermissionRule }
            const [rule] = this.permissions.canonical([stored]) as [PermissionRule]
            replayed.rules = op === 'add' ? withRules(replayed.rules, [rule]) : replayed.rules.filter((r) => !sameRule(r, rule))
          }
        }
        return replayed
      })()
      state.catch(() => this.#permissionStates.delete(session.id))
      this.#permissionStates.set(session.id, state)
    }
    return state
  }

  /** 同一 Session 的权限修改串行执行。 */
  #locked<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#permissionLocks.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.#permissionLocks.set(
      sessionId,
      next.catch(() => undefined),
    )
    return next
  }

  static #view(state: SessionPermissionState): SessionPermissionsResponse {
    return { mode: state.mode, rules: [...state.rules] }
  }

  async sessionPermissions(sessionId: string): Promise<SessionPermissionsResponse> {
    return SessionService.#view(await this.#permissionState(await this.#get(sessionId)))
  }

  /** 切换模式：提交 permission_mode 条目（与当前相同时不提交），之后重新判定该 Session 的待审批请求。 */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<SessionPermissionsResponse> {
    const session = await this.#get(sessionId)
    const view = await this.#locked(sessionId, async () => {
      const state = await this.#permissionState(session)
      if (state.mode !== mode) {
        await this.#commit(sessionId, { kind: 'permission_mode', payload: { mode } })
        state.mode = mode
        log.info('permission mode changed', { sessionId, mode })
      }
      return SessionService.#view(state)
    })
    await this.#reevaluate((id) => id === sessionId)
    return view
  }

  /** 增删 Session 规则：提交 permission_rule 条目（无变化时不提交），之后重新判定该 Session 的待审批请求。 */
  async changeSessionRule(sessionId: string, op: 'add' | 'remove', rule: PermissionRule): Promise<SessionPermissionsResponse> {
    const session = await this.#get(sessionId)
    // 新增时校验并归一；删除时按读出的规范名比较（库中可能有旧的非规范写法）。
    const normalized = op === 'add' ? this.permissions.normalize([rule]) : this.permissions.canonical([rule])
    const view = await this.#locked(sessionId, () => this.#applySessionRules(session, op, normalized))
    await this.#reevaluate((id) => id === sessionId)
    return view
  }

  async #applySessionRules(session: StoredSession, op: 'add' | 'remove', rules: readonly PermissionRule[]): Promise<SessionPermissionsResponse> {
    const state = await this.#permissionState(session)
    for (const rule of rules) {
      const present = state.rules.some((r) => sameRule(r, rule))
      if (present === (op === 'add')) continue
      await this.#commit(session.id, { kind: 'permission_rule', payload: { op, rule } })
      state.rules = op === 'add' ? [...state.rules, rule] : state.rules.filter((r) => !sameRule(r, rule))
    }
    return SessionService.#view(state)
  }

  getPermissions(workspaceId?: string): Promise<PermissionsResponse> {
    return this.permissions.get(workspaceId)
  }

  /** 修改默认模式或全局 / Workspace 规则；规则变化后重新判定受影响 Session 的待审批请求。 */
  async updatePermissions(request: UpdatePermissionsRequest): Promise<PermissionsResponse> {
    const response = await this.permissions.update(request)
    if (request.target === 'global') await this.#reevaluate(() => true)
    else if (request.target === 'workspace') await this.#reevaluate((_id, workspaceId) => workspaceId === request.workspaceId)
    return response
  }

  /** 让匹配的 Session 的待审批请求按当前模式与规则重新判定（变为 allow / deny 的以 superseded 结束）。 */
  async #reevaluate(match: (sessionId: string, workspaceId: string) => boolean): Promise<void> {
    const work: Promise<void>[] = []
    for (const [sessionId, runtime] of this.#runtimes) {
      const state = await this.#permissionStates.get(sessionId)?.catch(() => undefined)
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

  async detail(sessionId: string): Promise<SessionDetailResponse> {
    const session = await this.#get(sessionId)
    const entries = await this.#options.store.sessions.listEntries(sessionId)
    this.#rememberStatus(sessionId, entries)
    return { session: this.toDto(session), entries }
  }

  #rememberStatus(sessionId: string, entries: readonly StoredEntry[]): void {
    const status = lastRunStatus(entries)
    if (status) this.#lastStatus.set(sessionId, status)
    else this.#lastStatus.delete(sessionId)
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
    await this.#ensureRecovered(sessionId)
    // 未回答的结果确认之后不能开始任何 Run（submit、retry、continue）：未配对的调用会破坏模型请求（recovery.md）。
    if (this.#awaitsConfirmation(sessionId)) throw new AppError('confirmation-pending', 'An outcome confirmation is waiting for an answer')
    if (!session.model) {
      const model = await this.defaultModel()
      if (!model) throw new AppError('model-not-configured', 'No model is configured; add a Provider in settings')
      session = await this.#options.store.sessions.setSessionModel(sessionId, model)
    }
    const model = this.#resolve(session.model!, 'model-not-configured')
    const runtime = await this.#runtime(session, model)
    if (runtime.isRunning) throw new AppError('run-in-progress', 'A Run is in progress')
    // 回退或分叉进行中：运行时可能即将按新的有效上下文重建。
    if (this.#exclusive.has(sessionId)) throw new AppError('session-busy', 'The session is being rewound or forked')
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

  /**
   * 回答待审批请求；决定条目提交后返回。请求不在等待中时 approval-not-pending。scope 为 session / workspace / global 时
   * 先保存请求的建议规则（Session 规则为条目，其余为设置），再允许；没有建议规则的请求（受保护路径、越界写入、提权、
   * 询问规则命中、无法拆分的命令）只能允许一次，否则 bad-request。保存后重新判定受影响的其他待审批请求。
   */
  async answerApproval(sessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<void> {
    const session = await this.#get(sessionId)
    const runtime = this.#runtimes.get(sessionId)
    if (!runtime) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
    const scope = answer.decision === 'allow' ? (answer.scope ?? 'once') : 'once'
    if (scope !== 'once') {
      const request = runtime.pendingApprovals.find((p) => p.requestId === requestId)
      if (!request) throw new AppError('approval-not-pending', `Approval request ${requestId} is not pending`)
      if (request.kind !== 'tool' || request.suggestions.length === 0)
        throw new AppError('bad-request', `Approval request ${requestId} can only be allowed once`)
      const state = await this.#permissionState(session)
      if (scope === 'session') await this.#locked(sessionId, () => this.#applySessionRules(session, 'add', request.suggestions))
      else await this.permissions.addRules(scope === 'global' ? { kind: 'global' } : { kind: 'workspace', workspaceId: state.workspaceId }, request.suggestions)
      log.info('permission rules saved', { sessionId, approvalId: requestId, scope, count: request.suggestions.length })
    }
    try {
      await runtime.answerApproval(requestId, answer)
    } catch (error) {
      if (error instanceof ApprovalNotPendingError) throw new AppError('approval-not-pending', error.message)
      throw error
    }
    log.info('approval answered', { sessionId, approvalId: requestId, decision: answer.decision, scope })
    if (scope === 'session') await this.#reevaluate((id) => id === sessionId)
    else if (scope === 'workspace') await this.#reevaluate((_id, workspaceId) => workspaceId === session.workspaceId)
    else if (scope === 'global') await this.#reevaluate(() => true)
  }

  // ---- Checkpoint：回退与分叉（ADR 0006） ----

  /**
   * 回退与分叉的前置条件，并在其间排斥新 Run：恢复失败 recovery-failed，Run 进行中（含等待审批）session-busy，有未回答的结果确认
   * confirmation-pending（与 #start 同一判断：#awaitsConfirmation）。检查与登记在同一同步段内，之后开始的 Run 在 #start 中被拒绝。
   * 只读的预览（dry-run）检查同样的前置条件但不登记，并发的预览互不排斥（对话框的预览可能同时发出两次）。
   */
  async #exclusively<T>(sessionId: string, task: (entries: StoredEntry[]) => Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    await this.#get(sessionId)
    if (this.#runtimes.get(sessionId)?.isRunning || this.#exclusive.has(sessionId))
      throw new AppError('session-busy', 'A Run is in progress or waiting for approval; rewind and fork are not available')
    const register = !options.readOnly
    if (register) this.#exclusive.add(sessionId)
    try {
      // 恢复失败的重试在登记之后：检查与登记之间没有 await，并发的回退预览不会同时通过。
      await this.#ensureRecovered(sessionId)
      const entries = await this.#options.store.sessions.listEntries(sessionId)
      if (this.#runtimes.get(sessionId)?.isRunning) throw new AppError('session-busy', 'A Run is in progress or waiting for approval')
      if (this.#awaitsConfirmation(sessionId)) throw new AppError('confirmation-pending', 'An outcome confirmation is waiting for an answer')
      return await task(entries)
    } finally {
      if (register) this.#exclusive.delete(sessionId)
    }
  }

  /** Checkpoint 列表：有效上下文中的用户消息，以及回退代码到该处时涉及的路径。 */
  async checkpoints(sessionId: string): Promise<Checkpoint[]> {
    await this.#get(sessionId)
    const entries = await this.#options.store.sessions.listEntries(sessionId)
    const backups = entries.flatMap((e) => (e.kind === 'file_backup' ? [e.payload as { anchorSeq: number; path: string }] : []))
    return effectiveEntries(entries).flatMap((entry) => {
      if (entry.kind !== 'message' || (entry.payload as { role?: unknown }).role !== 'user') return []
      const { text } = planRewind(entries, entry.seq, 'conversation')
      const paths = [...new Set(backups.filter((b) => b.anchorSeq >= entry.seq).map((b) => b.path))]
      return [{ seq: entry.seq, text, createdAt: entry.createdAt, paths }]
    })
  }

  /**
   * 回退到某条用户消息（ADR 0006）。code / both 先恢复文件（目标锚点及之后追踪过的路径回到最早的备份，原先不存在的删除），
   * conversation / both 再提交 rewind 条目并丢弃运行时（下次开始 Run 时按有效条目重建）。dryRun 只返回将发生的变化。
   */
  async rewind(sessionId: string, input: { targetSeq: number; mode: RewindMode; dryRun?: boolean }): Promise<RewindResponse> {
    return this.#exclusively(
      sessionId,
      async (entries) => {
        const plan = this.#plan(() => planRewind(entries, input.targetSeq, input.mode))
        const dryRun = input.dryRun ?? false
        let files = emptyRewindReport()
        if (plan.files.length > 0) {
          if (!this.#options.checkpoints) throw new AppError('internal', 'File checkpoints are not available')
          const session = await this.#get(sessionId)
          const workspace = await this.#options.store.sessions.getWorkspace(session.workspaceId)
          if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
          files = await restoreFiles(plan.files, this.#options.checkpoints, { workspace: await realLocation(workspace.path), dryRun })
        }
        if (!dryRun && plan.entry) {
          await this.#commit(sessionId, plan.entry)
          this.#discardRuntime(sessionId)
          this.#rememberStatus(sessionId, await this.#options.store.sessions.listEntries(sessionId))
        }
        if (!dryRun)
          log.info('session rewound', {
            sessionId,
            targetSeq: plan.targetSeq,
            mode: plan.mode,
            restored: files.restored.length,
            deleted: files.deleted.length,
            diverged: files.diverged.length,
            untracked: files.untracked.length,
            outside: files.outside.length,
            skipped: files.skipped.length,
          })
        return { targetSeq: plan.targetSeq, mode: plan.mode, dryRun, text: plan.text, ...files }
      },
      { readOnly: input.dryRun === true },
    )
  }

  /**
   * 从某条用户消息分叉（ADR 0006）：新 Session（同一 Workspace 与模型）的条目为 fork_origin 与目标之前的有效消息、权限条目；
   * 原 Session 不变，Workspace 文件不复制。标题由界面按当前语言生成后传入（Sidecar 不写本地化文案），省略时沿用原标题。
   * 返回新 Session 的 id 与目标文本。
   */
  async fork(sessionId: string, targetSeq: number, title?: string): Promise<{ sessionId: string; text: string }> {
    return this.#exclusively(sessionId, async (entries) => {
      const source = await this.#get(sessionId)
      const forked = this.#plan(() => forkEntries(entries, sessionId, targetSeq))
      const session = await this.#options.store.sessions.createSession({
        workspaceId: source.workspaceId,
        title: title?.trim() || source.title,
        model: source.model,
      })
      await this.#commitBatch(session.id, forked.entries)
      log.info('session forked', { sessionId, forkedSessionId: session.id, targetSeq, entries: forked.entries.length })
      return { sessionId: session.id, text: forked.text }
    })
  }

  #plan<T>(plan: () => T): T {
    try {
      return plan()
    } catch (error) {
      if (error instanceof RewindTargetError) throw new AppError('bad-request', error.message)
      throw error
    }
  }

  /** 丢弃未在运行的运行时：之后开始 Run 时从条目重建（有效上下文、锚点与权限状态）。 */
  #discardRuntime(sessionId: string): void {
    const runtime = this.#runtimes.get(sessionId)
    if (runtime?.isRunning) return
    this.#runtimes.delete(sessionId)
    this.#pending.delete(sessionId)
    this.#publishers.delete(sessionId)
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
    // 被回退的区间不进入模型上下文（ADR 0006）。
    const messages: AgentMessage[] = effectiveMessages(entries)
    const previous = lastRunStatus(entries)
    if (previous) this.#lastStatus.set(session.id, previous)
    const permissions = await this.#permissionState(session)
    let extension: SessionExtension = {}
    const publish = async (entry: RunEntry): Promise<StoredEntry> => {
      const [committed] = await store.sessions.appendEntries(session.id, [toNewEntry(entry)])
      if (entry.kind === 'run_end') this.#lastStatus.set(session.id, entry.payload.status)
      hub.publishEntry(committed!)
      extension.onEntry?.(committed!)
      return committed!
    }
    if (this.#options.extensions) extension = this.#options.extensions({ sessionId: session.id, cwd: workspace.path, commit: publish })
    this.#publishers.set(session.id, publish)
    const runtime = createAgentRuntime({
      models: registry.models,
      model,
      cwd: workspace.path,
      ...(this.#options.tools ? { tools: this.#options.tools(workspace.path) } : {}),
      sessionId: session.id,
      messages,
      ...(previous ? { lastRunStatus: previous } : {}),
      // 每次调用现算：Session 规则在前，其后是全局与 Workspace 规则（判定不依赖顺序）。
      permissions: {
        mode: () => permissions.mode,
        rules: () => [...permissions.rules, ...this.permissions.rulesFor(session.workspaceId)],
      },
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

// 子代理（ADR 0014，docs/subsystems/subagents.md）的应用服务：派发（子 Session 创建、agent_start / subagent_origin、SubagentStart Hook、
// trigger subagent 的子 Run）、前台等待、并行上限、取消传播（父 Run 停止、agent_cancel、取消 Goal）、agent_end 与用量、权限作用域
// （isolation worktree 的询问规则）。进度与通知在 subagent-notifications.ts，结束记录的用量与启动恢复在 subagent-recovery.ts。
import {
  createAgentDefinitionLoader,
  currentGoal,
  goalRunIds,
  isTerminalPhase,
  subagentTools,
  type AgentCatalog,
  type AgentDefinitionLoader,
  type AgentStarted,
  type AgentStartRequest,
  type AgentWaitItem,
  type BeforeRequestState,
  type PermissionMode,
  type PermissionRule,
  type PluginRoot,
  type RunEntry,
  type RunInput,
  type RunResult,
  type StandardPermissionMode,
  type StopContinue,
  type StopInfo,
  type SubagentsPort,
  type SubagentOriginPayload,
  agentStarts,
  memberStatus,
  TEAMMATES_MAX,
  teammateNameProblem,
  teamRoster,
  TeamMessageError,
  type AgentOutcome,
  type AgentStartPayload,
} from '@coko/agent'
import { hookContextText, unansweredConfirmations } from '@coko/agent/entries'
import { getLogger, redactSecretValues } from '@coko/logging'
import { MAX_RUNNING_SUBAGENTS, type AgentDefinitionsResponse, type AgentSnapshot, type SessionModel } from '@coko/protocol'
import type { NewSession, Session as StoredSession, SessionStore } from '@coko/session'
import type { ConfigService } from './config.ts'
import type { ContextScope, PendingInput, RequestVerdict, RunEndInfo, RunRequest, SessionEntryAccess } from './context/types.ts'
import { AppError, errorMessage } from './errors.ts'
import type { HookService } from './hooks.ts'
import type { SessionHub } from './hub.ts'
import type { NotificationService } from './notifications.ts'
import type { RecoverySource } from './recovery.ts'
import type { PermissionScopeResolver } from './session-permissions.ts'
import type { SessionSubagents } from './session-runs.ts'
import { newLiveSubagent, rearmLiveSubagent, SubagentNotifications, type LiveSubagent } from './subagent-notifications.ts'
import { agentSnapshots, endStatus, SubagentRecovery } from './subagent-recovery.ts'
import type { WorktreeService } from './worktrees.ts'

export { childUsage } from './subagent-recovery.ts'

const log = getLogger(['application', 'subagents'])

/** 子代理需要的 Session 能力（runtime/layers.ts 以 SessionService 实现，创建后 bind）。 */
export interface SubagentSessionHost {
  activeRunId(sessionId: string): string | undefined
  isRunning(sessionId: string): boolean
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }>
  abort(sessionId: string): Promise<boolean>
  deliver(sessionId: string, input: RunInput): boolean
  /** 派发时父级本 Run 可用的工具名。 */
  visibleTools(sessionId: string): string[] | undefined
  /** 父 Session 当前的权限模式（根 Session 的模式；isolation 在 plan / read-only 下为错误结果）。 */
  mode(sessionId: string): Promise<PermissionMode>
  resolveModel(model: SessionModel): { priced: boolean }
  /** 父 Session 的当前（或默认）模型。 */
  sessionModel(session: StoredSession): Promise<SessionModel | undefined>
  scope(session: StoredSession): Promise<ContextScope>
  /** 规则与定义中接受的工具名（基础工具与贡献的规则工具）。 */
  toolNames(cwd: string): readonly string[]
  /** 会话记录的唯一创建入口（SessionService.createRecord：绑定已移除的 worktree 时 409 worktree-removed）。 */
  createSession(input: NewSession): Promise<StoredSession>
  /** 父 Run 进行中重新取工具（第一次派发之后同一个 Run 就有 agent_wait / agent_cancel）。 */
  refreshTools(sessionId: string): Promise<void>
}

export interface SubagentServiceOptions {
  store: SessionStore
  hub: SessionHub
  entries: SessionEntryAccess
  config: Pick<ConfigService, 'effective'>
  cokoHome: string
  hooks?: HookService
  notifications?: NotificationService
  worktrees?: Pick<WorktreeService, 'createForSubagent' | 'removeIfUnchanged'>
  loader?: AgentDefinitionLoader
}

/** teammate 子 Session 另有的团队工具（ADR 0018）：子代理工具集 + send_message + task_*。 */
export const TEAM_TOOL_NAMES: readonly string[] = ['send_message', 'task_create', 'task_update', 'task_list']

/** 团队对子代理的接线（TeamService，装配时 useTeams）：名册或成员状态变化时推送 team_update。 */
export interface SubagentTeamHooks {
  changed(rootId: string): void
}

/** 送达一个子 Session 的团队消息（宿主生成的文本与前置的 team_message 条目）。 */
export interface ChildDelivery {
  agentId: string
  text: string
  before: RunEntry[]
  /** 触发它的根 Run（Goal 预算按它归属）；没有时不属于任何 Goal。 */
  triggerRunId?: string
}

const parseModel = (text: string): SessionModel | undefined => {
  const at = text.indexOf('/')
  return at > 0 && at < text.length - 1 ? { providerId: text.slice(0, at), modelId: text.slice(at + 1) } : undefined
}

export class SubagentService implements PermissionScopeResolver, SessionSubagents {
  readonly #options: SubagentServiceOptions
  readonly #loader: AgentDefinitionLoader
  readonly #live = new Map<string, LiveSubagent>()
  readonly #notes: SubagentNotifications
  readonly #recovery: SubagentRecovery
  #host: SubagentSessionHost | undefined
  /** 并行上限的占位（同一批的并行派发）。 */
  readonly #reserving = new Map<symbol, string>()
  /** teammate 名字的占位（同一批的同名派发）：token → 根 Session 与名字。 */
  readonly #naming = new Map<symbol, { rootId: string; name: string }>()
  /** 并行上限已满时排队的团队消息（每个根 Session；不跨进程保留）。 */
  readonly #queued = new Map<string, ChildDelivery[]>()
  #teams: SubagentTeamHooks | undefined

  constructor(options: SubagentServiceOptions) {
    this.#options = options
    this.#loader = options.loader ?? createAgentDefinitionLoader()
    this.#worktrees = options.worktrees
    this.#notes = new SubagentNotifications({
      hub: options.hub,
      ...(options.notifications ? { notifications: options.notifications } : {}),
      activeRunId: (sessionId) => this.#sessions.activeRunId(sessionId),
      deliver: (sessionId, input: RunInput) => this.#sessions.deliver(sessionId, input),
      live: (agentId) => this.#live.get(agentId),
    })
    this.#recovery = new SubagentRecovery({
      store: options.store,
      entries: options.entries,
      worktrees: () => this.#worktrees,
    })
  }

  /** 装配时接上团队（ADR 0018）。 */
  useTeams(teams: SubagentTeamHooks & import('./teams.ts').TeamService): void {
    this.#teams = teams
    this.#teamService = teams
  }

  #teamService: import('./teams.ts').TeamService | undefined

  /** 团队服务（context/teams.ts 的工具与 <team> section）；未装配时 undefined。 */
  teams(): import('./teams.ts').TeamService | undefined {
    return this.#teamService
  }

  /** AppLive 创建 SessionService 与 WorktreeService 之后调用一次。 */
  bind(host: SubagentSessionHost, worktrees?: SubagentServiceOptions['worktrees']): void {
    this.#host = host
    if (worktrees) this.#worktrees = worktrees
  }

  #worktrees: SubagentServiceOptions['worktrees']

  /** 子 Session 的 <subagent> system section：类型、角色正文与交回结论的要求（ADR 0014）。 */
  section(sessionId: string): { name: string; text: string } | undefined {
    const live = this.#live.get(sessionId)
    if (!live) return undefined
    const { name, prompt } = live.definition
    return {
      name: 'subagent',
      text:
        `<subagent type="${name}">\n${prompt}\n\n` +
        'You are a subagent working for another agent, not for the user directly. You cannot ask questions. When the task is done, ' +
        'reply with your final report as plain text: it is the only thing returned to the agent that started you.\n</subagent>',
    }
  }

  get #sessions(): SubagentSessionHost {
    if (!this.#host) throw new Error('SubagentService is not bound yet')
    return this.#host
  }

  // ---- 权限作用域（PermissionScopeResolver）与 Run 接线（SessionSubagents） ----

  rootSessionId(sessionId: string): string {
    return this.#live.get(sessionId)?.rootId ?? sessionId
  }

  modeCap(sessionId: string): StandardPermissionMode | undefined {
    return this.#live.get(sessionId)?.definition.permissionMode
  }

  /** 父 Session 对子代理 isolation worktree 的询问规则（subagent-recovery.ts）。 */
  extraRules(sessionId: string): PermissionRule[] {
    return this.#recovery.extraRules(sessionId)
  }

  definition(sessionId: string): ContextScope['subagent'] | undefined {
    const live = this.#live.get(sessionId)
    if (!live) return undefined
    const { name, permissionMode, maxTurns } = live.definition
    return { name, tools: live.tools, ...(permissionMode ? { permissionMode } : {}), maxTurns }
  }

  steered(sessionId: string): void {
    this.#notes.steered(sessionId)
  }

  runningChildren(parentSessionId: string): readonly string[] {
    return [...this.#live.values()].filter((l) => l.rootId === parentSessionId && l.status === 'running').map((l) => l.agentId)
  }

  /** 本 Session 是否有过子代理（agent_wait / agent_cancel 只在有子代理时注册）。 */
  async hasAgents(sessionId: string): Promise<boolean> {
    if ([...this.#live.values()].some((l) => l.rootId === sessionId)) return true
    return (await this.#options.store.sessions.listChildren(sessionId)).length > 0
  }

  // ---- 定义 ----

  /** plugins：已启用插件的 agents 目录（ContextScope.plugins.agentRoots），定义以 <plugin>:<name> 登记。 */
  async catalog(cwd: string, plugins: readonly PluginRoot[] = []): Promise<AgentCatalog> {
    const known = new Set(this.#sessions.toolNames(cwd))
    return this.#loader.load({
      cwd,
      cokoHome: this.#options.cokoHome,
      plugins,
      knownTool: (name) => known.has(name) || name === 'skill' || name.startsWith('mcp__'),
      knownModel: (text) => {
        const model = parseModel(text)
        if (!model) return false
        try {
          this.#sessions.resolveModel(model)
          return true
        } catch {
          return false
        }
      },
    })
  }

  /** GET /api/agents/definitions?workspaceId=（Workspace 目录的定义）。 */
  async definitions(workspaceId: string): Promise<AgentDefinitionsResponse> {
    const workspace = await this.#options.store.sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    const { definitions, diagnostics } = await this.catalog(workspace.path)
    return {
      definitions: definitions.map((d) => ({
        name: d.name,
        source: d.source,
        description: d.description,
        ...(d.tools ? { tools: [...d.tools] } : {}),
        ...(d.model ? { model: d.model } : {}),
        ...(d.permissionMode ? { permissionMode: d.permissionMode } : {}),
        maxTurns: d.maxTurns,
        ...(d.path ? { path: d.path } : {}),
      })),
      diagnostics,
    }
  }

  // ---- 模型的工具（context/subagents.ts） ----

  port(sessionId: string): SubagentsPort {
    return {
      start: (request, signal) => this.#start(sessionId, request, signal),
      wait: (ids, timeoutMs, signal) => this.#wait(sessionId, ids, timeoutMs, signal),
      cancel: async (agentId) => {
        // teammate（agentId 或成员名）的 agent_cancel 为解散（ADR 0018）。
        const member = await this.#member(sessionId, agentId)
        if (member) return this.dismiss(sessionId, member.agentId)
        const live = this.#live.get(agentId)
        if (!live || live.rootId !== sessionId) throw new Error(`No subagent ${agentId} in this session`)
        live.observed = true
        if (live.status === 'running') await this.#sessions.abort(agentId)
        return live.ended
      },
    }
  }

  async #start(parentId: string, raw: AgentStartRequest, signal?: AbortSignal): Promise<AgentStarted> {
    // 模型给出的参数是原文（assistant 条目入库时才脱敏）：子代理的首条 user message、Session 标题与通知文本都不再经过替换，在这里替换一次。
    const request = { ...raw, description: redactSecretValues(raw.description), prompt: redactSecretValues(raw.prompt) }
    const sessions = this.#sessions
    const { store } = this.#options
    const parent = await store.sessions.getSession(parentId)
    if (!parent) throw new Error(`Session ${parentId} not found`)
    if (parent.parentSessionId !== null) throw new Error('A subagent cannot start subagents')
    const parentRunId = sessions.activeRunId(parentId)
    if (parentRunId === undefined) throw new Error('Subagents can only be started from a running turn')
    const scope = await sessions.scope(parent)
    if (!scope.config.agents.enabled) throw new Error('Subagents are disabled in the settings')
    if (request.name !== undefined) {
      if (!scope.config.teams.enabled) throw new Error('Agent teams are disabled in the settings')
      const problem = teammateNameProblem(request.name)
      if (problem) throw new Error(`invalid-name: ${problem}`)
      if (!request.background) throw new Error('A teammate (name) always runs in the background')
    }
    const { definitions } = await this.catalog(scope.cwd, scope.plugins.agentRoots)
    const definition = definitions.find((d) => d.name === request.subagentType)
    if (!definition) throw new Error(`Unknown subagent type ${request.subagentType}; available: ${definitions.map((d) => d.name).join(', ')}`)
    const modelText = request.model ?? definition.model
    const model = modelText ? parseModel(modelText) : await sessions.sessionModel(parent)
    if (!model) throw new Error(modelText ? `Invalid model ${modelText}; use <providerId>/<modelId>` : 'No model is configured')
    let priced: boolean
    try {
      priced = sessions.resolveModel(model).priced
    } catch {
      throw new Error(`Model ${model.providerId}/${model.modelId} is not in the model catalog`)
    }
    // 预算：派发它的 Run 属于 Goal 时子 Session 的用量计入该 Goal；设了费用上限而子代理模型未定价时不派发。
    const entries = await store.sessions.listEntries(parentId)
    const goal = currentGoal(entries)
    const goalId = goal && !isTerminalPhase(goal.phase) && goalRunIds(entries, goal.id).has(parentRunId) ? goal.id : undefined
    if (goalId && goal!.budget.maxCost !== undefined && !priced)
      throw new Error(`The goal has a cost limit but model ${model.providerId}/${model.modelId} has no price; choose a priced model`)
    if (request.isolation === 'worktree') {
      const mode = await sessions.mode(parentId)
      if (mode === 'plan' || mode === 'read-only') throw new Error(`isolation: worktree is not available in ${mode} mode`)
      if (!this.#worktrees) throw new Error('Worktrees are not available')
    }
    // teammate 的名字与人数：读条目之后、第一个 await 之前与占位一起检查（同一批的同名调用不会同时越过）。
    const teamEntries = request.name !== undefined ? await store.sessions.listEntries(parentId) : undefined
    if (request.name !== undefined) {
      const active = this.#activeTeammates(parentId, teamEntries!)
      if (active.has(request.name)) throw new Error(`teammate-exists: A teammate named ${request.name} already exists in this team`)
      if (active.size >= TEAMMATES_MAX) throw new Error(`team-full: A team has at most ${TEAMMATES_MAX} teammates; dismiss one with agent_cancel first`)
    }
    // 上限在第一个 await 之后、创建之前检查并占位（同一批的并行调用不会同时越过）。
    const running = this.#runningCount(parentId)
    if (running >= MAX_RUNNING_SUBAGENTS) throw new Error(`At most ${MAX_RUNNING_SUBAGENTS} subagents can run at once; wait for one with agent_wait`)
    const token = Symbol('reserve')
    this.#reserving.set(token, parentId)
    if (request.name !== undefined) this.#naming.set(token, { rootId: parentId, name: request.name })
    let live: LiveSubagent | undefined
    let worktree: { id: string; path: string; branch: string } | undefined
    try {
      const base = subagentTools(sessions.visibleTools(parentId) ?? [], definition)
      const tools = request.name !== undefined ? [...base, ...TEAM_TOOL_NAMES.filter((t) => !base.includes(t))] : base
      worktree = request.isolation === 'worktree' ? await this.#worktrees!.createForSubagent(parent.workspaceId, parentId) : undefined
      if (worktree) this.#recovery.isolate(parentId, worktree.path, true)
      const child = await sessions.createSession({
        workspaceId: parent.workspaceId,
        title: request.description,
        parentSessionId: parentId,
        model,
        thinkingLevel: (definition.thinking as StoredSession['thinkingLevel']) ?? parent.thinkingLevel,
        // 没有 isolation 时继承父级的 worktree：子 Session 的工作目录取父级（worktree 会话中派发的子代理不在主 checkout 中工作）。
        ...(worktree ? { worktreeId: worktree.id } : parent.worktreeId ? { worktreeId: parent.worktreeId } : {}),
      })
      live = newLiveSubagent({
        agentId: child.id,
        rootId: parentId,
        parentRunId,
        toolCallId: request.toolCallId,
        ...(goalId ? { goalId } : {}),
        definition,
        tools,
        description: request.description,
        background: request.background,
        startedAt: Date.now(),
        ...(worktree ? { worktreeId: worktree.id, worktreePath: worktree.path } : {}),
        ...(request.name !== undefined ? { name: request.name } : {}),
        triggerRunId: parentRunId,
      })
      this.#live.set(live.agentId, live)
      await this.#recovery.started(live, worktree)
    } catch (error) {
      // 派发没有完成（子 Session、subagent_origin 或 agent_start 提交失败）：不残留 running（不占并行上限、worktree 不判为 busy），
      // isolation worktree 没有改动时回收，询问规则随之去掉。
      if (live) this.#live.delete(live.agentId)
      if (worktree) await this.#recovery.abandon(parentId, worktree)
      log.warn('subagent dispatch failed', { sessionId: parentId, error: errorMessage(error) })
      throw error
    } finally {
      this.#reserving.delete(token)
      this.#naming.delete(token)
    }
    if (live.name) this.#teams?.changed(parentId)
    log.info('subagent started', { sessionId: parentId, agentId: live.agentId, agentType: definition.name, background: request.background })
    // agent_wait / agent_cancel 只在本 Session 有子代理时注册：第一次派发之后在同一个 Run 中补上（"Wait with agent_wait." 可以照做）。
    await sessions.refreshTools(parentId).catch((error: unknown) => log.warn('tool refresh failed', { sessionId: parentId, error: errorMessage(error) }))
    this.#notes.watch(live)
    const abort = () => void this.#sessions.abort(live.agentId).catch(() => undefined)
    // 前台：父 Run 被停止时 abort 子 Run（cancelled）；后台不随父 Run 停止。
    if (!request.background) signal?.addEventListener('abort', abort, { once: true })
    try {
      const child = await store.sessions.getSession(live.agentId)
      const context = this.#options.hooks
        ? await this.#options.hooks.subagentStart(await sessions.scope(child!), { type: definition.name, id: live.agentId })
        : undefined
      const content = [{ type: 'text' as const, text: request.prompt }, ...(context ? [{ type: 'text' as const, text: hookContextText(context) }] : [])]
      if (signal?.aborted && !request.background) throw new Error('aborted')
      const { runId } = await sessions.startRun(live.agentId, { trigger: 'subagent', input: { text: request.prompt, content }, triggerRunId: parentRunId })
      live.runId = runId
    } catch (error) {
      log.warn('subagent run did not start', { agentId: live.agentId, error: errorMessage(error) })
      await this.#finish(live, undefined)
    }
    if (request.background)
      return {
        kind: 'background',
        agentId: live.agentId,
        agentType: definition.name,
        description: request.description,
        ...(live.name ? { name: live.name } : {}),
      }
    try {
      return { kind: 'foreground', outcome: await live.ended }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  /** SubagentStop Hook（子 Session 的 Run 正常结束前，context/subagents.ts 的 onStop）：解释在 HookService，block 时以 reason 再请求一次。 */
  async subagentStop(scope: ContextScope, info: StopInfo): Promise<StopContinue | undefined> {
    const live = scope.sessionId ? this.#live.get(scope.sessionId) : undefined
    if (!this.#options.hooks || !live) return undefined
    const verdict = await this.#options.hooks.subagentStop(scope, info, { type: live.definition.name, id: live.agentId })
    // TeammateIdle 在 SubagentStop 之后（同一个继续上限，ADR 0018）。
    if (verdict || !live.name) return verdict
    return this.#options.hooks.teammateIdle(scope, info, { name: live.name, team: live.rootId })
  }

  /**
   * max-turns：子 Run 的每次请求前计数本 Run 已提交的 assistant 条目，耗尽时以 max_turns 停止（不发出该请求）。按条目计数：自动压缩把上下文
   * 换成摘要之后，上下文中的 assistant 消息变少，不能据此重新计数。
   */
  async beforeRequest(state: BeforeRequestState, scope: ContextScope): Promise<RequestVerdict> {
    const max = scope.subagent?.maxTurns
    if (max === undefined || !scope.parentSessionId || !scope.sessionId) return undefined
    const entries = await this.#options.entries.list(scope.sessionId)
    const turns = entries.filter((e) => e.runId === state.runId && e.kind === 'message' && (e.payload as { role?: string }).role === 'assistant').length
    if (turns < max) return undefined
    return { stop: { code: 'max_turns', message: `The subagent reached its turn limit (${max})` } }
  }

  /** 子 Session 的 Run 结束（context/subagents.ts 的 onRunEnd）；父 Session 的 Run 结束时挂起没有送达的通知。 */
  async runEnded(info: RunEndInfo): Promise<void> {
    const live = this.#live.get(info.sessionId)
    if (live && info.trigger === 'subagent') {
      await this.#finish(live, info.result)
      return
    }
    this.#notes.parentRunEnded(info)
  }

  /** 父 Session 空闲时结束的后台子代理的通知：合并到下一个 Run 的 user message 开头，前置 agent_notification。 */
  pendingInput(sessionId: string): PendingInput | undefined {
    return this.#notes.pendingInput(sessionId)
  }

  /** 子 Run 结束（或没能开始）：用量、worktree 清理、父级 agent_end、前台结果或后台通知。只执行一次。 */
  async #finish(live: LiveSubagent, result: RunResult | undefined): Promise<void> {
    if (live.status !== 'running') return
    const status = endStatus(result)
    live.status = status
    live.unsubscribe?.()
    // 前台：与派发它的调用同一 Run；后台：父 Session 提交时的 Run（没有时不属于 Run）。
    const outcome = await this.#recovery.end(live, status, () => (live.background ? this.#sessions.activeRunId(live.rootId) : live.parentRunId))
    live.outcome = outcome
    if (live.waiters > 0) live.observed = true
    this.#notes.progress(live)
    log.info('subagent ended', { sessionId: live.rootId, agentId: live.agentId, status, ...outcome.usage })
    live.resolve(outcome)
    this.#notes.ended(live)
    if (live.name) this.#teams?.changed(live.rootId)
    this.#flush(live.rootId)
  }

  #wait(sessionId: string, ids: readonly string[] | undefined, timeoutMs: number, signal?: AbortSignal): Promise<AgentWaitItem[]> {
    const mine = [...this.#live.values()].filter((l) => l.rootId === sessionId)
    return this.#notes.wait(sessionId, mine, ids, timeoutMs, signal)
  }

  // ---- 团队（ADR 0018）：名册、继续对话、排队与解散 ----

  /** 根 Session 正在运行（含占位）的子代理数（teammate 与子代理共用上限）。 */
  #runningCount(rootId: string): number {
    return this.runningChildren(rootId).length + [...this.#reserving.values()].filter((id) => id === rootId).length
  }

  /** 未解散的 teammate 名字：条目给出的名册、进程内的 teammate 与派发中的占位。 */
  #activeTeammates(rootId: string, entries: Parameters<typeof teamRoster>[0]): Set<string> {
    const names = new Set<string>()
    for (const member of teamRoster(entries)) {
      const live = this.#live.get(member.agentId)
      const status = live?.status === 'dismissed' ? 'dismissed' : memberStatus(member, live?.status === 'running')
      if (status !== 'dismissed') names.add(member.name)
    }
    for (const n of this.#naming.values()) if (n.rootId === rootId) names.add(n.name)
    return names
  }

  /** 根 Session 的 teammate（agentId 或名字）；不是 teammate 时 undefined。 */
  async #member(rootId: string, ref: string) {
    const roster = teamRoster(await this.#options.store.sessions.listEntries(rootId))
    return roster.find((m) => m.agentId === ref) ?? roster.findLast((m) => m.name === ref)
  }

  /** 进程内的子代理状态（团队名册：running 与当前活动）。 */
  liveInfo(agentId: string): { running: boolean; dismissed: boolean; activity?: { toolName: string; summary: string } } | undefined {
    const live = this.#live.get(agentId)
    if (!live) return undefined
    return { running: live.status === 'running', dismissed: live.status === 'dismissed', ...(live.activity ? { activity: live.activity } : {}) }
  }

  /** 子 Session 的 teammate 名字与根 Session（send_message 与 task_* 的发起者）；不是 teammate 时 undefined。 */
  teammateOf(sessionId: string): { name: string; rootId: string; triggerRunId?: string } | undefined {
    const live = this.#live.get(sessionId)
    return live?.name ? { name: live.name, rootId: live.rootId, ...(live.triggerRunId ? { triggerRunId: live.triggerRunId } : {}) } : undefined
  }

  /** 团队消息送给 lead（根 Session）：Run 中为追加指令，空闲时挂起到下一个 Run（不唤醒，与后台子代理通知相同）。 */
  leadNote(rootId: string, text: string, before: RunEntry[]): void {
    this.#notes.hostNote(rootId, { text, before })
  }

  /**
   * 团队消息送给子 Session（teammate 或已结束的一次性子代理，C3 / C8）：运行中为追加指令；空闲时以 trigger subagent 开始新的 Run（输入为该消息，
   * 结束时父级收到 agent_notification）；根 Session 已有 MAX_RUNNING_SUBAGENTS 个 running 时排队，有空位后开始（不是错误）。可达性由调用方判定。
   * 子 Session 有未回答的结果确认（重启时工具执行中被中断）时不能开始 Run：agent-not-reachable，不改变它的状态。
   */
  async deliverMessage(rootId: string, delivery: ChildDelivery): Promise<'steered' | 'started' | 'queued'> {
    const live = this.#live.get(delivery.agentId) ?? (await this.#revive(rootId, delivery.agentId))
    if (!live) throw new TeamMessageError('agent-not-reachable', `No subagent ${delivery.agentId} in this team`)
    const input = { text: delivery.text, content: [{ type: 'text' as const, text: delivery.text }], before: delivery.before }
    if (live.status === 'running') {
      if (this.#sessions.deliver(live.agentId, input)) return 'steered'
      // Run 刚结束、#finish 还没执行：排队，结束后开始。
      this.#enqueue(rootId, delivery)
      return 'queued'
    }
    if (unansweredConfirmations(await this.#options.store.sessions.listEntries(live.agentId)).length > 0)
      throw new TeamMessageError(
        'agent-not-reachable',
        `${live.name ?? live.agentId} is waiting for an outcome confirmation of an interrupted tool call; the user must answer it in that session first`,
      )
    if (this.#runningCount(rootId) >= MAX_RUNNING_SUBAGENTS) {
      this.#enqueue(rootId, delivery)
      return 'queued'
    }
    await this.#continue(live, delivery)
    return 'started'
  }

  #enqueue(rootId: string, delivery: ChildDelivery): void {
    this.#queued.set(rootId, [...(this.#queued.get(rootId) ?? []), delivery])
    log.info('team message queued', { sessionId: rootId, agentId: delivery.agentId })
  }

  /** 有子代理结束（或解散）后：按顺序送达排队的消息，直到并行上限。 */
  #flush(rootId: string): void {
    const queue = this.#queued.get(rootId)
    if (!queue || queue.length === 0) return
    this.#queued.delete(rootId)
    for (const delivery of queue)
      void this.deliverMessage(rootId, delivery).catch((error: unknown) =>
        log.warn('queued team message not delivered', { sessionId: rootId, agentId: delivery.agentId, error: errorMessage(error) }),
      )
  }

  /** 已结束的子代理开始新的 Run（继续对话）：用量按 triggerRunId 归属 Goal；没能开始时记为 failed。 */
  async #continue(live: LiveSubagent, delivery: ChildDelivery): Promise<void> {
    rearmLiveSubagent(live, delivery.triggerRunId)
    const entries = await this.#options.store.sessions.listEntries(live.rootId)
    const goal = currentGoal(entries)
    const inGoal = goal && !isTerminalPhase(goal.phase) && delivery.triggerRunId !== undefined && goalRunIds(entries, goal.id).has(delivery.triggerRunId)
    if (inGoal) live.goalId = goal.id
    else delete live.goalId
    this.#notes.watch(live)
    this.#teams?.changed(live.rootId)
    try {
      const input = { text: delivery.text, content: [{ type: 'text' as const, text: delivery.text }], before: delivery.before }
      const { runId } = await this.#sessions.startRun(live.agentId, {
        trigger: 'subagent',
        input,
        ...(delivery.triggerRunId ? { triggerRunId: delivery.triggerRunId } : {}),
      })
      live.runId = runId
      log.info('subagent continued', { sessionId: live.rootId, agentId: live.agentId, ...(live.name ? { name: live.name } : {}) })
    } catch (error) {
      log.warn('subagent continuation did not start', { agentId: live.agentId, error: errorMessage(error) })
      await this.#finish(live, undefined)
    }
  }

  /** 重启后（不在进程内）的子代理：从 agent_start 与子 Session 的 subagent_origin 恢复定义与工具（不改条目）。 */
  async #revive(rootId: string, agentId: string): Promise<LiveSubagent | undefined> {
    const { store } = this.#options
    const entries = await store.sessions.listEntries(rootId)
    const start = agentStarts(entries).find((e) => e.payload.agentId === agentId)
    if (!start) return undefined
    const root = await store.sessions.getSession(rootId)
    const origin = (await store.sessions.listEntries(agentId, { limit: 1 }))[0]
    if (!root || origin?.kind !== 'subagent_origin') return undefined
    if (this.#live.has(agentId)) return this.#live.get(agentId)
    const saved = (origin.payload as unknown as SubagentOriginPayload).definition
    const scope = await this.#sessions.scope(root)
    const { definitions } = await this.catalog(scope.cwd, scope.plugins.agentRoots)
    const found = definitions.find((d) => d.name === saved.name)
    const definition = {
      ...(found ?? { name: saved.name, description: '', source: saved.source, disallowedTools: [], prompt: '' }),
      maxTurns: saved.maxTurns,
      ...(saved.permissionMode ? { permissionMode: saved.permissionMode } : {}),
    }
    const payload: AgentStartPayload = start.payload
    const worktree = payload.isolation ? await store.worktrees.get(payload.isolation.worktreeId) : undefined
    const live = newLiveSubagent({
      agentId,
      rootId,
      parentRunId: start.runId ?? '',
      toolCallId: payload.toolCallId,
      definition,
      tools: [...saved.tools],
      description: payload.description,
      background: true,
      startedAt: start.createdAt,
      ...(payload.isolation && worktree?.status === 'active' ? { worktreeId: payload.isolation.worktreeId, worktreePath: payload.isolation.path } : {}),
      ...(payload.name ? { name: payload.name } : {}),
    })
    const ends = entries.filter((e) => e.kind === 'agent_end' && (e.payload as { agentId?: string }).agentId === agentId)
    live.status = ((ends.at(-1)?.payload as { status?: AgentOutcome['status'] } | undefined)?.status ?? 'interrupted') as LiveSubagent['status']
    live.observed = true
    this.#live.set(agentId, live)
    return live
  }

  /**
   * 解散 teammate（agent_cancel，ADR 0018）：运行中先 abort 并等待该 Run 结束，再提交 agent_end { status: dismissed }；isolation worktree 没有改动时
   * 移除、有改动时保留并注明；排队给它的消息丢弃。已解散的为 agent-not-reachable。
   */
  async dismiss(rootId: string, ref: string): Promise<AgentOutcome> {
    const member = await this.#member(rootId, ref)
    if (!member) throw new Error(`No teammate ${ref} in this team`)
    const live = this.#live.get(member.agentId)
    if (live?.status === 'dismissed' || (!live && member.lastEnd?.status === 'dismissed'))
      throw new TeamMessageError('agent-not-reachable', `Teammate ${member.name} was already dismissed`)
    this.#queued.set(
      rootId,
      (this.#queued.get(rootId) ?? []).filter((d) => d.agentId !== member.agentId),
    )
    if (live?.status === 'running') {
      live.observed = true
      await this.#sessions.abort(live.agentId)
      await live.ended
    }
    // worktree 已在之前回收（进程内记录已去掉）时不再处理 isolation；否则按 agent_start 的 isolation 回收或保留。
    const { isolation: _isolation, ...withoutIsolation } = member.start
    const start: AgentStartPayload = live && !live.worktreeId ? withoutIsolation : member.start
    const outcome = await this.#recovery.dismissed(rootId, start, this.#sessions.activeRunId(rootId))
    if (live) {
      live.status = 'dismissed'
      live.outcome = outcome
      live.observed = true
      live.unsubscribe?.()
    }
    log.info('teammate dismissed', { sessionId: rootId, agentId: member.agentId, name: member.name })
    this.#teams?.changed(rootId)
    this.#flush(rootId)
    return outcome
  }

  // ---- 用户的动作（HTTP）与 Goal ----

  /** GET /api/sessions/:id/agents：父 Session 的 agent_start / agent_end 与进程内状态；Session 不存在时 not-found。 */
  async list(sessionId: string): Promise<AgentSnapshot[]> {
    if (!(await this.#options.store.sessions.getSession(sessionId))) throw new AppError('not-found', `Session ${sessionId} not found`)
    return agentSnapshots(await this.#options.store.sessions.listEntries(sessionId), (agentId) => this.#live.get(agentId)?.status === 'running')
  }

  /** POST /api/sessions/:id/agents/:agentId/cancel：已结束（或不是该 Session 的子代理）409 agent-not-running。 */
  async cancel(sessionId: string, agentId: string): Promise<void> {
    const live = this.#live.get(agentId)
    if (!live || live.rootId !== sessionId || live.status !== 'running') throw new AppError('agent-not-running', `Subagent ${agentId} is not running`)
    log.info('subagent cancel requested', { sessionId, agentId, by: 'user' })
    await this.#sessions.abort(agentId)
    await live.ended
  }

  /** 取消 Goal：停止该 Goal 的 Run 派发的全部 running 子代理（前台与后台），等待各自的 agent_end。 */
  async stopForGoal(sessionId: string, goalId: string): Promise<number> {
    const targets = [...this.#live.values()].filter((l) => l.rootId === sessionId && l.goalId === goalId && l.status === 'running')
    await Promise.all(
      targets.map(async (l) => {
        l.observed = true
        await this.#sessions.abort(l.agentId)
        await l.ended
      }),
    )
    return targets.length
  }

  // ---- 启动恢复与关闭 ----

  /** 启动恢复的第一步（Session 恢复之前；subagent-recovery.ts）：被中断的父 Run 中没有结果的 agent 调用补 interrupted 与中断说明。 */
  prepareRecovery(source: RecoverySource): Promise<number> {
    return this.#recovery.prepare(source)
  }

  /** 启动恢复（Session 恢复之后；subagent-recovery.ts）：其余没有 agent_end 的子代理补记 interrupted；返回补记的数量。 */
  recover(source: RecoverySource): Promise<number> {
    return this.#recovery.recover(source)
  }

  async close(): Promise<void> {
    this.#notes.close()
  }
}

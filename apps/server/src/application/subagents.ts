// 子代理（ADR 0014，docs/subsystems/subagents.md）的应用服务：派发（子 Session 创建、agent_start / subagent_origin、SubagentStart Hook、
// trigger subagent 的子 Run）、前台等待与后台通知、并行上限、取消传播（父 Run 停止、agent_cancel、取消 Goal）、agent_end 与用量、
// agent_update 进度、等待审批与结束的桌面通知、isolation worktree 的清理，以及启动恢复（未结束的子代理补记 interrupted）。
import {
  AGENT_NOT_STARTED_TEXT,
  agentInterruptedText,
  agentNotificationText,
  createAgentDefinitionLoader,
  currentGoal,
  goalRunIds,
  isTerminalPhase,
  selectHooks,
  subagentTools,
  type AgentCatalog,
  type AgentDefinition,
  type AgentDefinitionLoader,
  type AgentEndStatus,
  type AgentOutcome,
  type AgentStarted,
  type AgentStartPayload,
  type AgentStartRequest,
  type AgentUsageTotals,
  type AgentWaitItem,
  type BeforeRequestState,
  type PermissionRule,
  type RunEntry,
  type RunInput,
  type RunResult,
  type StandardPermissionMode,
  type StopContinue,
  type StopInfo,
  type SubagentsPort,
} from '@coko/agent'
import { hookContextText } from '@coko/agent/entries'
import { getLogger, redactSecretValues, redactText } from '@coko/logging'
import { AGENT_ACTIVITY_SUMMARY_MAX, MAX_RUNNING_SUBAGENTS, type AgentDefinitionsResponse, type AgentSnapshot, type SessionModel } from '@coko/protocol'
import type { NewSession, Session as StoredSession, SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import type { ConfigService } from './config.ts'
import type { ContextScope, PendingInput, RequestVerdict, RunEndInfo, RunRequest, SessionEntryAccess } from './context/types.ts'
import { AppError, errorMessage } from './errors.ts'
import type { HookService } from './hooks.ts'
import type { SessionHub } from './hub.ts'
import type { NotificationService } from './notifications.ts'
import type { RecoverySource } from './recovery.ts'
import type { PermissionScopeResolver } from './session-permissions.ts'
import type { SessionSubagents } from './session-runs.ts'
import type { WorktreeService } from './worktrees.ts'

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
  mode(sessionId: string): Promise<string>
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

/** 一个本进程内派发的子代理。 */
interface Live {
  agentId: string
  rootId: string
  parentRunId: string
  toolCallId: string
  goalId?: string
  definition: AgentDefinition
  tools: string[]
  description: string
  background: boolean
  startedAt: number
  worktreeId?: string
  /** 子 Run 的 runId（开始后）。 */
  runId?: string
  status: 'running' | AgentEndStatus
  outcome?: AgentOutcome
  ended: Promise<AgentOutcome>
  resolve: (outcome: AgentOutcome) => void
  /** 模型已用 agent_wait / agent_cancel 读到终态（不再通知）。 */
  observed: boolean
  /** 正在 agent_wait 中等待它的调用数（结束时有等待者即视为已读到）。 */
  waiters: number
  /** 结束时提交 agent_end 的 runId 来源：前台为派发它的 Run。 */
  unsubscribe?: () => void
}

const ZERO: AgentUsageTotals = { turns: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 }
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** 子 Session 的用量：assistant 消息数为轮次，toolResult 数为工具调用，usage 之和，各 Run 的时长之和。 */
export function childUsage(entries: readonly StoredEntry[], now = Date.now()): AgentUsageTotals {
  const totals = { ...ZERO }
  const started = new Map<string, number>()
  for (const entry of entries) {
    if (entry.kind === 'run_start' && entry.runId) started.set(entry.runId, entry.createdAt)
    else if (entry.kind === 'run_end' && entry.runId) {
      const at = started.get(entry.runId)
      if (at !== undefined) totals.durationMs += Math.max(0, entry.createdAt - at)
      started.delete(entry.runId)
    } else if (entry.kind === 'message') {
      const m = entry.payload as {
        role?: string
        usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
      }
      if (m.role === 'assistant') {
        totals.turns++
        if (m.usage) {
          totals.tokens += num(m.usage.input) + num(m.usage.output) + num(m.usage.cacheRead) + num(m.usage.cacheWrite)
          totals.cost += num(m.usage.cost?.total)
        }
      } else if (m.role === 'toolResult') totals.toolCalls++
    }
  }
  for (const at of started.values()) totals.durationMs += Math.max(0, now - at)
  totals.durationMs = Math.round(totals.durationMs)
  return totals
}

/** 子 Session 最后一条非空 assistant 文本。 */
function lastAssistantText(entries: readonly StoredEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i]!.payload as { role?: string; content?: unknown }
    if (entries[i]!.kind !== 'message' || m.role !== 'assistant' || !Array.isArray(m.content)) continue
    const text = (m.content as { type?: string; text?: string }[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
    if (text !== '') return text
  }
  return ''
}

/** Run 的结果 → agent_end 的状态（状态只来自运行时，不读子代理的文本）。 */
function endStatus(result: RunResult | undefined): AgentEndStatus {
  if (!result) return 'failed'
  if (result.status === 'completed') return 'completed'
  if (result.error?.code === 'max_turns') return 'max-turns'
  if (result.status === 'aborted' || (result.status === 'paused' && !result.error)) return 'cancelled'
  return 'failed'
}

const parseModel = (text: string): SessionModel | undefined => {
  const at = text.indexOf('/')
  return at > 0 && at < text.length - 1 ? { providerId: text.slice(0, at), modelId: text.slice(at + 1) } : undefined
}

/** 工具调用的一行摘要（已脱敏、≤ 120 字符）。 */
function activitySummary(args: unknown): string {
  const raw = typeof args === 'object' && args !== null ? JSON.stringify(args) : String(args ?? '')
  const text = redactText(raw).replace(/\s+/g, ' ')
  return text.length > AGENT_ACTIVITY_SUMMARY_MAX ? text.slice(0, AGENT_ACTIVITY_SUMMARY_MAX - 1) + '…' : text
}

const SUBAGENT_CONTEXT_MAX = 10_000

export class SubagentService implements PermissionScopeResolver, SessionSubagents {
  readonly #options: SubagentServiceOptions
  readonly #loader: AgentDefinitionLoader
  readonly #live = new Map<string, Live>()
  /** 每个父 Session 待送达的通知（Session 空闲时结束的后台子代理）。 */
  readonly #pending = new Map<string, string[]>()
  /** 作为追加指令送出的通知（Run 结束时没有送达的挂起）。 */
  readonly #sent = new Map<string, { text: string; agentIds: string[] }[]>()
  /** agent_wait 的唤醒（追加指令到达）。 */
  readonly #interrupts = new Map<string, AbortController>()
  #host: SubagentSessionHost | undefined
  #closing = false

  constructor(options: SubagentServiceOptions) {
    this.#options = options
    this.#loader = options.loader ?? createAgentDefinitionLoader()
    this.#worktrees = options.worktrees
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

  /** 每个根 Session 的子代理 isolation worktree（派发时与启动恢复时登记；已移除的去掉）。 */
  readonly #isolated = new Map<string, Set<string>>()

  extraRules(sessionId: string): PermissionRule[] {
    return [...(this.#isolated.get(sessionId) ?? [])].map((path) => ({ behavior: 'ask' as const, tool: 'Read', content: path }))
  }

  #isolate(rootId: string, path: string, on: boolean): void {
    const set = this.#isolated.get(rootId) ?? new Set<string>()
    if (on) set.add(path)
    else set.delete(path)
    if (set.size > 0) this.#isolated.set(rootId, set)
    else this.#isolated.delete(rootId)
  }

  definition(sessionId: string): ContextScope['subagent'] | undefined {
    const live = this.#live.get(sessionId)
    if (!live) return undefined
    const { name, permissionMode, maxTurns } = live.definition
    return { name, tools: live.tools, ...(permissionMode ? { permissionMode } : {}), maxTurns }
  }

  steered(sessionId: string): void {
    this.#interrupts.get(sessionId)?.abort()
    this.#interrupts.delete(sessionId)
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

  async catalog(cwd: string): Promise<AgentCatalog> {
    const known = new Set(this.#sessions.toolNames(cwd))
    return this.#loader.load({
      cwd,
      cokoHome: this.#options.cokoHome,
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
    const { definitions } = await this.catalog(scope.cwd)
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
    // 上限在第一个 await 之后、创建之前检查并占位（同一批的并行调用不会同时越过）。
    const running = this.runningChildren(parentId).length + [...this.#reserving.values()].filter((id) => id === parentId).length
    if (running >= MAX_RUNNING_SUBAGENTS) throw new Error(`At most ${MAX_RUNNING_SUBAGENTS} subagents can run at once; wait for one with agent_wait`)
    const token = Symbol('reserve')
    this.#reserving.set(token, parentId)
    let live: Live | undefined
    let worktree: { id: string; path: string; branch: string } | undefined
    try {
      const tools = subagentTools(sessions.visibleTools(parentId) ?? [], definition)
      worktree = request.isolation === 'worktree' ? await this.#worktrees!.createForSubagent(parent.workspaceId, parentId) : undefined
      if (worktree) this.#isolate(parentId, worktree.path, true)
      const child = await sessions.createSession({
        workspaceId: parent.workspaceId,
        title: request.description,
        parentSessionId: parentId,
        model,
        thinkingLevel: (definition.thinking as StoredSession['thinkingLevel']) ?? parent.thinkingLevel,
        // 没有 isolation 时继承父级的 worktree：子 Session 的工作目录取父级（worktree 会话中派发的子代理不在主 checkout 中工作）。
        ...(worktree ? { worktreeId: worktree.id } : parent.worktreeId ? { worktreeId: parent.worktreeId } : {}),
      })
      const agentId = child.id
      let resolve!: (outcome: AgentOutcome) => void
      const ended = new Promise<AgentOutcome>((r) => (resolve = r))
      live = {
        agentId,
        rootId: parentId,
        parentRunId,
        toolCallId: request.toolCallId,
        ...(goalId ? { goalId } : {}),
        definition,
        tools,
        description: request.description,
        background: request.background,
        startedAt: Date.now(),
        ...(worktree ? { worktreeId: worktree.id } : {}),
        status: 'running',
        ended,
        resolve,
        observed: !request.background,
        waiters: 0,
      }
      this.#live.set(agentId, live)
      // 子 Session 的首条：来源与定义；父级：agent_start（与派发它的调用同一 Run）。
      await this.#options.entries.commit(agentId, {
        kind: 'subagent_origin',
        payload: {
          parentSessionId: parentId,
          parentRunId,
          toolCallId: request.toolCallId,
          definition: {
            name: definition.name,
            source: definition.source,
            tools,
            ...(definition.model ? { model: definition.model } : {}),
            ...(definition.permissionMode ? { permissionMode: definition.permissionMode } : {}),
            maxTurns: definition.maxTurns,
          },
        },
      })
      await this.#options.entries.commit(parentId, {
        kind: 'agent_start',
        runId: parentRunId,
        payload: {
          agentId,
          agentType: definition.name,
          description: request.description,
          background: request.background,
          toolCallId: request.toolCallId,
          ...(goalId ? { goalId } : {}),
          ...(worktree ? { isolation: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch } } : {}),
        },
      })
    } catch (error) {
      // 派发没有完成（子 Session、subagent_origin 或 agent_start 提交失败）：不残留 running（不占并行上限、worktree 不判为 busy），
      // isolation worktree 没有改动时回收，询问规则随之去掉。
      if (live) this.#live.delete(live.agentId)
      if (worktree) {
        const created = worktree
        const removed = await this.#worktrees!.removeIfUnchanged(created.id).catch(() => undefined)
        if (removed?.removed) this.#isolate(parentId, created.path, false)
      }
      log.warn('subagent dispatch failed', { sessionId: parentId, error: errorMessage(error) })
      throw error
    } finally {
      this.#reserving.delete(token)
    }
    log.info('subagent started', { sessionId: parentId, agentId: live.agentId, agentType: definition.name, background: request.background })
    // agent_wait / agent_cancel 只在本 Session 有子代理时注册：第一次派发之后在同一个 Run 中补上（"Wait with agent_wait." 可以照做）。
    await sessions.refreshTools(parentId).catch((error: unknown) => log.warn('tool refresh failed', { sessionId: parentId, error: errorMessage(error) }))
    this.#watch(live)
    const abort = () => void this.#sessions.abort(live.agentId).catch(() => undefined)
    // 前台：父 Run 被停止时 abort 子 Run（cancelled）；后台不随父 Run 停止。
    if (!request.background) signal?.addEventListener('abort', abort, { once: true })
    try {
      const child = await store.sessions.getSession(live.agentId)
      const context = await this.#subagentStart(child!, live)
      const content = [{ type: 'text' as const, text: request.prompt }, ...(context ? [{ type: 'text' as const, text: hookContextText(context) }] : [])]
      if (signal?.aborted && !request.background) throw new Error('aborted')
      const { runId } = await sessions.startRun(live.agentId, { trigger: 'subagent', input: { text: request.prompt, content } })
      live.runId = runId
    } catch (error) {
      log.warn('subagent run did not start', { agentId: live.agentId, error: errorMessage(error) })
      await this.#finish(live, undefined)
    }
    if (request.background) return { kind: 'background', agentId: live.agentId, agentType: definition.name, description: request.description }
    try {
      return { kind: 'foreground', outcome: await live.ended }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  readonly #reserving = new Map<symbol, string>()

  /** SubagentStart Hook：additionalContext 并入子代理的首条消息（≤ 10 000 字符，已脱敏）。 */
  async #subagentStart(child: StoredSession, live: Live): Promise<string | undefined> {
    const service = this.#options.hooks
    if (!service) return undefined
    try {
      const scope = await this.#sessions.scope(child)
      const state = service.runState(scope)
      const hooks = selectHooks(await state.hooks, 'SubagentStart', { names: [live.definition.name] })
      const results = await service.run(scope, state, 'SubagentStart', hooks, { agent_type: live.definition.name, agent_id: live.agentId })
      const text = results
        .map((r) => r.result.context)
        .filter((c): c is string => !!c)
        .join('\n\n')
      return text === '' ? undefined : redactSecretValues(text).slice(0, SUBAGENT_CONTEXT_MAX)
    } catch (error) {
      log.warn('SubagentStart hooks failed', { agentId: live.agentId, error: errorMessage(error) })
      return undefined
    }
  }

  /** SubagentStop Hook（子 Session 的 Run 正常结束前，context/subagents.ts 的 onStop）：block 时以 reason 再请求一次。 */
  async subagentStop(scope: ContextScope, info: StopInfo): Promise<StopContinue | undefined> {
    const service = this.#options.hooks
    const live = scope.sessionId ? this.#live.get(scope.sessionId) : undefined
    if (!service || !live) return undefined
    const state = service.runState(scope)
    state.runId = info.runId
    const hooks = selectHooks(await state.hooks, 'SubagentStop', { names: [live.definition.name] })
    const results = await service.run(scope, state, 'SubagentStop', hooks, {
      stop_hook_active: info.stopHookActive,
      agent_type: live.definition.name,
      agent_id: live.agentId,
    })
    const blocked = results.find((r) => r.result.block)
    if (!blocked) return undefined
    const reason = redactSecretValues(blocked.result.reason ?? 'A SubagentStop hook asked the subagent to continue').slice(0, SUBAGENT_CONTEXT_MAX)
    return { continue: [{ type: 'text', text: reason }] }
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
    const sent = this.#sent.get(info.sessionId)
    if (!sent) return
    this.#sent.delete(info.sessionId)
    const undelivered = new Set(info.result.undeliveredSteering ?? [])
    for (const note of sent) if (undelivered.has(note.text)) this.#pending.set(info.sessionId, [...(this.#pending.get(info.sessionId) ?? []), ...note.agentIds])
  }

  /** 父 Session 空闲时结束的后台子代理的通知：合并到下一个 Run 的 user message 开头，前置 agent_notification。 */
  pendingInput(sessionId: string): PendingInput | undefined {
    const ids = (this.#pending.get(sessionId) ?? []).filter((id) => {
      const live = this.#live.get(id)
      return live?.outcome && !live.observed
    })
    if (ids.length === 0) return undefined
    const notes = ids.map((id) => agentNotificationText(this.#live.get(id)!.outcome!).text)
    return {
      content: notes.map((text) => ({ type: 'text' as const, text: text + '\n\n' })),
      before: [{ kind: 'agent_notification', payload: { agentIds: ids } }],
      delivered: () => {
        const left = (this.#pending.get(sessionId) ?? []).filter((id) => !ids.includes(id))
        if (left.length > 0) this.#pending.set(sessionId, left)
        else this.#pending.delete(sessionId)
        for (const id of ids) this.#live.get(id)!.observed = true
      },
    }
  }

  /** 子 Run 结束（或没能开始）：用量、worktree 清理、父级 agent_end、前台结果或后台通知。只执行一次。 */
  async #finish(live: Live, result: RunResult | undefined): Promise<void> {
    if (live.status !== 'running') return
    const status = endStatus(result)
    live.status = status
    live.unsubscribe?.()
    const { store } = this.#options
    let outcome: AgentOutcome = { agentId: live.agentId, agentType: live.definition.name, description: live.description, status, usage: ZERO, text: '' }
    try {
      const entries = await store.sessions.listEntries(live.agentId)
      const text = lastAssistantText(entries)
      let worktree: AgentOutcome['worktree']
      if (live.worktreeId && this.#worktrees) {
        const removed = await this.#worktrees.removeIfUnchanged(live.worktreeId).catch((error: unknown) => {
          log.warn('subagent worktree cleanup failed', { agentId: live.agentId, error: errorMessage(error) })
          return undefined
        })
        if (removed && !removed.removed) worktree = { kept: true, path: removed.path, branch: removed.branch }
        else if (removed?.removed) {
          const start = (await store.sessions.listEntries(live.rootId)).find(
            (e) => e.kind === 'agent_start' && (e.payload as { agentId: string }).agentId === live.agentId,
          )
          const path = (start?.payload as { isolation?: { path: string } } | undefined)?.isolation?.path
          if (path) this.#isolate(live.rootId, path, false)
        }
      }
      outcome = { ...outcome, usage: childUsage(entries), text, ...(worktree ? { worktree } : {}) }
      // 前台：与派发它的调用同一 Run；后台：父 Session 此刻的 Run（没有时不属于 Run）。
      const runId = live.background ? this.#sessions.activeRunId(live.rootId) : live.parentRunId
      await this.#options.entries.commit(live.rootId, {
        kind: 'agent_end',
        ...(runId ? { runId } : {}),
        payload: { agentId: live.agentId, status, usage: outcome.usage, resultChars: text.length, ...(worktree ? { worktree } : {}) },
      })
    } catch (error) {
      log.error('subagent end failed', { agentId: live.agentId, error: errorMessage(error) })
    }
    live.outcome = outcome
    if (live.waiters > 0) live.observed = true
    this.#progress(live)
    log.info('subagent ended', { sessionId: live.rootId, agentId: live.agentId, status, ...outcome.usage })
    live.resolve(outcome)
    if (live.background && !this.#closing) {
      void this.#options.notifications
        ?.notify({ kind: 'agent-finished', sessionId: live.rootId, title: `Subagent ${status}`, body: `${live.definition.name}: ${live.description}` })
        .catch(() => undefined)
      if (!live.observed) this.#notify(live)
    }
  }

  /** 后台子代理结束的通知：父 Session 有 Run 时作为追加指令送达（前置 agent_notification），否则挂起到下一个 Run。 */
  #notify(live: Live): void {
    const { text } = agentNotificationText(live.outcome!)
    const delivered = this.#sessions.deliver(live.rootId, {
      text,
      content: [{ type: 'text', text }],
      before: [{ kind: 'agent_notification', payload: { agentIds: [live.agentId] } }],
    })
    if (delivered) {
      live.observed = true
      this.#sent.set(live.rootId, [...(this.#sent.get(live.rootId) ?? []), { text, agentIds: [live.agentId] }])
    } else this.#pending.set(live.rootId, [...(this.#pending.get(live.rootId) ?? []), live.agentId])
    log.info(delivered ? 'subagent notification sent' : 'subagent notification pending', { sessionId: live.rootId, agentId: live.agentId })
  }

  /** 子 Session 的条目：工具调用 → agent_update 进度（父 Session）；后台子代理的审批请求 → approval-waiting 通知。 */
  #watch(live: Live): void {
    this.#progress(live)
    live.unsubscribe = this.#options.hub.subscribe(live.agentId, (message) => {
      if (message.type !== 'entry') return
      const entry = message.entry
      if (entry.kind === 'approval_request' && live.background && !this.#closing)
        void this.#options.notifications
          ?.notify({
            kind: 'approval-waiting',
            sessionId: live.rootId,
            title: 'Subagent is waiting for approval',
            body: `${live.definition.name}: ${live.description}`,
          })
          .catch(() => undefined)
      if (entry.kind !== 'message') return
      const m = entry.payload as { role?: string; content?: unknown }
      if (m.role !== 'assistant' || !Array.isArray(m.content)) return
      const call = (m.content as { type?: string; name?: string; arguments?: unknown }[]).filter((b) => b.type === 'toolCall').at(-1)
      if (call?.name) this.#progress(live, { toolName: call.name, summary: activitySummary(call.arguments) })
    })
  }

  #progress(live: Live, activity?: { toolName: string; summary: string }): void {
    const runId = this.#sessions.activeRunId(live.rootId) ?? ''
    this.#options.hub.publishProgress(live.rootId, runId, {
      type: 'agent_update',
      agentId: live.agentId,
      status: live.status,
      ...(activity ? { activity } : {}),
    })
  }

  async #wait(sessionId: string, ids: readonly string[] | undefined, timeoutMs: number, signal?: AbortSignal): Promise<AgentWaitItem[]> {
    const mine = [...this.#live.values()].filter((l) => l.rootId === sessionId)
    const targets = ids ? ids.map((id) => mine.find((l) => l.agentId === id) ?? id) : mine.filter((l) => l.status === 'running')
    const unknown = targets.filter((t): t is string => typeof t === 'string')
    if (unknown.length > 0) throw new Error(`No subagent ${unknown.join(', ')} in this session`)
    const lives = targets as Live[]
    const listed = ids === undefined && lives.length === 0 ? mine : lives
    const running = lives.filter((l) => l.status === 'running')
    if (running.length > 0) {
      const controller = new AbortController()
      this.#interrupts.set(sessionId, controller)
      for (const l of running) l.waiters++
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all(running.map((l) => l.ended)),
          new Promise((r) => (timer = setTimeout(r, timeoutMs))),
          new Promise((r) => controller.signal.addEventListener('abort', r, { once: true })),
          new Promise((r) => signal?.addEventListener('abort', r, { once: true })),
        ])
      } finally {
        clearTimeout(timer)
        for (const l of running) l.waiters--
        if (this.#interrupts.get(sessionId) === controller) this.#interrupts.delete(sessionId)
      }
    }
    return listed.map((l) => {
      if (l.status === 'running') return { agentId: l.agentId, agentType: l.definition.name, description: l.description, status: 'running' as const }
      l.observed = true
      return { status: l.status, outcome: l.outcome! }
    })
  }

  // ---- 用户的动作（HTTP）与 Goal ----

  /** GET /api/sessions/:id/agents：父 Session 的 agent_start / agent_end 与进程内状态；Session 不存在时 not-found。 */
  async list(sessionId: string): Promise<AgentSnapshot[]> {
    if (!(await this.#options.store.sessions.getSession(sessionId))) throw new AppError('not-found', `Session ${sessionId} not found`)
    const entries = await this.#options.store.sessions.listEntries(sessionId)
    const ends = new Map(entries.filter((e) => e.kind === 'agent_end').map((e) => [(e.payload as { agentId: string }).agentId, e]))
    return entries
      .filter((e) => e.kind === 'agent_start')
      .map((e) => {
        const start = e.payload as { agentId: string; agentType: string; description: string; background: boolean }
        const end = ends.get(start.agentId)
        const payload = end?.payload as { status: AgentEndStatus; usage: AgentUsageTotals; worktree?: AgentSnapshot['worktree'] } | undefined
        const live = this.#live.get(start.agentId)
        return {
          agentId: start.agentId,
          agentType: start.agentType,
          description: start.description,
          status: payload?.status ?? (live?.status === 'running' ? 'running' : 'interrupted'),
          background: start.background,
          startedAt: e.createdAt,
          ...(end ? { endedAt: end.createdAt } : {}),
          ...(payload ? { usage: payload.usage } : {}),
          ...(payload?.worktree ? { worktree: payload.worktree } : {}),
        }
      })
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

  /**
   * 启动恢复的第一步（Session 恢复之前）：被中断的父 Run 中没有结果的 agent 调用（前台与后台）先补 agent_end interrupted 与中断说明的结果，
   * 使 Session 恢复不把它当作结果不明的调用，也不给出 read 工具"没有副作用、可以重试"的文本（子代理可能已改动文件）。agent_start 之前
   * 崩溃、子 Session 已创建时，从子 Session 的 subagent_origin 补记 agent_start；子 Session 还没创建时结果说明子代理没有开始。
   */
  async prepareRecovery(source: RecoverySource): Promise<number> {
    let count = 0
    for (const { sessionId, runId } of await source.listUnfinishedRuns()) {
      const entries = await this.#options.store.sessions.listEntries(sessionId)
      const answered = new Set(
        entries
          .filter((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'toolResult')
          .map((e) => (e.payload as { toolCallId: string }).toolCallId),
      )
      const ended = new Set(entries.filter((e) => e.kind === 'agent_end').map((e) => (e.payload as { agentId: string }).agentId))
      const started = new Map(
        entries
          .filter((e) => e.kind === 'agent_start' && e.runId === runId)
          .map((e) => [(e.payload as AgentStartPayload).toolCallId, e.payload as AgentStartPayload]),
      )
      const calls = new Map<string, { background: boolean }>()
      for (const e of entries) {
        if (e.kind !== 'message' || e.runId !== runId) continue
        const m = e.payload as { role?: string; content?: unknown }
        if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
        for (const b of m.content as { type?: string; name?: string; id?: string; arguments?: { run_in_background?: unknown } }[])
          if (b.type === 'toolCall' && b.name === 'agent' && b.id) calls.set(b.id, { background: b.arguments?.run_in_background === true })
      }
      for (const toolCallId of new Set([...started.keys(), ...calls.keys()])) {
        let start = started.get(toolCallId)
        if (!start && answered.has(toolCallId)) continue
        const batch: RunEntry[] = []
        if (!start) {
          start = await this.#orphanStart(sessionId, runId, toolCallId, calls.get(toolCallId)?.background ?? false, entries)
          if (start) batch.push({ kind: 'agent_start', runId, payload: start })
        }
        if (start && !ended.has(start.agentId)) batch.push(await this.#interruptedEnd(start, runId))
        if (!answered.has(toolCallId))
          batch.push({
            kind: 'message',
            runId,
            payload: {
              role: 'toolResult',
              toolCallId,
              toolName: 'agent',
              content: [{ type: 'text', text: start ? agentInterruptedText(start.agentId) : AGENT_NOT_STARTED_TEXT }],
              isError: true,
              timestamp: Date.now(),
            },
          })
        for (const entry of batch) await this.#options.entries.commit(sessionId, entry)
        if (batch.length > 0) count++
        if (start) log.warn('subagent call interrupted', { sessionId, agentId: start.agentId, background: start.background })
      }
    }
    return count
  }

  /** agent_start 之前崩溃时的子 Session（subagent_origin 指向该调用）：按派发时的形状重建 agent_start；没有时 undefined。 */
  async #orphanStart(
    parentId: string,
    runId: string,
    toolCallId: string,
    background: boolean,
    parentEntries: readonly StoredEntry[],
  ): Promise<AgentStartPayload | undefined> {
    const { store } = this.#options
    for (const child of await store.sessions.listChildren(parentId)) {
      const origin = (await store.sessions.listEntries(child.id, { limit: 1 }))[0]
      const payload =
        origin?.kind === 'subagent_origin' ? (origin.payload as { parentRunId: string; toolCallId: string; definition: { name: string } }) : undefined
      if (!payload || payload.parentRunId !== runId || payload.toolCallId !== toolCallId) continue
      const goal = currentGoal(parentEntries)
      const goalId = goal && !isTerminalPhase(goal.phase) && goalRunIds(parentEntries, goal.id).has(runId) ? goal.id : undefined
      const worktree = child.worktreeId ? await store.worktrees.get(child.worktreeId) : undefined
      return {
        agentId: child.id,
        agentType: payload.definition.name,
        description: child.title,
        background,
        toolCallId,
        ...(goalId ? { goalId } : {}),
        ...(worktree ? { isolation: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch } } : {}),
      }
    }
    return undefined
  }

  /** 启动恢复（Session 恢复之后）：其余没有 agent_end 的子代理（后台）补记 interrupted；返回补记的数量。 */
  async recover(source: RecoverySource): Promise<number> {
    let count = 0
    for (const latest of await source.listLatestEntries('agent_start')) {
      const entries = await this.#options.store.sessions.listEntries(latest.sessionId)
      const ended = new Set(entries.filter((e) => e.kind === 'agent_end').map((e) => (e.payload as { agentId: string }).agentId))
      for (const start of entries.filter((e) => e.kind === 'agent_start')) {
        const payload = start.payload as AgentStartPayload
        if (!ended.has(payload.agentId)) {
          await this.#options.entries.commit(latest.sessionId, await this.#interruptedEnd(payload))
          log.warn('subagent marked interrupted', { sessionId: latest.sessionId, agentId: payload.agentId })
          count++
        }
        // 仍在的 isolation worktree：父 Session 读取它照样须审批。
        if (payload.isolation && (await this.#options.store.worktrees.get(payload.isolation.worktreeId))?.status === 'active')
          this.#isolate(latest.sessionId, payload.isolation.path, true)
      }
    }
    return count
  }

  /** 被中断的子代理的 agent_end：用量取到子 Session 最后一条；isolation worktree 没有改动时回收（与正常结束同一规则），有改动时保留并注明。 */
  async #interruptedEnd(start: AgentStartPayload, runId?: string): Promise<RunEntry> {
    const { agentId } = start
    const entries = await this.#options.store.sessions.listEntries(agentId)
    const usage = childUsage(entries, entries.at(-1)?.createdAt ?? Date.now())
    let worktree: AgentOutcome['worktree']
    if (start.isolation && this.#worktrees) {
      const removed = await this.#worktrees.removeIfUnchanged(start.isolation.worktreeId).catch((error: unknown) => {
        log.warn('subagent worktree cleanup failed', { agentId, error: errorMessage(error) })
        return undefined
      })
      if (removed && !removed.removed) worktree = { kept: true, path: removed.path, branch: removed.branch }
    }
    return {
      kind: 'agent_end',
      ...(runId ? { runId } : {}),
      payload: { agentId, status: 'interrupted', usage, resultChars: lastAssistantText(entries).length, ...(worktree ? { worktree } : {}) },
    }
  }

  async close(): Promise<void> {
    this.#closing = true
  }
}

// Agent Teams（ADR 0018，docs/subsystems/teams.md）的应用服务：名册（由根 Session 的 agent_start v2 / agent_end 派生）、任务板（team_task 条目，
// 同一根 Session 的变更经 KeyedMutex 串行、compare-and-set）、TaskCreated / TaskCompleted Hook、团队消息的路由（送达与排队在 SubagentService）
// 与 team_update 进度。
import {
  memberStatus,
  planTaskCreate,
  planTaskUpdate,
  subagentReachable,
  taskViews,
  TEAM_BROADCAST,
  TEAM_LEAD,
  TEAM_MESSAGE_MAX,
  teamMessageText,
  TeamMessageError,
  teamRoster,
  teamSectionText,
  TeamTaskError,
  teamTasks,
  writeScopeWarnings,
  type RosterMember,
  type RunEntry,
  type TeamPort,
  type TeamSent,
  type TeamTaskPayload,
} from '@coko/agent'
import { getLogger, redactSecretValues } from '@coko/logging'
import type { TeamMember, TeamSnapshot } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import { randomUUID } from 'node:crypto'
import type { SessionEntryAccess } from './context/types.ts'
import type { HookScope, HookService } from './hooks.ts'
import type { SessionHub } from './hub.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import { requireSession } from './session-runtimes.ts'
import { childUsage } from './subagent-recovery.ts'
import type { SubagentService } from './subagents.ts'

const log = getLogger(['application', 'teams'])

/** 团队需要的 Session 能力（runtime/layers.ts 以 SessionService 实现，创建后 bind）。 */
export interface TeamSessionHost {
  activeRunId(sessionId: string): string | undefined
  /** Hook 的作用域（发起者的 Session）。 */
  scope(sessionId: string): Promise<HookScope>
}

export interface TeamServiceOptions {
  store: Pick<SessionStore, 'sessions'>
  hub?: SessionHub
  entries?: SessionEntryAccess
  hooks?: HookService
  subagents?: SubagentService
}

/** 发起者：lead（根 Session）或 teammate。 */
interface Actor {
  name: string
  sessionId: string
  rootId: string
}

export class TeamService {
  readonly #options: TeamServiceOptions
  readonly #locks = new KeyedMutex()
  #host: TeamSessionHost | undefined

  constructor(options: TeamServiceOptions) {
    this.#options = options
  }

  bind(host: TeamSessionHost): void {
    this.#host = host
  }

  get #entries(): SessionEntryAccess {
    if (!this.#options.entries) throw new Error('TeamService has no entry access')
    return this.#options.entries
  }

  /** Session 的根（子 Session 的 parentSessionId）。 */
  async #root(sessionId: string): Promise<string> {
    const session = await requireSession(this.#options.store as SessionStore, sessionId)
    return session.parentSessionId ?? session.id
  }

  // ---- 读取 ----

  /** GET /api/sessions/:id/team：Session 不存在时 404；子 Session id 时为其根的快照。 */
  async snapshot(sessionId: string): Promise<TeamSnapshot> {
    return this.#snapshotOf(await this.#root(sessionId))
  }

  async #snapshotOf(rootId: string): Promise<TeamSnapshot> {
    const entries = await this.#options.store.sessions.listEntries(rootId)
    const tasks = teamTasks(entries)
    const members = await Promise.all(teamRoster(entries).map((m) => this.#memberView(m)))
    return { members, tasks: taskViews(tasks), warnings: writeScopeWarnings(tasks) }
  }

  #status(member: RosterMember) {
    const live = this.#options.subagents?.liveInfo(member.agentId)
    return live?.dismissed ? 'dismissed' : memberStatus(member, live?.running === true)
  }

  async #memberView(member: RosterMember): Promise<TeamMember> {
    const status = this.#status(member)
    const live = this.#options.subagents?.liveInfo(member.agentId)
    const usage = childUsage(await this.#options.store.sessions.listEntries(member.agentId))
    const ended = member.lastEnd?.worktree
    const isolation = member.start.isolation
    const worktree = ended ?? (isolation && status !== 'dismissed' ? { kept: true, path: isolation.path, branch: isolation.branch } : undefined)
    return {
      agentId: member.agentId,
      name: member.name,
      status,
      ...(status === 'running' && live?.activity ? { activity: live.activity } : {}),
      usage,
      ...(worktree ? { worktree } : {}),
    }
  }

  /** 名册或任务板变化：根 Session 推送 team_update（不属于 Run）。 */
  changed(rootId: string): void {
    const hub = this.#options.hub
    if (!hub) return
    void this.#snapshotOf(rootId)
      .then((team) => hub.publishProgress(rootId, this.#host?.activeRunId(rootId) ?? '', { type: 'team_update', team }))
      .catch((error: unknown) => log.warn('team update failed', { sessionId: rootId, error: String(error) }))
  }

  /** teammate 子 Session 的 <team> section；不是 teammate 时 undefined。 */
  async section(sessionId: string): Promise<{ name: string; text: string } | undefined> {
    const me = this.#options.subagents?.teammateOf(sessionId)
    if (!me) return undefined
    const entries = await this.#options.store.sessions.listEntries(me.rootId)
    const members = teamRoster(entries)
      .filter((m) => m.name !== me.name)
      .map((m) => ({ name: m.name, status: this.#status(m) }))
      .filter((m) => m.status !== 'dismissed')
    return { name: 'teams', text: teamSectionText({ name: me.name, members, tasks: taskViews(teamTasks(entries)) }) }
  }

  // ---- 模型的工具（context/teams.ts） ----

  /** 本 Session 的团队端口：根 Session 为 lead，teammate 子 Session 为其名字；其他子 Session 没有。 */
  port(sessionId: string, rootId: string): TeamPort {
    const teammate = this.#options.subagents?.teammateOf(sessionId)
    const actor: Actor = teammate ? { name: teammate.name, sessionId, rootId: teammate.rootId } : { name: TEAM_LEAD, sessionId, rootId }
    return {
      send: (request) => this.#send(actor, request),
      createTask: (request) => this.#createTask(actor, request),
      updateTask: (request) => this.#updateTask(actor, request),
      listTasks: async () => {
        const tasks = teamTasks(await this.#options.store.sessions.listEntries(actor.rootId))
        return { tasks: taskViews(tasks), warnings: writeScopeWarnings(tasks) }
      },
    }
  }

  // ---- 消息 ----

  async #send(actor: Actor, request: { to: string; message: string; summary?: string }): Promise<TeamSent> {
    const subagents = this.#options.subagents
    if (!subagents) throw new TeamMessageError('agent-not-reachable', 'Agent teams are not available')
    if (request.message.length === 0 || request.message.length > TEAM_MESSAGE_MAX)
      throw new TeamMessageError('invalid-argument', `The message must be 1-${TEAM_MESSAGE_MAX} characters`)
    if (request.to === actor.name || request.to === actor.sessionId) throw new TeamMessageError('invalid-argument', 'You cannot send a message to yourself')
    const entries = await this.#options.store.sessions.listEntries(actor.rootId)
    const roster = teamRoster(entries)
    const reachable = (m: RosterMember) => this.#status(m) !== 'dismissed'
    // 目标：lead（根 Session）或子 Session（teammate 与已结束的一次性子代理）。
    type Target = { label: string; agentId?: string }
    let targets: Target[]
    if (request.to === TEAM_BROADCAST) {
      targets = roster.filter((m) => reachable(m) && m.name !== actor.name).map((m) => ({ label: m.name, agentId: m.agentId }))
      if (actor.name !== TEAM_LEAD) targets.unshift({ label: TEAM_LEAD })
    } else if (request.to === TEAM_LEAD) {
      targets = [{ label: TEAM_LEAD }]
    } else {
      const member = roster.findLast((m) => m.name === request.to) ?? roster.find((m) => m.agentId === request.to)
      if (member) {
        if (!reachable(member)) throw new TeamMessageError('agent-not-reachable', `Teammate ${member.name} was dismissed`)
        targets = [{ label: request.to, agentId: member.agentId }]
      } else {
        targets = [{ label: request.to, agentId: this.#subagentTarget(entries, request.to, actor) }]
      }
    }
    const messageId = randomUUID()
    const body = redactSecretValues(request.message)
    const summary = request.summary === undefined ? undefined : redactSecretValues(request.summary)
    // 触发 Run：lead 为根 Session 当前的 Run，teammate 沿用自己当前 Run 的触发 Run（Goal 预算按它归属）。
    const triggerRunId = actor.name === TEAM_LEAD ? this.#host?.activeRunId(actor.rootId) : subagents.teammateOf(actor.sessionId)?.triggerRunId
    const text = teamMessageText({ from: actor.name, messageId, body })
    for (const target of targets) {
      const before: RunEntry[] = [{ kind: 'team_message', payload: { messageId, from: actor.name, to: target.label, ...(summary ? { summary } : {}) } }]
      if (target.agentId === undefined) subagents.leadNote(actor.rootId, text, before)
      else await subagents.deliverMessage(actor.rootId, { agentId: target.agentId, text, before, ...(triggerRunId ? { triggerRunId } : {}) })
    }
    log.info('team message sent', { sessionId: actor.rootId, from: actor.name, recipients: targets.length })
    return { messageId, recipients: targets.map((t) => t.label) }
  }

  /** agentId 指向的一次性子代理：completed / max-turns / failed（或仍在运行）可达，cancelled / interrupted / dismissed 不可达。 */
  #subagentTarget(entries: readonly StoredEntry[], agentId: string, actor: Actor): string {
    const started = entries.some((e) => e.kind === 'agent_start' && (e.payload as { agentId?: string }).agentId === agentId)
    if (!started) throw new TeamMessageError('invalid-argument', `No teammate or subagent ${agentId} in this team`)
    if (actor.name !== TEAM_LEAD) throw new TeamMessageError('agent-not-reachable', 'Only the lead can continue a subagent')
    const live = this.#options.subagents?.liveInfo(agentId)
    if (live?.running) return agentId
    const last = entries.findLast((e) => e.kind === 'agent_end' && (e.payload as { agentId?: string }).agentId === agentId)
    const status = (last?.payload as { status?: Parameters<typeof subagentReachable>[0] } | undefined)?.status
    if (!status || !subagentReachable(status))
      throw new TeamMessageError('agent-not-reachable', `Subagent ${agentId} is ${status ?? 'interrupted'} and cannot continue`)
    return agentId
  }

  // ---- 任务板 ----

  #members(entries: readonly StoredEntry[]): Set<string> {
    return new Set([
      TEAM_LEAD,
      ...teamRoster(entries)
        .filter((m) => this.#status(m) !== 'dismissed')
        .map((m) => m.name),
    ])
  }

  async #hook(actor: Actor, event: 'TaskCreated' | 'TaskCompleted', task: TeamTaskPayload): Promise<void> {
    const hooks = this.#options.hooks
    if (!hooks || !this.#host) return
    const verdict = await hooks.taskEvent(
      await this.#host.scope(actor.sessionId),
      event,
      { taskId: task.taskId, subject: task.subject, description: task.description, teammateName: actor.name, teamName: actor.rootId },
      this.#host.activeRunId(actor.sessionId),
    )
    if (verdict) throw new Error(`${event} hook blocked: ${verdict.block}`)
  }

  async #commit(actor: Actor, task: TeamTaskPayload): Promise<TeamTaskPayload> {
    const runId = this.#host?.activeRunId(actor.rootId)
    const committed = await this.#entries.commit(actor.rootId, { kind: 'team_task', ...(runId ? { runId } : {}), payload: task })
    this.changed(actor.rootId)
    return committed.payload as TeamTaskPayload
  }

  #createTask(actor: Actor, request: { subject: string; description?: string; blockedBy?: string[]; writeScopes?: string[] }): Promise<TeamTaskPayload> {
    return this.#locks.run(actor.rootId, async () => {
      const tasks = teamTasks(await this.#options.store.sessions.listEntries(actor.rootId))
      const task = planTaskCreate(
        tasks,
        { ...request, subject: redactSecretValues(request.subject), description: redactSecretValues(request.description ?? '') },
        { name: actor.name },
      )
      // TaskCreated 在提交之前：阻止时不提交条目。
      await this.#hook(actor, 'TaskCreated', task)
      log.info('team task created', { sessionId: actor.rootId, taskId: task.taskId, by: actor.name })
      return this.#commit(actor, task)
    })
  }

  #updateTask(actor: Actor, request: Parameters<TeamPort['updateTask']>[0]): Promise<TeamTaskPayload> {
    return this.#locks.run(actor.rootId, async () => {
      const entries = await this.#options.store.sessions.listEntries(actor.rootId)
      const tasks = teamTasks(entries)
      const task = planTaskUpdate(
        tasks,
        {
          ...request,
          ...(request.subject !== undefined ? { subject: redactSecretValues(request.subject) } : {}),
          ...(request.description !== undefined ? { description: redactSecretValues(request.description) } : {}),
        },
        { name: actor.name },
        { members: this.#members(entries) },
      )
      // TaskCompleted 在变为 completed 之前：阻止时任务保持原状态。
      if (task.status === 'completed' && tasks.get(task.taskId)?.status !== 'completed') await this.#hook(actor, 'TaskCompleted', task)
      log.info('team task updated', { sessionId: actor.rootId, taskId: task.taskId, status: task.status, by: actor.name })
      return this.#commit(actor, task)
    })
  }
}

export { TeamTaskError }

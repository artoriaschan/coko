// 子代理（ADR 0014，docs/subsystems/subagents.md）的进度与通知：父 Session 的 agent_update 进度、后台子代理等待审批与结束的桌面通知、
// 后台子代理结束的通知（父 Session 有 Run 时作为追加指令送达，否则挂起到下一个 Run 的 user message 开头，都前置 agent_notification），
// 以及 agent_wait 的等待与追加指令的唤醒。进程内的子代理状态由 SubagentService 持有，本模块只投递。
import {
  agentNotificationText,
  type AgentDefinition,
  type AgentEndStatus,
  type AgentOutcome,
  type AgentWaitItem,
  type RunEntry,
  type RunInput,
} from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import { AGENT_ACTIVITY_SUMMARY_MAX } from '@coko/protocol'
import type { PendingInput, RunEndInfo } from './context/types.ts'
import type { SessionHub } from './hub.ts'
import type { NotificationService } from './notifications.ts'

const log = getLogger(['application', 'subagents'])

/** 一个本进程内派发的子代理。 */
export interface LiveSubagent {
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
  /** isolation worktree 的路径（父 Session 的询问规则按它登记与移除）。 */
  worktreePath?: string
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
  /** 子 Session 条目的订阅（结束时取消）。 */
  unsubscribe?: () => void
  /** teammate 的名字（ADR 0018）；一次性子代理没有。 */
  name?: string
  /** 当前 Run 的触发 Run（根 Session 的 runId；Goal 预算按它归属）。 */
  triggerRunId?: string
  /** 最近一次工具调用（团队名册的 activity）。 */
  activity?: { toolName: string; summary: string }
}

/** 新派发的子代理：running，前台的结果由调用方读到（observed），后台的等结束通知。 */
export function newLiveSubagent(
  fields: Omit<LiveSubagent, 'status' | 'ended' | 'resolve' | 'observed' | 'waiters' | 'outcome' | 'runId' | 'unsubscribe' | 'activity'>,
): LiveSubagent {
  let resolve!: (outcome: AgentOutcome) => void
  const ended = new Promise<AgentOutcome>((r) => (resolve = r))
  return { ...fields, status: 'running', ended, resolve, observed: !fields.background, waiters: 0 }
}

/** 继续对话（send_message，ADR 0018）：同一个子代理开始新的 Run——回到 running、新的 ended，结束时照常通知父级（后台语义）。 */
export function rearmLiveSubagent(live: LiveSubagent, triggerRunId: string | undefined): void {
  let resolve!: (outcome: AgentOutcome) => void
  live.ended = new Promise<AgentOutcome>((r) => (resolve = r))
  live.resolve = resolve
  live.status = 'running'
  live.background = true
  live.observed = false
  delete live.outcome
  delete live.runId
  delete live.activity
  if (triggerRunId) live.triggerRunId = triggerRunId
  else delete live.triggerRunId
}

/** 宿主送给父 Session 的一条通知（团队消息）：文本与紧接在 user message 之前的条目。 */
interface HostNote {
  text: string
  before: RunEntry[]
}

/** 工具调用的一行摘要（已脱敏、≤ 120 字符）。 */
function activitySummary(args: unknown): string {
  const raw = typeof args === 'object' && args !== null ? JSON.stringify(args) : String(args ?? '')
  const text = redactText(raw).replace(/\s+/g, ' ')
  return text.length > AGENT_ACTIVITY_SUMMARY_MAX ? text.slice(0, AGENT_ACTIVITY_SUMMARY_MAX - 1) + '…' : text
}

export interface SubagentNotificationsOptions {
  hub: SessionHub
  notifications?: NotificationService
  /** 父 Session 此刻的 Run（进度归属）。 */
  activeRunId(sessionId: string): string | undefined
  /** 父 Session 有 Run 时作为追加指令送达；没有时 false。 */
  deliver(sessionId: string, input: RunInput): boolean
  /** 进程内的子代理（按 agentId）。 */
  live(agentId: string): LiveSubagent | undefined
}

export class SubagentNotifications {
  readonly #options: SubagentNotificationsOptions
  /** 每个父 Session 待送达的通知（Session 空闲时结束的后台子代理；teammate 每个 Run 一条，按结束时的 outcome）。 */
  readonly #pending = new Map<string, { agentId: string; outcome: AgentOutcome }[]>()
  /** 每个父 Session 待送达的宿主通知（团队消息，lead 空闲时挂起到下一个 Run）。 */
  readonly #notes = new Map<string, HostNote[]>()
  /** 作为追加指令送出的通知（Run 结束时没有送达的挂起）。 */
  readonly #sent = new Map<string, { text: string; agents?: { agentId: string; outcome: AgentOutcome }[]; note?: HostNote }[]>()
  /** agent_wait 的唤醒（追加指令到达）。 */
  readonly #interrupts = new Map<string, AbortController>()
  #closing = false

  constructor(options: SubagentNotificationsOptions) {
    this.#options = options
  }

  /** 关闭中：不再发桌面通知与结束通知。 */
  close(): void {
    this.#closing = true
  }

  /** 子 Session 的条目：工具调用 → agent_update 进度（父 Session）；后台子代理的审批请求 → approval-waiting 通知。 */
  watch(live: LiveSubagent): void {
    this.progress(live)
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
      if (!call?.name) return
      live.activity = { toolName: call.name, summary: activitySummary(call.arguments) }
      this.progress(live, live.activity)
    })
  }

  progress(live: LiveSubagent, activity?: { toolName: string; summary: string }): void {
    const runId = this.#options.activeRunId(live.rootId) ?? ''
    this.#options.hub.publishProgress(live.rootId, runId, {
      type: 'agent_update',
      agentId: live.agentId,
      status: live.status,
      ...(activity ? { activity } : {}),
    })
  }

  /** 子代理结束之后（outcome 已定）：后台子代理的 agent-finished 桌面通知；模型还没读到终态时送达或挂起结束通知。 */
  ended(live: LiveSubagent): void {
    if (!live.background || this.#closing) return
    void this.#options.notifications
      ?.notify({ kind: 'agent-finished', sessionId: live.rootId, title: `Subagent ${live.status}`, body: `${live.definition.name}: ${live.description}` })
      .catch(() => undefined)
    if (!live.observed) this.#deliver(live)
  }

  /** 后台子代理结束的通知：父 Session 有 Run 时作为追加指令送达（前置 agent_notification），否则挂起到下一个 Run。 */
  #deliver(live: LiveSubagent): void {
    const { text } = agentNotificationText(live.outcome!)
    const delivered = this.#options.deliver(live.rootId, {
      text,
      content: [{ type: 'text', text }],
      before: [{ kind: 'agent_notification', payload: { agentIds: [live.agentId] } }],
    })
    const item = { agentId: live.agentId, outcome: live.outcome! }
    if (delivered) {
      live.observed = true
      this.#sent.set(live.rootId, [...(this.#sent.get(live.rootId) ?? []), { text, agents: [item] }])
    } else this.#pending.set(live.rootId, [...(this.#pending.get(live.rootId) ?? []), item])
    log.info(delivered ? 'subagent notification sent' : 'subagent notification pending', { sessionId: live.rootId, agentId: live.agentId })
  }

  /** 父 Session 的 Run 结束：作为追加指令送出、但没有送达的通知挂起到下一个 Run。 */
  parentRunEnded(info: RunEndInfo): void {
    const sent = this.#sent.get(info.sessionId)
    if (!sent) return
    this.#sent.delete(info.sessionId)
    const undelivered = new Set(info.result.undeliveredSteering ?? [])
    for (const item of sent) {
      if (!undelivered.has(item.text)) continue
      if (item.agents) this.#pending.set(info.sessionId, [...(this.#pending.get(info.sessionId) ?? []), ...item.agents])
      if (item.note) this.#notes.set(info.sessionId, [...(this.#notes.get(info.sessionId) ?? []), item.note])
    }
  }

  /**
   * 宿主通知送给父 Session（团队消息给 lead，ADR 0018）：有 Run 时作为追加指令送达（前置 before 条目），没有时挂起到下一个 Run 的 user message
   * 开头（与后台子代理通知相同：lead 空闲时不唤醒）。
   */
  hostNote(rootId: string, note: HostNote): boolean {
    const delivered = this.#options.deliver(rootId, { text: note.text, content: [{ type: 'text', text: note.text }], before: note.before })
    if (delivered) this.#sent.set(rootId, [...(this.#sent.get(rootId) ?? []), { text: note.text, note }])
    else this.#notes.set(rootId, [...(this.#notes.get(rootId) ?? []), note])
    return delivered
  }

  /** 父 Session 空闲时结束的后台子代理的通知：合并到下一个 Run 的 user message 开头，前置 agent_notification。 */
  pendingInput(sessionId: string): PendingInput | undefined {
    // 模型已经读到的（agent_wait）不再通知：outcome 仍是当时的且已 observed。
    const items = (this.#pending.get(sessionId) ?? []).filter((item) => {
      const live = this.#options.live(item.agentId)
      return !(live?.observed && live.outcome === item.outcome)
    })
    const notes = this.#notes.get(sessionId) ?? []
    if (items.length === 0 && notes.length === 0) {
      this.#pending.delete(sessionId)
      return undefined
    }
    const texts = [...items.map((item) => agentNotificationText(item.outcome).text), ...notes.map((n) => n.text)]
    return {
      content: texts.map((text) => ({ type: 'text' as const, text: text + '\n\n' })),
      before: [
        ...(items.length > 0 ? [{ kind: 'agent_notification' as const, payload: { agentIds: [...new Set(items.map((i) => i.agentId))] } }] : []),
        ...notes.flatMap((n) => n.before),
      ],
      delivered: () => {
        const left = (this.#pending.get(sessionId) ?? []).filter((item) => !items.includes(item))
        if (left.length > 0) this.#pending.set(sessionId, left)
        else this.#pending.delete(sessionId)
        const leftNotes = (this.#notes.get(sessionId) ?? []).filter((n) => !notes.includes(n))
        if (leftNotes.length > 0) this.#notes.set(sessionId, leftNotes)
        else this.#notes.delete(sessionId)
        for (const item of items) {
          const live = this.#options.live(item.agentId)
          if (live?.outcome === item.outcome) live.observed = true
        }
      },
    }
  }

  /** 追加指令到达：唤醒该 Session 进行中的 agent_wait。 */
  steered(sessionId: string): void {
    this.#interrupts.get(sessionId)?.abort()
    this.#interrupts.delete(sessionId)
  }

  /** agent_wait：等到目标都结束、超时、追加指令到达或父 Run 停止；mine 为该 Session 的子代理。 */
  async wait(
    sessionId: string,
    mine: readonly LiveSubagent[],
    ids: readonly string[] | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentWaitItem[]> {
    const targets = ids ? ids.map((id) => mine.find((l) => l.agentId === id) ?? id) : mine.filter((l) => l.status === 'running')
    const unknown = targets.filter((t): t is string => typeof t === 'string')
    if (unknown.length > 0) throw new Error(`No subagent ${unknown.join(', ')} in this session`)
    const lives = targets as LiveSubagent[]
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
}

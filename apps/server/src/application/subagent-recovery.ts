// 子代理（ADR 0014，docs/subsystems/subagents.md）的条目记录与启动恢复：派发时的 subagent_origin / agent_start、结束时的 agent_end（子 Session 的
// 用量与交回文本、isolation worktree 的回收或保留）、父 Session 的子代理快照，
// 被中断的父 Run 中没有结果的 agent 调用（补 agent_end interrupted 与中断说明的结果；agent_start 之前崩溃时从 subagent_origin 补记），
// 以及 Session 恢复之后其余未结束的子代理（后台）补记 interrupted、仍在的 isolation worktree 重新登记询问规则。
import {
  AGENT_NOT_STARTED_TEXT,
  agentEnds,
  agentInterruptedText,
  agentStarts,
  currentGoal,
  goalRunIds,
  isTerminalPhase,
  type AgentEndStatus,
  type AgentOutcome,
  type AgentStartPayload,
  type AgentUsageTotals,
  type RunEntry,
  type PermissionRule,
  type RunResult,
  type SubagentOriginPayload,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { AgentSnapshot } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import type { SessionEntryAccess } from './context/types.ts'
import { errorMessage } from './errors.ts'
import type { RecoverySource } from './recovery.ts'
import type { LiveSubagent } from './subagent-notifications.ts'
import type { WorktreeService } from './worktrees.ts'

const log = getLogger(['application', 'subagents'])

export const ZERO_USAGE: AgentUsageTotals = { turns: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 }
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** 子 Session 的用量：assistant 消息数为轮次，toolResult 数为工具调用，usage 之和，各 Run 的时长之和。 */
export function childUsage(entries: readonly StoredEntry[], now = Date.now()): AgentUsageTotals {
  const totals = { ...ZERO_USAGE }
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
export function lastAssistantText(entries: readonly StoredEntry[]): string {
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

/** 父 Session 的子代理快照（agent_start / agent_end）：没有 agent_end 且不在进程内运行的为 interrupted。 */
export function agentSnapshots(entries: readonly StoredEntry[], running: (agentId: string) => boolean): AgentSnapshot[] {
  const ends = new Map(agentEnds(entries).map((e) => [e.payload.agentId, e]))
  return agentStarts(entries).map((e) => {
    const start = e.payload
    const end = ends.get(start.agentId)
    const payload = end?.payload
    return {
      agentId: start.agentId,
      agentType: start.agentType,
      description: start.description,
      // 继续对话中的子代理（teammate 或 send_message 继续的）已有上一个 Run 的 agent_end：进程内运行时为 running。
      status: running(start.agentId) ? 'running' : (payload?.status ?? 'interrupted'),
      background: start.background,
      startedAt: e.createdAt,
      ...(end ? { endedAt: end.createdAt } : {}),
      ...(payload ? { usage: payload.usage } : {}),
      ...(payload?.worktree ? { worktree: payload.worktree } : {}),
    }
  })
}

export /** Run 的结果 → agent_end 的状态（状态只来自运行时，不读子代理的文本）。 */
function endStatus(result: RunResult | undefined): AgentEndStatus {
  if (!result) return 'failed'
  if (result.status === 'completed') return 'completed'
  if (result.error?.code === 'max_turns') return 'max-turns'
  if (result.status === 'aborted' || (result.status === 'paused' && !result.error)) return 'cancelled'
  return 'failed'
}

export interface SubagentRecoveryOptions {
  store: SessionStore
  entries: SessionEntryAccess
  /** 绑定之后才有（WorktreeService 晚于 SubagentService 创建）。 */
  worktrees(): Pick<WorktreeService, 'removeIfUnchanged'> | undefined
}

export class SubagentRecovery {
  readonly #options: SubagentRecoveryOptions
  readonly #retainedRoots = new Map<string, number>()
  readonly #retainedProjects = new Set<string>()

  retainProject(projectId: string): () => void {
    this.#retainedProjects.add(projectId)
    return () => this.#retainedProjects.delete(projectId)
  }

  /** Project removal stops execution without reclaiming bound isolated directories. */
  async retainWorktrees<T>(ids: string[], task: () => Promise<T>): Promise<T> {
    for (const id of ids) this.#retainedRoots.set(id, (this.#retainedRoots.get(id) ?? 0) + 1)
    try {
      return await task()
    } finally {
      for (const id of ids) {
        const count = this.#retainedRoots.get(id)! - 1
        if (count) this.#retainedRoots.set(id, count)
        else this.#retainedRoots.delete(id)
      }
    }
  }
  /** 每个根 Session 的子代理 isolation worktree（派发时与启动恢复时登记；已移除的去掉）。 */
  forgetSessions(ids: string[]): void {
    for (const id of ids) this.#isolated.delete(id)
  }

  readonly #isolated = new Map<string, Set<string>>()

  constructor(options: SubagentRecoveryOptions) {
    this.#options = options
  }

  /**
   * 父 Session 对子代理 isolation worktree 的询问规则（不入库，worktree 移除时去掉）：读取（Read）与写入、编辑（Edit 规则组同时覆盖
   * write 与 edit）都询问，任何模式下都不免审批。bash 的命令不受这些规则保护（docs/subsystems/subagents.md）。
   */
  extraRules(sessionId: string): PermissionRule[] {
    return [...(this.#isolated.get(sessionId) ?? [])].flatMap((path) => [
      { behavior: 'ask' as const, tool: 'Read', content: path },
      { behavior: 'ask' as const, tool: 'Edit', content: path },
    ])
  }

  isolate(rootId: string, path: string, on: boolean): void {
    const set = this.#isolated.get(rootId) ?? new Set<string>()
    if (on) set.add(path)
    else set.delete(path)
    if (set.size > 0) this.#isolated.set(rootId, set)
    else this.#isolated.delete(rootId)
  }

  /** 派发：子 Session 的首条 subagent_origin（来源与定义），父级的 agent_start（与派发它的调用同一 Run）。 */
  async started(live: LiveSubagent, worktree: { id: string; path: string; branch: string } | undefined): Promise<void> {
    const { definition } = live
    await this.#options.entries.commit(live.agentId, {
      kind: 'subagent_origin',
      payload: {
        parentSessionId: live.rootId,
        parentRunId: live.parentRunId,
        toolCallId: live.toolCallId,
        definition: {
          name: definition.name,
          source: definition.source,
          tools: live.tools,
          ...(definition.model ? { model: definition.model } : {}),
          ...(definition.permissionMode ? { permissionMode: definition.permissionMode } : {}),
          maxTurns: definition.maxTurns,
        },
      },
    })
    await this.#options.entries.commit(live.rootId, {
      kind: 'agent_start',
      runId: live.parentRunId,
      payload: {
        agentId: live.agentId,
        agentType: definition.name,
        description: live.description,
        background: live.background,
        toolCallId: live.toolCallId,
        ...(live.goalId ? { goalId: live.goalId } : {}),
        ...(live.name ? { name: live.name, teammate: true } : {}),
        ...(live.triggerRunId ? { triggerRunId: live.triggerRunId } : {}),
        ...(worktree ? { isolation: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch } } : {}),
      },
    })
  }

  /**
   * 子 Run 结束（或没能开始）：用量与交回文本、isolation worktree 的回收（移除时去掉父 Session 的询问规则）或保留、父级 agent_end（runId 在提交时
   * 取）。提交失败只记 error，仍返回结果（前台调用与等待者照常结束）。
   */
  async end(live: LiveSubagent, status: AgentEndStatus, runId: () => string | undefined): Promise<AgentOutcome> {
    const outcome: AgentOutcome = { agentId: live.agentId, agentType: live.definition.name, description: live.description, status, usage: ZERO_USAGE, text: '' }
    try {
      const entries = await this.#options.store.sessions.listEntries(live.agentId)
      const text = lastAssistantText(entries)
      let worktree: AgentOutcome['worktree']
      // teammate 的 worktree 保留到解散（它还会收到消息，ADR 0018）；一次性子代理在第一次结束时回收。
      const root = this.#retainedProjects.size ? await this.#options.store.sessions.getSession(live.rootId) : undefined
      const retained =
        this.#retainedRoots.has(live.rootId) || (root?.projectId !== null && root?.projectId !== undefined && this.#retainedProjects.has(root.projectId))
      if (live.worktreeId && !retained && (!live.name || status === 'dismissed')) {
        const released = await this.#releaseWorktree(live.agentId, live.worktreeId)
        if (released.removed) {
          if (live.worktreePath) this.isolate(live.rootId, live.worktreePath, false)
          delete live.worktreeId
        } else worktree = released.worktree
      }
      const ended = { ...outcome, usage: childUsage(entries), text, ...(worktree ? { worktree } : {}) }
      const run = runId()
      await this.#options.entries.commit(live.rootId, {
        kind: 'agent_end',
        ...(run ? { runId: run } : {}),
        payload: { agentId: live.agentId, status, usage: ended.usage, resultChars: text.length, ...(worktree ? { worktree } : {}) },
      })
      return ended
    } catch (error) {
      log.error('subagent end failed', { agentId: live.agentId, error: errorMessage(error) })
      return outcome
    }
  }

  /**
   * 解散 teammate（不在进程内运行时，例如重启之后）：用量取子 Session 全部条目，isolation worktree 没有改动时回收、有改动时保留并注明，
   * 父级 agent_end { status: dismissed }。
   */
  async dismissed(rootId: string, start: AgentStartPayload, runId: string | undefined): Promise<AgentOutcome> {
    const entries = await this.#options.store.sessions.listEntries(start.agentId)
    const text = lastAssistantText(entries)
    let worktree: AgentOutcome['worktree']
    if (start.isolation) {
      const released = await this.#releaseWorktree(start.agentId, start.isolation.worktreeId)
      if (released.removed) this.isolate(rootId, start.isolation.path, false)
      else worktree = released.worktree
    }
    const usage = childUsage(entries)
    await this.#options.entries.commit(rootId, {
      kind: 'agent_end',
      ...(runId ? { runId } : {}),
      payload: { agentId: start.agentId, status: 'dismissed', usage, resultChars: text.length, ...(worktree ? { worktree } : {}) },
    })
    return {
      agentId: start.agentId,
      agentType: start.agentType,
      description: start.description,
      status: 'dismissed',
      usage,
      text,
      ...(worktree ? { worktree } : {}),
    }
  }

  /** 派发没有完成：isolation worktree 没有改动时回收，询问规则随之去掉。 */
  async abandon(rootId: string, worktree: { id: string; path: string }): Promise<void> {
    const removed = await this.#options
      .worktrees()
      ?.removeIfUnchanged(worktree.id)
      .catch(() => undefined)
    if (removed?.removed) this.isolate(rootId, worktree.path, false)
  }

  /**
   * 结束时的 isolation worktree：没有改动时移除（removed），有改动时保留（kept，结果与 agent_end 注明路径与分支）；清理失败只记 warn、
   * 按保留处理但不注明。
   */
  async #releaseWorktree(agentId: string, worktreeId: string): Promise<{ removed: true } | { removed: false; worktree?: AgentOutcome['worktree'] }> {
    const worktrees = this.#options.worktrees()
    if (!worktrees) return { removed: false }
    const removed = await worktrees.removeIfUnchanged(worktreeId).catch((error: unknown) => {
      log.warn('subagent worktree cleanup failed', { agentId, error: errorMessage(error) })
      return undefined
    })
    if (removed?.removed) return { removed: true }
    return removed ? { removed: false, worktree: { kept: true, path: removed.path, branch: removed.branch } } : { removed: false }
  }

  /**
   * 启动恢复的第一步（Session 恢复之前）：被中断的父 Run 中没有结果的 agent 调用（前台与后台）先补 agent_end interrupted 与中断说明的结果，
   * 使 Session 恢复不把它当作结果不明的调用，也不给出 read 工具"没有副作用、可以重试"的文本（子代理可能已改动文件）。agent_start 之前
   * 崩溃、子 Session 已创建时，从子 Session 的 subagent_origin 补记 agent_start；子 Session 还没创建时结果说明子代理没有开始。
   */
  async prepare(source: RecoverySource): Promise<number> {
    let count = 0
    for (const { sessionId, runId } of await source.listUnfinishedRuns()) {
      const entries = await this.#options.store.sessions.listEntries(sessionId)
      const answered = new Set(
        entries
          .filter((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'toolResult')
          .map((e) => (e.payload as { toolCallId: string }).toolCallId),
      )
      const ended = new Set(agentEnds(entries).map((e) => e.payload.agentId))
      const started = new Map(agentStarts(entries.filter((e) => e.runId === runId)).map((e) => [e.payload.toolCallId, e.payload]))
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
      const payload = origin?.kind === 'subagent_origin' ? (origin.payload as unknown as SubagentOriginPayload) : undefined
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
      const ended = new Set(agentEnds(entries).map((e) => e.payload.agentId))
      for (const { payload } of agentStarts(entries)) {
        if (!ended.has(payload.agentId)) {
          await this.#options.entries.commit(latest.sessionId, await this.#interruptedEnd(payload))
          log.warn('subagent marked interrupted', { sessionId: latest.sessionId, agentId: payload.agentId })
          count++
        }
        // 仍在的 isolation worktree：父 Session 读取与写入它照样须审批。
        if (payload.isolation && (await this.#options.store.worktrees.get(payload.isolation.worktreeId))?.status === 'active')
          this.isolate(latest.sessionId, payload.isolation.path, true)
      }
    }
    return count
  }

  /** 被中断的子代理的 agent_end：用量取到子 Session 最后一条；isolation worktree 没有改动时回收（与正常结束同一规则），有改动时保留并注明。 */
  async #interruptedEnd(start: AgentStartPayload, runId?: string): Promise<RunEntry> {
    const { agentId } = start
    const entries = await this.#options.store.sessions.listEntries(agentId)
    const usage = childUsage(entries, entries.at(-1)?.createdAt ?? Date.now())
    // teammate 被中断后仍在名册中（idle），worktree 保留到解散。
    const released = start.isolation && !start.teammate ? await this.#releaseWorktree(agentId, start.isolation.worktreeId) : undefined
    const worktree = released && !released.removed ? released.worktree : undefined
    return {
      kind: 'agent_end',
      ...(runId ? { runId } : {}),
      payload: { agentId, status: 'interrupted', usage, resultChars: lastAssistantText(entries).length, ...(worktree ? { worktree } : {}) },
    }
  }
}

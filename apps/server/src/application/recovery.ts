import {
  confirmationResult,
  createBuiltinToolRegistry,
  createLocalExecPort,
  lastRunStatus,
  planRecovery,
  toolNameOf,
  unansweredConfirmations,
  type RunEntry,
  type RunStatus,
  type ToolRegistry,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { ConfirmationAnswer } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import { requireSession, type SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'sessions'])

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

export interface SessionRecoveryOptions {
  store: SessionStore
  runtimes: SessionRuntimes
  /** Workspace 的工具集；缺省内置工具。用于判定被中断调用的工具类别与探测结果。 */
  tools?: (cwd: string) => ToolRegistry
  /** 与权限修改共用的 Session 锁（结果确认与权限条目串行）。 */
  locked: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
}

/**
 * 启动恢复与结果确认（recovery.md）：被中断 Run 的补齐、恢复失败的 Session 的重试，以及"有未回答的结果确认"的单一来源。
 */
export class SessionRecovery {
  readonly #options: SessionRecoveryOptions
  /**
   * 有未回答结果确认的 Session：条目派生的缓存（confirmation_request 与 confirmation_answer 只经 commitBatch 提交，并在那里更新它；
   * 启动扫描从条目建立）。开始 Run、回退与分叉以及 Session DTO 都只读它（awaitsConfirmation）。
   */
  readonly #awaitingConfirmation = new Set<string>()
  /** 启动恢复失败的 Session 与其未结束的 Run：恢复成功之前拒绝 Run、回退与分叉，下次操作时重试。 */
  readonly #failed = new Map<string, string[]>()

  constructor(options: SessionRecoveryOptions) {
    this.#options = options
  }

  /** 是否有未回答的结果确认（单一来源）。 */
  awaitsConfirmation(sessionId: string): boolean {
    return this.#awaitingConfirmation.has(sessionId)
  }

  /** 启动恢复失败、尚未重试成功。 */
  failed(sessionId: string): boolean {
    return this.#failed.has(sessionId)
  }

  /**
   * 启动扫描（打开存储之后、开始监听之前；recovery.md）：每个有 run_start 而无 run_end 的 Run 按 planRecovery 补齐条目
   * （过期的审批、补齐的工具结果、confirmation_request、run_end interrupted），同一 Run 的条目一次事务提交。之后从各 Session
   * 最后一条 run_end 建立 activity，使未打开的 Session 在列表中也显示 interrupted / paused / awaiting-confirmation。
   * 单个 Session 失败不阻止启动：记错误，该 Session 在恢复成功之前拒绝 Run、回退与分叉（recovery-failed），下次操作时重试。
   */
  async recover(source: RecoverySource): Promise<RecoveryReport> {
    const { store, runtimes } = this.#options
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
      if (status === 'paused' || status === 'interrupted') status = lastRunStatus(await store.sessions.listEntries(end.sessionId))
      if (status === undefined) continue
      runtimes.setLastStatus(end.sessionId, status)
      // 待确认只出现在被中断的 Run 之后（之前的确认未回答时不能开始新 Run）。
      if (status === 'interrupted' && unansweredConfirmations(await store.sessions.listEntries(end.sessionId)).length > 0)
        this.#awaitingConfirmation.add(end.sessionId)
    }
    return report
  }

  /** 恢复一个 Session 中未结束的 Run（已有 run_end 的跳过）；失败时登记并返回 undefined。 */
  async #recoverSession(sessionId: string, runIds: readonly string[]): Promise<{ runs: number; confirmations: number } | undefined> {
    const { store } = this.#options
    const result = { runs: 0, confirmations: 0 }
    try {
      const session = await requireSession(store, sessionId)
      const workspace = await store.sessions.getWorkspace(session.workspaceId)
      if (!workspace) throw new Error(`workspace ${session.workspaceId} not found`)
      const tools = this.#options.tools?.(workspace.path) ?? createBuiltinToolRegistry({ cwd: workspace.path, exec: createLocalExecPort() })
      for (const runId of runIds) {
        const entries = await store.sessions.listEntries(sessionId)
        if (entries.some((e) => e.kind === 'run_end' && e.runId === runId)) continue
        const planned = await planRecovery(entries, { runId, tool: (name) => tools.get(name), cwd: workspace.path })
        await this.commitBatch(sessionId, planned)
        const confirmations = planned.filter((e) => e.kind === 'confirmation_request').length
        result.runs++
        result.confirmations += confirmations
        log.warn('interrupted run recovered', { sessionId, runId, entries: planned.length, confirmations })
      }
      this.#failed.delete(sessionId)
      return result
    } catch (error) {
      this.#failed.set(sessionId, [...runIds])
      log.error('run recovery failed', { sessionId, error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /** 恢复失败的 Session：先重试恢复，仍失败时以 recovery-failed 拒绝（未配对的调用会破坏模型请求，补齐的条目也会错位）。 */
  async ensureRecovered(sessionId: string): Promise<void> {
    const runIds = this.#failed.get(sessionId)
    if (runIds === undefined) return
    if ((await this.#recoverSession(sessionId, runIds)) === undefined)
      throw new AppError('recovery-failed', 'This session could not be recovered after Coko stopped; see the logs for details')
    this.#options.runtimes.rememberStatus(sessionId, await this.#options.store.sessions.listEntries(sessionId))
  }

  /**
   * 回答恢复时结果不明的调用：confirmation_answer 与补齐的 toolResult 一次事务提交（之后"继续"的模型上下文含该结果）。
   * 该调用没有待回答的确认时 not-found。
   */
  async answerConfirmation(sessionId: string, toolCallId: string, answer: ConfirmationAnswer): Promise<void> {
    const { store, runtimes } = this.#options
    await requireSession(store, sessionId)
    await this.#options.locked(sessionId, async () => {
      const entries = await store.sessions.listEntries(sessionId)
      const target = unansweredConfirmations(entries).find((p) => p.toolCallId === toolCallId)
      if (!target) throw new AppError('not-found', `No outcome confirmation is waiting for tool call ${toolCallId}`)
      const runId = target.runId ?? undefined
      const toolName = toolNameOf(entries, toolCallId) ?? 'unknown'
      await this.commitBatch(sessionId, [
        { kind: 'confirmation_answer', ...(runId ? { runId } : {}), payload: { toolCallId, answer } },
        { kind: 'message', ...(runId ? { runId } : {}), payload: confirmationResult({ toolCallId, toolName, answer }) },
      ])
      // 已建立的运行时的对话记录不含补齐的结果：丢弃它，下次开始 Run 时从条目重建。
      if (runtimes.get(sessionId)) runtimes.discard(sessionId)
      log.info('outcome confirmed', { sessionId, toolCallId, answer })
    })
  }

  /**
   * 一次事务提交一批条目，之后逐条发布（没有运行时扩展的场景：启动扫描、结果确认与分叉）。含 confirmation_* 条目时按提交后的条目
   * 重算"有未回答的结果确认"。
   */
  async commitBatch(sessionId: string, entries: readonly RunEntry[]): Promise<void> {
    const committed = await this.#options.runtimes.commitBatch(sessionId, entries)
    if (committed.some((e) => e.kind === 'confirmation_request' || e.kind === 'confirmation_answer')) {
      const pending = unansweredConfirmations(await this.#options.store.sessions.listEntries(sessionId))
      if (pending.length > 0) this.#awaitingConfirmation.add(sessionId)
      else this.#awaitingConfirmation.delete(sessionId)
    }
  }
}

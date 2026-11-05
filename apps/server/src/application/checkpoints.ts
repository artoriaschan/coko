import {
  effectiveEntries,
  emptyRewindReport,
  forkEntries,
  planRewind,
  realLocation,
  restoreFiles,
  RewindTargetError,
  type RewindFiles,
  type RewindMode,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { Checkpoint, RewindResponse, ForkBoundary } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import { standaloneWriteRoots } from './session-directory.ts'
import { sessionProject } from './session-project.ts'
import { AppError } from './errors.ts'
import type { SessionRecovery } from './recovery.ts'
import type { SessionCwd } from './session-runs.ts'
import { requireSession, type SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'sessions'])

export interface SessionCheckpointsOptions {
  attachments?: import('./attachments.ts').AttachmentStore
  store: SessionStore
  runtimes: SessionRuntimes
  recovery: SessionRecovery
  /** Session 的工作目录（回退的边界；worktree 会话为 worktree 中的目录）；缺省 Workspace 目录。 */
  cwd?: SessionCwd
  /** 回退代码读取快照正文与当前文件摘要（Sidecar 为 <dataDir>/blobs）。缺省：回退代码以 internal 失败。 */
  files?: RewindFiles
}

function plan<T>(make: () => T): T {
  try {
    return make()
  } catch (error) {
    if (error instanceof RewindTargetError) throw new AppError('bad-request', error.message)
    throw error
  }
}

/** Checkpoint：列表、回退与分叉（ADR 0006），以及其间对新 Run 的排斥。 */
export class SessionCheckpoints {
  readonly #options: SessionCheckpointsOptions
  /** 正在回退或分叉的 Session：其间不能开始 Run（开始 Run 在调用运行时之前检查 busy）。 */
  readonly #exclusive = new Set<string>()

  constructor(options: SessionCheckpointsOptions) {
    this.#options = options
  }

  /** 是否正在回退或分叉。 */
  busy(sessionId: string): boolean {
    return this.#exclusive.has(sessionId)
  }

  /**
   * 回退与分叉的前置条件，并在其间排斥新 Run：恢复失败 recovery-failed，Run 进行中（含等待审批）session-busy，有未回答的结果确认
   * confirmation-pending（与开始 Run 同一判断）。检查与登记在同一同步段内，之后开始的 Run 被拒绝。
   * 只读的预览（dry-run）检查同样的前置条件但不登记，并发的预览互不排斥（对话框的预览可能同时发出两次）。
   */
  async #exclusively<T>(sessionId: string, task: (entries: StoredEntry[]) => Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    const { store, runtimes, recovery } = this.#options
    await requireSession(store, sessionId)
    if (runtimes.isRunning(sessionId) || this.#exclusive.has(sessionId))
      throw new AppError('session-busy', 'A Run is in progress or waiting for approval; rewind and fork are not available')
    const register = !options.readOnly
    if (register) this.#exclusive.add(sessionId)
    try {
      // 恢复失败的重试在登记之后：检查与登记之间没有 await，并发的回退预览不会同时通过。
      await recovery.ensureRecovered(sessionId)
      const entries = await store.sessions.listEntries(sessionId)
      if (runtimes.isRunning(sessionId)) throw new AppError('session-busy', 'A Run is in progress or waiting for approval')
      if (recovery.awaitsConfirmation(sessionId)) throw new AppError('confirmation-pending', 'An outcome confirmation is waiting for an answer')
      return await task(entries)
    } finally {
      if (register) this.#exclusive.delete(sessionId)
    }
  }

  /** Checkpoint 列表：有效上下文中的用户消息，以及回退代码到该处时涉及的路径。 */
  async list(sessionId: string): Promise<Checkpoint[]> {
    const { store } = this.#options
    await requireSession(store, sessionId)
    const entries = await store.sessions.listEntries(sessionId)
    const backups = entries.flatMap((e) => (e.kind === 'file_backup' ? [e.payload as { anchorSeq: number; path: string }] : []))
    return effectiveEntries(entries).flatMap((entry) => {
      if (entry.kind !== 'message' || (entry.payload as { role?: unknown }).role !== 'user') return []
      let text: string
      try {
        text = planRewind(entries, entry.seq, 'conversation').text
      } catch (error) {
        // A provenance-paired, state-only user message is host delivery, not a Checkpoint.
        if (error instanceof RewindTargetError) return []
        throw error
      }
      const paths = [...new Set(backups.filter((b) => b.anchorSeq >= entry.seq).map((b) => b.path))]
      return [{ seq: entry.seq, text, createdAt: entry.createdAt, paths }]
    })
  }

  /**
   * 回退到某条用户消息（ADR 0006）。code / both 先恢复文件（目标锚点及之后追踪过的路径回到最早的备份，原先不存在的删除），
   * conversation / both 再提交 rewind 条目并丢弃运行时（下次开始 Run 时按有效条目重建）。dryRun 只返回将发生的变化。
   */
  async rewind(sessionId: string, input: { targetSeq: number; mode: RewindMode; dryRun?: boolean }): Promise<RewindResponse> {
    const { store, runtimes } = this.#options
    return this.#exclusively(
      sessionId,
      async (entries) => {
        const planned = plan(() => planRewind(entries, input.targetSeq, input.mode))
        const dryRun = input.dryRun ?? false
        let files = emptyRewindReport()
        if (planned.files.length > 0) {
          if (!this.#options.files) throw new AppError('internal', 'File checkpoints are not available')
          const session = await requireSession(store, sessionId)
          const workspace = await store.sessions.getWorkspace(session.workspaceId)
          if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
          // 边界为会话的工作目录（ADR 0016：Checkpoint 路径与会话目录一致）；Workspace 为仓库子目录时 worktree 不在 Workspace 目录之下。
          const cwd = this.#options.cwd ? await this.#options.cwd.resolve(session, workspace) : workspace.path
          const directory = session.directory
          const standalone = directory && !(await sessionProject(store, session))
          files = await restoreFiles(planned.files, this.#options.files, {
            workspace: await realLocation(cwd),
            ...(standalone ? { writeRoots: await standaloneWriteRoots(directory) } : {}),
            dryRun,
          })
        }
        if (!dryRun && planned.entry) {
          await runtimes.commit(sessionId, planned.entry)
          runtimes.discard(sessionId)
          runtimes.rememberStatus(sessionId, await store.sessions.listEntries(sessionId))
        }
        if (!dryRun)
          log.info('session rewound', {
            sessionId,
            targetSeq: planned.targetSeq,
            mode: planned.mode,
            restored: files.restored.length,
            deleted: files.deleted.length,
            diverged: files.diverged.length,
            untracked: files.untracked.length,
            outside: files.outside.length,
            skipped: files.skipped.length,
          })
        return { targetSeq: planned.targetSeq, mode: planned.mode, dryRun, text: planned.text, ...files }
      },
      { readOnly: input.dryRun === true },
    )
  }

  /**
   * 以显式用户之前或成功助手包含边界分支（ADR 0023）：新 Session（同一 Workspace 与模型）的条目为 fork_origin、边界内有效消息与必要权限状态；
   * 原 Session 不变，Workspace 文件不复制。标题由界面按当前语言生成后传入（Sidecar 不写本地化文案），省略时沿用原标题。
   * 返回新 Session 的 id 与目标文本（助手包含边界为空）。
   */
  async fork(sessionId: string, targetSeq: number, title?: string, boundary: ForkBoundary = 'user-before'): Promise<{ sessionId: string; text: string }> {
    const { store, recovery } = this.#options
    return this.#exclusively(sessionId, async (entries) => {
      const source = await requireSession(store, sessionId)
      const workspace = await store.sessions.getWorkspace(source.workspaceId)
      if (!workspace) throw new AppError('not-found', `Workspace ${source.workspaceId} not found`)
      if (this.#options.cwd) await this.#options.cwd.resolve(source, workspace)
      const forked = plan(() => forkEntries(entries, sessionId, targetSeq, boundary))
      const session = await store.sessions.createSession({
        workspaceId: source.workspaceId,
        directory: source.directory,
        cwd: source.cwd,
        projectId: source.projectId,
        worktreeId: source.worktreeId,
        title: title?.trim() || source.title,
        model: source.model,
        thinkingLevel: source.thinkingLevel,
      })
      let copies: Awaited<ReturnType<NonNullable<SessionCheckpointsOptions['attachments']>['fork']>> | undefined
      try {
        copies = await this.#options.attachments?.fork(session.id, forked.entries)
        await recovery.commitBatch(session.id, copies?.entries ?? forked.entries)
      } catch (error) {
        await copies?.rollback()
        await store.sessions.deleteSession(session.id)
        throw error
      }
      log.info('session forked', { sessionId, forkedSessionId: session.id, targetSeq, entries: forked.entries.length })
      return { sessionId: session.id, text: forked.text }
    })
  }
}

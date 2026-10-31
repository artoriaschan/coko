// 交接（Handoff，docs/subsystems/handoff.md）：/handoff 与 POST /api/sessions/:id/handoff 开始一个 trigger handoff 的摘要 Run（运行时的摘要模式：
// 有效上下文加提示，一次请求、不注册工具，经请求前检查）；Run 正常结束后按目标取或建 worktree、创建目标 Session（同 Workspace、模型与推理档位，
// 复制权限模式与 Session 规则），目标首条 handoff_origin，源 Session 以同一 runId 提交 handoff 条目（usage 计入 Goal）。停止或失败时不创建目标。
import { handoffPrompt, handoffSummaryText, handoffTargetEntries, hasUserMessage, type RunError, type RunResult } from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import type { HandoffTarget, Worktree } from '@coko/protocol'
import type { NewSession, Session as StoredSession, SessionStore } from '@coko/session'
import type { RunRequest, SessionEntryAccess } from './context/types.ts'
import { AppError, errorMessage } from './errors.ts'
import { validWorktreeName } from './worktrees.ts'

const log = getLogger(['application', 'handoff'])

/** 目标 Session 的标题上限（与界面从首条消息生成的标题相同）。 */
const TITLE_MAX = 60

/** 交接需要的 Run 能力（runtime 层由 SessionService 给出）。 */
export interface HandoffRunHost {
  isRunning(sessionId: string): boolean
  startRun(sessionId: string, request: RunRequest): Promise<{ runId: string }>
  /** 会话记录的唯一创建入口（SessionService.createRecord：worktree 在校验之后被移除时 409 worktree-removed）。 */
  createSession(input: NewSession): Promise<StoredSession>
}

/** 交接需要的 worktree 能力（WorktreeService）。 */
export interface HandoffWorktrees {
  get(id: string): Promise<Worktree>
  list(workspaceId: string): Promise<Worktree[]>
  create(workspaceId: string, input: { name?: string }): Promise<Worktree>
  gitStatus(session: StoredSession): Promise<{ repo: boolean }>
}

/** Goal 的请求前检查（GoalService.beforeRequest）：交接条目提交之后重查。 */
export interface HandoffGoalCheck {
  beforeRequest(sessionId: string, runId: string): Promise<RunError | undefined>
}

export interface HandoffServiceOptions {
  store: SessionStore
  /** 领域条目的提交（替换登记明文后入库，再推送）。 */
  entries: SessionEntryAccess
  runs: HandoffRunHost
  worktrees: HandoffWorktrees
  goals?: HandoffGoalCheck
}

/** 进行中的交接：从开始摘要 Run 到目标创建完成（或放弃）。 */
interface PendingHandoff {
  instructions: string
  target: HandoffTarget
  done: Promise<void>
  resolve: () => void
}

/** 目标 Session 的标题：下一步目标的首行（替换登记明文与凭据形态后），过长时截断。 */
export function handoffTitle(instructions: string): string {
  const line = redactText(instructions.trim().split('\n')[0]!.trim())
  return line.length > TITLE_MAX ? line.slice(0, TITLE_MAX - 1) + '…' : line
}

export class HandoffService {
  readonly #options: HandoffServiceOptions
  readonly #pending = new Map<string, PendingHandoff>()

  constructor(options: HandoffServiceOptions) {
    this.#options = options
  }

  /**
   * 开始交接，返回摘要 Run 的 runId。子 Session 409 child-session；Run 进行中（或上一次交接的目标仍在创建）409 run-in-progress；
   * 没有用户消息 400 nothing-to-hand-off；目标在开始前校验（worktree 不存在 404、属于别的 Workspace 400、已移除 409 worktree-removed；
   * 新 worktree 的名字不合法 400 invalid-name、不是 git 仓库 400 not-a-git-repo、重名 409 worktree-exists），摘要请求之后不再因这些原因失败。
   */
  async start(sessionId: string, input: { instructions: string; target: HandoffTarget }): Promise<{ runId: string }> {
    const { store, runs } = this.#options
    const session = await store.sessions.getSession(sessionId)
    if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
    if (session.parentSessionId !== null) throw new AppError('child-session', 'A subagent session cannot be handed off')
    if (runs.isRunning(sessionId) || this.#pending.has(sessionId)) throw new AppError('run-in-progress', 'A Run is in progress')
    const instructions = input.instructions.trim()
    if (instructions === '') throw new AppError('bad-request', 'Describe the next goal for the new session')
    if (!hasUserMessage(await store.sessions.listEntries(sessionId))) throw new AppError('nothing-to-hand-off', 'The session has no messages to hand off')
    await this.#checkTarget(session, input.target)
    if (this.#pending.has(sessionId)) throw new AppError('run-in-progress', 'A Run is in progress')
    let resolve!: () => void
    const done = new Promise<void>((r) => (resolve = r))
    const pending: PendingHandoff = { instructions, target: input.target, done, resolve }
    this.#pending.set(sessionId, pending)
    try {
      const started = await runs.startRun(sessionId, { trigger: 'handoff', input: { text: handoffPrompt(instructions) } })
      log.info('handoff started', { sessionId, runId: started.runId, target: input.target.kind })
      return started
    } catch (error) {
      if (this.#pending.get(sessionId) === pending) this.#pending.delete(sessionId)
      resolve()
      throw error
    }
  }

  async #checkTarget(session: StoredSession, target: HandoffTarget): Promise<void> {
    const { worktrees } = this.#options
    if (target.kind === 'current') return
    if (target.kind === 'worktree') {
      const worktree = await worktrees.get(target.worktreeId)
      if (worktree.workspaceId !== session.workspaceId) throw new AppError('bad-request', 'The worktree belongs to another workspace')
      if (worktree.status === 'removed') throw new AppError('worktree-removed', `Worktree ${worktree.name} was removed`)
      return
    }
    if (target.name !== undefined && !validWorktreeName(target.name)) {
      throw new AppError(
        'invalid-name',
        'Worktree names use lowercase letters, digits, ".", "_" and "-", start with a letter or digit and are at most 64 characters',
      )
    }
    if (!(await worktrees.gitStatus(session)).repo) throw new AppError('not-a-git-repo', 'The workspace is not inside a git repository')
    if (target.name !== undefined && (await worktrees.list(session.workspaceId)).some((w) => w.name === target.name)) {
      throw new AppError('worktree-exists', `A worktree named ${target.name} already exists`)
    }
  }

  /**
   * 请求前检查（上下文贡献的 beforeRequest）：该 Session 的交接目标仍在创建时，之后的 Run（例如 Goal 的下一轮）的请求等到 handoff 条目
   * 提交之后，再按 Goal 预算重查：摘要请求的 usage 先计入 Goal。摘要 Run 自身的请求不等待。
   */
  async beforeRequest(sessionId: string, runId: string): Promise<RunError | undefined> {
    const pending = this.#pending.get(sessionId)
    if (!pending) return undefined
    const entries = await this.#options.store.sessions.listEntries(sessionId)
    const start = entries.find((e) => e.kind === 'run_start' && e.runId === runId)
    if ((start?.payload as { trigger?: string } | undefined)?.trigger === 'handoff') return undefined
    await pending.done
    return this.#options.goals?.beforeRequest(sessionId, runId)
  }

  /** Run 结束之后（上下文贡献的 onRunEnd）：交接的摘要 Run 正常结束时创建目标；其余结果只放弃这次交接。 */
  async runEnded(info: { sessionId: string; runId: string; trigger: RunRequest['trigger']; result: RunResult }): Promise<void> {
    if (info.trigger !== 'handoff') return
    const pending = this.#pending.get(info.sessionId)
    if (!pending) return
    try {
      const { result } = info
      if (result.status === 'completed' && result.summary !== undefined) await this.#finish(info.sessionId, info.runId, pending, result)
      else
        log.info('handoff abandoned', {
          sessionId: info.sessionId,
          runId: info.runId,
          status: result.status,
          ...(result.error ? { code: result.error.code } : {}),
        })
    } catch (error) {
      // 摘要之后目标没能创建：提交 handoff_failed（带摘要请求的 usage，使 Goal 计入；带摘要，供用户复制），客户端据此离开"正在创建"。
      // 在 pending.resolve 之前提交：等待中的请求按包含这次用量的预算重查。
      log.warn('handoff target creation failed', { sessionId: info.sessionId, runId: info.runId, error: errorMessage(error) })
      const failure = error instanceof AppError ? { code: error.code, message: error.message } : { code: 'internal', message: errorMessage(error) }
      await this.#options.entries
        .commit(info.sessionId, {
          kind: 'handoff_failed',
          runId: info.runId,
          payload: {
            instructions: pending.instructions,
            summary: handoffSummaryText(info.result.summary ?? ''),
            error: failure,
            ...(info.result.summaryUsage ? { usage: info.result.summaryUsage } : {}),
          },
        })
        .catch((e: unknown) => log.error('handoff failure entry not committed', { sessionId: info.sessionId, error: errorMessage(e) }))
    } finally {
      this.#pending.delete(info.sessionId)
      pending.resolve()
    }
  }

  async #finish(sessionId: string, runId: string, pending: PendingHandoff, result: RunResult): Promise<void> {
    const { store, entries, worktrees } = this.#options
    const source = await store.sessions.getSession(sessionId)
    if (!source) throw new Error(`Session ${sessionId} not found`)
    const summary = handoffSummaryText(result.summary ?? '')
    const { target } = pending
    let worktreeId = target.kind === 'current' ? (source.worktreeId ?? undefined) : undefined
    if (target.kind === 'worktree') worktreeId = target.worktreeId
    else if (target.kind === 'new-worktree')
      worktreeId = (await worktrees.create(source.workspaceId, target.name === undefined ? {} : { name: target.name })).id
    const created = await this.#options.runs.createSession({
      workspaceId: source.workspaceId,
      title: handoffTitle(pending.instructions),
      model: source.model,
      thinkingLevel: source.thinkingLevel,
      ...(worktreeId === undefined ? {} : { worktreeId }),
    })
    // 源 Session 的条目（以摘要 Run 的 runId）先提交：目标首条 handoff_origin 指向它的 seq。
    const handoff = await entries.commit(sessionId, {
      kind: 'handoff',
      runId,
      payload: {
        targetSessionId: created.id,
        instructions: pending.instructions,
        summary,
        target: target.kind === 'current' ? 'current' : 'worktree',
        ...(result.summaryUsage ? { usage: result.summaryUsage } : {}),
      },
    })
    const sourceEntries = await store.sessions.listEntries(sessionId)
    for (const entry of handoffTargetEntries(sourceEntries, sessionId, handoff.seq)) await entries.commit(created.id, entry)
    log.info('handoff finished', { sessionId, runId, targetSessionId: created.id, target: target.kind, summaryChars: summary.length })
  }
}

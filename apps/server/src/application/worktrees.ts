// Worktree（ADR 0016；docs/subsystems/worktrees.md）：宿主创建的 git worktree 与会话绑定。
// 创建：仓库根 → name 校验 → .coko-worktrees 与目标的符号链接 / 真实路径检查 → info/exclude 追加 /.coko-worktrees/ → git worktree add -b coko/<name>。
// 移除：绑定的会话有 Run、running 子代理、running Job 或 active 定时任务时 busy；git status --porcelain 非空时 dirty；否则 git worktree remove，分支保留。
// 会话的工作目录 = worktree 路径 + Workspace 相对仓库根的路径（SessionCwd），创建后不变；worktree 已移除时开始 Run 以 worktree-removed 拒绝。
import { randomBytes } from 'node:crypto'
import { appendFile, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getLogger } from '@coko/logging'
import { WORKTREE_DIRTY_FILES_MAX, WORKTREES_DIR, type GitStatusResponse, type Worktree, type WorktreeBusyReason, type WorktreeCreator } from '@coko/protocol'
import type { Session as StoredSession, SessionStore, Workspace, WorktreeRecord } from '@coko/session'
import type { GitPort, GitResult } from '../adapters/git.ts'
import { AppError } from './errors.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import type { RecoverySource } from './recovery.ts'
import type { SessionCwd } from './session-runs.ts'

const log = getLogger(['application', 'worktrees'])

/** info/exclude 中追加的一行：父 Workspace 的 grep / find / ls 与 git status 不列出 worktree。 */
export const WORKTREES_EXCLUDE_LINE = `/${WORKTREES_DIR}/`
const BRANCH_PREFIX = 'coko/'
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * worktree 名：小写字母、数字、点、下划线与连字符，以字母或数字开头，至多 64 个字符；另排除 git 分支名不接受的写法（..、以 . 或 .lock 结尾）。
 * 名字同时是 .coko-worktrees 下的目录名，不含路径分隔符，也不会是 . 或 ..。
 */
export function validWorktreeName(name: string): boolean {
  return NAME.test(name) && !name.includes('..') && !name.endsWith('.') && !name.endsWith('.lock')
}

/** 绑定会话的进行中工作（runtime 层由 SessionService、子代理、JobService 与定时任务给出）。 */
export interface WorktreeActivity {
  /** 该 Session 有进行中的 Run。 */
  running(sessionId: string): boolean
  /** 该 Session 有 running 的 Job。 */
  runningJobs(sessionId: string): Promise<boolean>
}

export interface WorktreeServiceOptions {
  store: SessionStore
  git: GitPort
  activity: WorktreeActivity
}

/** 一次 git 调用：退出码非 0 时以 message 抛错（stderr 只记摘要日志，不进响应）。 */
function ok(result: GitResult, what: string): string {
  if (result.exitCode !== 0) {
    log.warn('git command failed', { what, exitCode: result.exitCode, stderrBytes: result.stderr.length })
    throw new AppError('internal', `git ${what} failed`)
  }
  return result.stdout
}

const inside = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/** git status --porcelain 的路径（重命名取新路径；带引号的路径原样保留）。 */
function porcelainPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3)
      const arrow = path.indexOf(' -> ')
      return arrow >= 0 ? path.slice(arrow + 4) : path
    })
}

/** 不合规则的 worktree 名（创建与交接共用的 400 invalid-name）。 */
export function invalidWorktreeNameError(): AppError {
  return new AppError(
    'invalid-name',
    'Worktree names use lowercase letters, digits, ".", "_" and "-", start with a letter or digit and are at most 64 characters',
  )
}

export class WorktreeService {
  readonly #store: SessionStore
  readonly #git: GitPort
  readonly #activity: WorktreeActivity
  /** 同一仓库的创建与移除串行（info/exclude、git worktree 的元数据）。 */
  readonly #repoLock = new KeyedMutex()
  /** 正在移除的 worktree（锁内、busy 检查之前登记，结束或失败时撤销）：其会话的工作目录解析为 409 worktree-busy，不能开始 Run。 */
  readonly #removing = new Set<string>()

  constructor(options: WorktreeServiceOptions) {
    this.#store = options.store
    this.#git = options.git
    this.#activity = options.activity
  }

  /** SessionCwd 的 worktree 实现：没有绑定时为 Workspace 目录。 */
  readonly cwd: SessionCwd = {
    resolve: async (session, workspace) => {
      if (session.worktreeId === null) return workspace.path
      const worktree = await this.#store.worktrees.get(session.worktreeId)
      if (!worktree) throw new AppError('not-found', `Worktree ${session.worktreeId} not found`)
      if (worktree.status === 'removed') throw new AppError('worktree-removed', `Worktree ${worktree.name} was removed; this session is read-only`)
      if (this.#removing.has(worktree.id)) throw new AppError('worktree-busy', `Worktree ${worktree.name} is being removed`, { reasons: [] })
      return this.#sessionDir(worktree, workspace)
    },
  }

  /** worktree 路径 + Workspace 相对仓库根的路径（Workspace 为仓库子目录时为 worktree 中的对应子目录）。 */
  async #sessionDir(worktree: WorktreeRecord, workspace: Workspace): Promise<string> {
    const real = await realpath(workspace.path).catch(() => workspace.path)
    const rel = relative(worktree.repoRoot, real)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return worktree.path
    return join(worktree.path, rel)
  }

  async #workspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.#store.sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    return workspace
  }

  /** Workspace 所在仓库的根（真实路径）；不是 git 仓库时 not-a-git-repo。 */
  async #repoRoot(workspace: Workspace): Promise<string> {
    const exists = await stat(workspace.path).then(
      (s) => s.isDirectory(),
      () => false,
    )
    if (!exists) throw new AppError('not-a-git-repo', 'The workspace directory does not exist')
    const result = await this.#git.run({ args: ['rev-parse', '--show-toplevel'], cwd: workspace.path })
    const top = result.stdout.trim()
    if (result.exitCode !== 0 || top === '') throw new AppError('not-a-git-repo', 'The workspace is not inside a git repository')
    return top
  }

  /** 该 Workspace 的全部会话（含子 Session）。 */
  async #sessions(workspaceId: string): Promise<StoredSession[]> {
    const roots = await this.#store.sessions.listSessions({ workspaceId })
    const children = await Promise.all(roots.map((root) => this.#store.sessions.listChildren(root.id)))
    return [...roots, ...children.flat()]
  }

  #dto(worktree: WorktreeRecord, sessions: readonly StoredSession[]): Worktree {
    const { id, workspaceId, name, path, branch, baseCommit, status, createdBy } = worktree
    return { id, workspaceId, name, path, branch, baseCommit, status, createdBy, sessionCount: sessions.filter((s) => s.worktreeId === id).length }
  }

  async #require(id: string): Promise<WorktreeRecord> {
    const worktree = await this.#store.worktrees.get(id)
    if (!worktree) throw new AppError('not-found', `Worktree ${id} not found`)
    return worktree
  }

  /** 该 Workspace 的 worktree（含 removed），按创建顺序。 */
  async list(workspaceId: string): Promise<Worktree[]> {
    await this.#workspace(workspaceId)
    const [worktrees, sessions] = await Promise.all([this.#store.worktrees.list(workspaceId), this.#sessions(workspaceId)])
    return worktrees.map((worktree) => this.#dto(worktree, sessions))
  }

  async get(id: string): Promise<Worktree> {
    const worktree = await this.#require(id)
    return this.#dto(worktree, await this.#sessions(worktree.workspaceId))
  }

  /** 创建 worktree（POST /api/workspaces/:id/worktrees）。name 省略时生成。 */
  create(workspaceId: string, input: { name?: string } = {}): Promise<Worktree> {
    return this.#create(workspaceId, input.name, 'user')
  }

  /** 供子代理的 isolation：以子 Session id 派生的名字创建。 */
  createForSubagent(workspaceId: string, sessionId: string): Promise<Worktree> {
    const base = `agent-${
      sessionId
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || randomBytes(4).toString('hex')
    }`
    return this.#create(workspaceId, base, 'subagent', true)
  }

  async #create(workspaceId: string, requested: string | undefined, createdBy: WorktreeCreator, suffixOnConflict = false): Promise<Worktree> {
    const workspace = await this.#workspace(workspaceId)
    if (requested !== undefined && !validWorktreeName(requested)) throw invalidWorktreeNameError()
    const repoRoot = await this.#repoRoot(workspace)
    return this.#repoLock.run(repoRoot, async () => {
      const dir = await this.#worktreesDir(repoRoot)
      let name = requested ?? `wt-${randomBytes(3).toString('hex')}`
      // 生成的名字与子代理的名字在冲突时换一个；用户给出的名字冲突时 worktree-exists。
      for (let attempt = 0; await this.#taken(repoRoot, dir, name); attempt++) {
        if (requested !== undefined && !suffixOnConflict) throw new AppError('worktree-exists', `A worktree or branch named ${name} already exists`)
        if (attempt >= 5) throw new AppError('worktree-exists', `A worktree or branch named ${name} already exists`)
        name = `${requested ?? 'wt'}-${randomBytes(2).toString('hex')}`
      }
      const path = join(dir, name)
      const branch = `${BRANCH_PREFIX}${name}`
      await this.#ensureExcluded(repoRoot)
      const added = await this.#git.run({ args: ['worktree', 'add', '-b', branch, path, 'HEAD'], cwd: repoRoot })
      if (added.exitCode !== 0) {
        // 并发的外部改动（同名分支或目录刚出现）或仓库没有提交（HEAD 无效）。
        const exists = await this.#taken(repoRoot, dir, name)
        log.warn('git worktree add failed', { workspaceId, exitCode: added.exitCode, exists })
        if (exists) throw new AppError('worktree-exists', `A worktree or branch named ${name} already exists`)
        throw new AppError('not-a-git-repo', 'git worktree add failed; the repository needs at least one commit')
      }
      const baseCommit = ok(await this.#git.run({ args: ['rev-parse', 'HEAD'], cwd: path }), 'rev-parse HEAD').trim()
      const record = await this.#store.worktrees.create({ workspaceId, name, path, branch, baseCommit, repoRoot, createdBy })
      log.info('worktree created', { worktreeId: record.id, workspaceId, createdBy })
      return this.#dto(record, [])
    })
  }

  /**
   * <repoRoot>/.coko-worktrees（真实路径，必要时创建）。它或其祖先是符号链接、或真实路径不在仓库根下时 unsafe-worktree-path，
   * 不创建任何文件：git worktree add 不会经链接写到仓库外。
   */
  async #worktreesDir(repoRoot: string): Promise<string> {
    const unsafe = (why: string) => new AppError('unsafe-worktree-path', `${WORKTREES_DIR} is not a safe location: ${why}`)
    // 仓库根的每一级祖先都不是符号链接：git 报告的是真实路径，真实路径与报告不同即经过了链接。
    if ((await realpath(repoRoot)) !== repoRoot) throw unsafe('the repository root is reached through a symbolic link')
    const dir = join(repoRoot, WORKTREES_DIR)
    const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw unsafe('it is a symbolic link')
    if (info && !info.isDirectory()) throw unsafe('it is not a directory')
    if (!info) await mkdir(dir)
    const real = await realpath(dir)
    if (real !== dir || !inside(repoRoot, real)) throw unsafe('it resolves outside the repository')
    return dir
  }

  /** 分支 coko/<name> 已存在，或目标路径已存在（含符号链接）。 */
  async #taken(repoRoot: string, dir: string, name: string): Promise<boolean> {
    const branch = await this.#git.run({ args: ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH_PREFIX}${name}`], cwd: repoRoot })
    if (branch.exitCode === 0) return true
    return lstat(join(dir, name)).then(
      () => true,
      () => false,
    )
  }

  /** 向仓库公共 git 目录的 info/exclude 追加 /.coko-worktrees/（已有这一行时不追加）。 */
  async #ensureExcluded(repoRoot: string): Promise<void> {
    const common = ok(await this.#git.run({ args: ['rev-parse', '--git-common-dir'], cwd: repoRoot }), 'rev-parse --git-common-dir').trim()
    const infoDir = join(resolve(repoRoot, common), 'info')
    const file = join(infoDir, 'exclude')
    const text = await readFile(file, 'utf8').catch(() => '')
    if (text.split(/\r?\n/).some((line) => line.trim() === WORKTREES_EXCLUDE_LINE)) return
    await mkdir(infoDir, { recursive: true })
    await appendFile(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${WORKTREES_EXCLUDE_LINE}\n`)
  }

  /** 绑定会话的进行中工作。 */
  async #busy(worktree: WorktreeRecord): Promise<WorktreeBusyReason[]> {
    const bound = (await this.#sessions(worktree.workspaceId)).filter((s) => s.worktreeId === worktree.id)
    const reasons = new Set<WorktreeBusyReason>()
    const schedules = await this.#store.schedules.list()
    for (const session of bound) {
      if (this.#activity.running(session.id)) reasons.add(session.parentSessionId === null ? 'run' : 'agent')
      if (await this.#activity.runningJobs(session.id)) reasons.add('job')
      if (schedules.some((s) => s.sessionId === session.id && s.status === 'active')) reasons.add('schedule')
    }
    return [...reasons]
  }

  /** 未提交的文件（含未跟踪；不含被忽略的）。 */
  async #dirty(path: string): Promise<string[]> {
    return porcelainPaths(ok(await this.#git.run({ args: ['status', '--porcelain', '--untracked-files=all'], cwd: path }), 'status'))
  }

  /**
   * 移除（DELETE /api/worktrees/:id）：busy 409 worktree-busy { reasons }；有未提交的文件 409 worktree-dirty { files, count }（不改动任何文件）；
   * 否则 git worktree remove（不加 --force），分支保留，记录标为 removed。目录已不存在时只清理 git 的元数据并标记。
   */
  async remove(id: string): Promise<void> {
    const worktree = await this.#require(id)
    if (worktree.status === 'removed') return
    await this.#repoLock.run(worktree.repoRoot, async () => {
      // 先登记再检查 busy：此后开始的 Run 在解析工作目录时即 409（TOCTOU），此前已开始的由 busy 检查拦下。
      this.#removing.add(id)
      try {
        await this.#removeLocked(worktree)
      } finally {
        this.#removing.delete(id)
      }
    })
  }

  async #removeLocked(worktree: WorktreeRecord): Promise<void> {
    const id = worktree.id
    const reasons = await this.#busy(worktree)
    if (reasons.length > 0) throw new AppError('worktree-busy', 'Sessions in this worktree still have work in progress', { reasons })
    const present = await stat(worktree.path).then(
      () => true,
      () => false,
    )
    if (present) {
      const files = await this.#dirty(worktree.path)
      if (files.length > 0) {
        throw new AppError('worktree-dirty', 'The worktree has uncommitted changes', { files: files.slice(0, WORKTREE_DIRTY_FILES_MAX), count: files.length })
      }
      ok(await this.#git.run({ args: ['worktree', 'remove', worktree.path], cwd: worktree.repoRoot }), 'worktree remove')
    } else {
      await this.#git.run({ args: ['worktree', 'prune'], cwd: worktree.repoRoot })
    }
    await this.#store.worktrees.markRemoved(id)
    log.info('worktree removed', { worktreeId: id, workspaceId: worktree.workspaceId })
  }

  /**
   * 子代理结束时：HEAD 仍为 base 且没有未提交的文件时移除 worktree 并删除分支（git branch -d），返回 removed；否则保留，返回其路径与分支。
   */
  async removeIfUnchanged(id: string): Promise<{ removed: true } | { removed: false; path: string; branch: string }> {
    const worktree = await this.#require(id)
    const kept = { removed: false as const, path: worktree.path, branch: worktree.branch }
    if (worktree.status === 'removed') return { removed: true }
    return this.#repoLock.run(worktree.repoRoot, async () => {
      const head = await this.#git.run({ args: ['rev-parse', 'HEAD'], cwd: worktree.path })
      if (head.exitCode !== 0 || head.stdout.trim() !== worktree.baseCommit) return kept
      if ((await this.#dirty(worktree.path)).length > 0) return kept
      const removed = await this.#git.run({ args: ['worktree', 'remove', worktree.path], cwd: worktree.repoRoot })
      if (removed.exitCode !== 0) return kept
      await this.#git.run({ args: ['branch', '-d', worktree.branch], cwd: worktree.repoRoot })
      await this.#store.worktrees.markRemoved(id)
      log.info('worktree removed unchanged', { worktreeId: id })
      return { removed: true as const }
    })
  }

  /** GET /api/sessions/:id/git-status：Session 不存在时 not-found。 */
  async gitStatusOf(sessionId: string): Promise<GitStatusResponse> {
    const session = await this.#store.sessions.getSession(sessionId)
    if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
    return this.gitStatus(session)
  }

  /** 会话工作目录的分支与未提交文件数；不在 git 仓库中时 repo false。 */
  async gitStatus(session: StoredSession): Promise<GitStatusResponse> {
    const workspace = await this.#workspace(session.workspaceId)
    let cwd: string
    try {
      cwd = await this.cwd.resolve(session, workspace)
    } catch (error) {
      if (error instanceof AppError && error.code === 'worktree-removed') return { repo: false, dirtyFiles: 0 }
      throw error
    }
    const exists = await stat(cwd).then(
      (s) => s.isDirectory(),
      () => false,
    )
    if (!exists) return { repo: false, dirtyFiles: 0 }
    const top = await this.#git.run({ args: ['rev-parse', '--show-toplevel'], cwd })
    if (top.exitCode !== 0) return { repo: false, dirtyFiles: 0 }
    const branch = (await this.#git.run({ args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd })).stdout.trim()
    const status = await this.#git.run({ args: ['status', '--porcelain', '--untracked-files=all'], cwd: top.stdout.trim() })
    return { repo: true, ...(branch ? { branch } : {}), dirtyFiles: status.exitCode === 0 ? porcelainPaths(status.stdout).length : 0 }
  }

  /**
   * 启动恢复：把路径已不存在的 active worktree 标为 removed；子代理派发时创建、崩溃前还没有子 Session 绑定的 worktree 按 removeIfUnchanged
   * 回收（有改动时保留）。返回标记与回收的数量。
   */
  async recover(_source: RecoverySource): Promise<number> {
    let marked = 0
    for (const workspace of await this.#store.sessions.listWorkspaces()) {
      let sessions: StoredSession[] | undefined
      for (const worktree of await this.#store.worktrees.list(workspace.id)) {
        if (worktree.status !== 'active') continue
        const present = await lstat(worktree.path).then(
          () => true,
          () => false,
        )
        if (!present) {
          await this.#store.worktrees.markRemoved(worktree.id)
          marked++
          log.warn('worktree missing at startup; marked removed', { worktreeId: worktree.id, workspaceId: workspace.id })
          continue
        }
        if (worktree.createdBy !== 'subagent') continue
        sessions ??= await this.#sessions(workspace.id)
        if (sessions.some((s) => s.worktreeId === worktree.id)) continue
        const result = await this.removeIfUnchanged(worktree.id).catch(() => undefined)
        if (result?.removed) marked++
        log.warn(result?.removed ? 'orphan subagent worktree removed at startup' : 'orphan subagent worktree kept at startup', { worktreeId: worktree.id })
      }
    }
    return marked
  }
}

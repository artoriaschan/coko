import { resolve } from 'node:path'
import { branchNameError, WORKTREE_DIRTY_FILES_MAX, type BranchListResponse, type CheckoutBranchRequest } from '@coko/protocol'
import type { Session, SessionStore } from '@coko/session'
import type { GitPort } from '../adapters/git.ts'
import { AppError } from './errors.ts'
import { KeyedMutex } from './keyed-mutex.ts'

export interface BranchActivity {
  busy(id: string): boolean
  cwd(session: Session): Promise<{ cwd: string }>
  runningJobs(id: string): Promise<boolean>
}

/** Project primary checkout operations. The directory lease spans all asynchronous preconditions through git completion. */
export class BranchService {
  readonly #store: SessionStore
  readonly #git: GitPort
  readonly #activity: BranchActivity
  readonly #locks = new KeyedMutex()
  readonly #changing = new Set<string>()
  constructor(options: { store: SessionStore; git: GitPort; activity: BranchActivity }) {
    this.#store = options.store
    this.#git = options.git
    this.#activity = options.activity
  }

  /** Called synchronously immediately before Run launch, including future sessions and subagents. */
  assertAdmission = (cwd: string): void => {
    if (this.#changing.has(resolve(cwd))) throw new AppError('session-busy', 'The working directory is changing branches', { reasons: ['run'], sessions: [] })
  }

  async #primary(id: string): Promise<string> {
    const project = await this.#store.projects.get(id)
    if (!project) throw new AppError('not-found', 'Project not found')
    const workspace = await this.#store.sessions.getWorkspace(project.primaryWorkspaceId)
    if (!workspace) throw new AppError('not-found', 'Primary workspace not found')
    return workspace.path
  }

  async #root(cwd: string): Promise<string> {
    try {
      const result = await this.#git.run({ cwd, args: ['rev-parse', '--show-toplevel'] })
      if (result.exitCode !== 0 || !result.stdout.trim()) throw new AppError('not-a-git-repo', 'The primary folder is not inside a Git repository')
      return result.stdout.trim()
    } catch (error) {
      if (error instanceof AppError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('git-unavailable', 'Git is not installed or unavailable')
      throw error
    }
  }

  async list(id: string): Promise<BranchListResponse> {
    const cwd = await this.#primary(id)
    try {
      await this.#root(cwd)
    } catch (error) {
      if (error instanceof AppError && (error.code === 'not-a-git-repo' || error.code === 'git-unavailable'))
        return { available: false, reason: error.code, branches: [] }
      throw error
    }
    const [head, refs] = await Promise.all([
      this.#git.run({ cwd, args: ['symbolic-ref', '--quiet', '--short', 'HEAD'] }),
      this.#git.run({
        cwd,
        args: ['for-each-ref', '--sort=refname', '--sort=-committerdate', '--format=%(refname:strip=2)%00%(committerdate:unix)', 'refs/heads/'],
      }),
    ])
    if (refs.exitCode !== 0) throw new AppError('internal', 'Could not list local branches')
    const current = head.stdout.trim()
    const branches = refs.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, date] = line.split('\0')
        return { name: name!, committedAt: Number(date || 0) }
      })
    branches.sort((a, b) => Number(b.name === current) - Number(a.name === current))
    return { available: true, ...(current ? { current } : {}), branches }
  }

  async #busy(cwd: string): Promise<void> {
    const all: Session[] = []
    const walk = async (session: Session): Promise<void> => {
      all.push(session)
      for (const child of await this.#store.sessions.listChildren(session.id)) await walk(child)
    }
    for (const root of await this.#store.sessions.listSessions()) await walk(root)
    const schedules = await this.#store.schedules.list()
    const reasons = new Set<string>()
    const sessions: { id: string; title: string }[] = []
    for (const session of all) {
      const actual = await this.#activity.cwd(session).catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'worktree-removed') return undefined
        throw error
      })
      if (!actual || resolve(actual.cwd) !== resolve(cwd)) continue
      const found: string[] = []
      if (this.#activity.busy(session.id)) found.push(session.parentSessionId ? 'agent' : 'run')
      if (await this.#activity.runningJobs(session.id)) found.push('job')
      if (schedules.some((s) => s.sessionId === session.id && s.status === 'active')) found.push('schedule')
      if (found.length) {
        sessions.push({ id: session.id, title: session.title })
        for (const reason of found) reasons.add(reason)
      }
    }
    if (reasons.size) throw new AppError('session-busy', 'Sessions in the primary folder still have work in progress', { reasons: [...reasons], sessions })
  }

  async checkout(id: string, input: CheckoutBranchRequest): Promise<BranchListResponse> {
    if (branchNameError(input.name)) throw new AppError('invalid-name', 'Invalid Git branch name')
    const cwd = await this.#primary(id)
    const root = await this.#root(cwd)
    return this.#locks.run(root, async () => {
      this.#changing.add(resolve(cwd))
      try {
        const valid = await this.#git.run({ cwd, args: ['check-ref-format', '--branch', input.name] })
        if (valid.exitCode !== 0) throw new AppError('invalid-name', 'Invalid Git branch name')
        await this.#busy(cwd)
        const status = await this.#git.run({ cwd: root, args: ['status', '--porcelain', '--untracked-files=all'] })
        if (status.exitCode !== 0) throw new AppError('internal', 'Could not read Git status')
        const files = status.stdout
          .split('\n')
          .filter((line) => line.length > 3)
          .map((line) => line.slice(3).split(' -> ').at(-1)!)
        if (files.length)
          throw new AppError('git-dirty', 'The repository has uncommitted changes', { files: files.slice(0, WORKTREE_DIRTY_FILES_MAX), count: files.length })
        const exists = await this.#git.run({ cwd, args: ['show-ref', '--verify', '--quiet', `refs/heads/${input.name}`] })
        if (input.create && exists.exitCode === 0) throw new AppError('already-exists', 'A branch with this name already exists')
        if (!input.create && exists.exitCode !== 0) throw new AppError('not-found', 'Local branch not found')
        const result = await this.#git.run({ cwd, args: input.create ? ['switch', '-c', input.name] : ['switch', '--no-guess', input.name] })
        if (result.exitCode !== 0) throw new AppError('invalid-transition', 'Git could not switch branches; the original selection is kept')
        return await this.list(id)
      } finally {
        this.#changing.delete(resolve(cwd))
      }
    })
  }
}

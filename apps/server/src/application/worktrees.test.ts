// WorktreeService：真实 git（夹具仓库）与内存存储。removeIfUnchanged（供子代理）、name 校验、仓库根经符号链接时拒绝、子目录 Workspace 的工作目录、
// 移除期间的 worktree-busy（对手用例：并发开始 Run）。
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelRegistry, InMemoryCredentialStore } from '@coko/agent'
import { SessionService } from './sessions.ts'
import { SessionHub } from './hub.ts'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { createGitRunner, type GitPort } from '../adapters/git.ts'
import { AppError } from './errors.ts'
import { validWorktreeName, WorktreeService } from './worktrees.ts'

const run = promisify(execFile)

/** 临时仓库（与 tests/fixtures/git 相同的隔离：临时 HOME、GIT_CONFIG_GLOBAL=/dev/null、固定 author）。 */
interface GitWorkspace {
  root: string
  home: string
  env: Record<string, string>
  git(...args: string[]): Promise<string>
  dispose(): Promise<void>
}

async function createGitWorkspace(options: { files: Record<string, string> }): Promise<GitWorkspace> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'coko-wt-unit-')))
  const root = join(base, 'repo')
  const home = join(base, 'home')
  await mkdir(root, { recursive: true })
  await mkdir(home, { recursive: true })
  const env = {
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Coko Unit',
    GIT_AUTHOR_EMAIL: 'unit@coko.test',
    GIT_COMMITTER_NAME: 'Coko Unit',
    GIT_COMMITTER_EMAIL: 'unit@coko.test',
  }
  const git = async (...args: string[]) => (await run('git', args, { cwd: root, env: { PATH: process.env.PATH ?? '', ...env } })).stdout
  await git('init', '-q', '-b', 'main')
  await git('config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(options.files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await git('add', '-A')
  await git('commit', '-q', '-m', 'initial')
  return { root, home, env, git, dispose: () => rm(base, { recursive: true, force: true }) }
}
const repos: GitWorkspace[] = []
afterEach(async () => {
  for (const repo of repos.splice(0)) await repo.dispose()
})

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

async function setup(options: { git?: (real: GitPort) => GitPort; workspaceDir?: string } = {}) {
  const repo = await createGitWorkspace({ files: { 'README.md': '# fixture\n', 'pkg/a.txt': 'a\n' } })
  repos.push(repo)
  const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
  const real = createGitRunner({ env: { PATH: process.env.PATH ?? '', ...repo.env } })
  const service = new WorktreeService({
    store,
    git: options.git ? options.git(real) : real,
    activity: { running: () => false, runningJobs: async () => false },
  })
  const workspace = await store.sessions.registerWorkspace({ path: options.workspaceDir ? join(repo.root, options.workspaceDir) : repo.root })
  const inWorktree = (path: string, ...args: string[]) => run('git', args, { cwd: path, env: { PATH: process.env.PATH ?? '', ...repo.env } })
  const sessions = new SessionService({
    store,
    registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
    hub: new SessionHub(),
    runs: { launch: () => undefined },
    cwd: service.cwd,
  })
  return { repo, store, service, workspace, inWorktree, sessions }
}

const branches = async (repo: GitWorkspace) => (await repo.git('branch', '--format=%(refname:short)')).trim().split('\n').sort()

// 每个用例在临时仓库中运行多次真实 git（init、commit、worktree add / remove、status），无竞争时单例约 1.7–2.7 秒；
// 并行全量下默认 5 秒不够。预算只限制等待上限，git 自身的超时仍由 adapters/git.ts 控制。
const REAL_GIT_BUDGET = { timeout: 30_000 }

describe('WorktreeService.removeIfUnchanged', REAL_GIT_BUDGET, () => {
  it('HEAD = base 且干净：目录与分支都删除，记录为 removed', async () => {
    const { repo, store, service, workspace } = await setup()
    const created = await service.createForSubagent(workspace.id, 'abcdef12-3456')
    expect([created.name, created.branch, created.createdBy]).toEqual(['agent-abcdef12', 'coko/agent-abcdef12', 'subagent'])
    expect(await service.removeIfUnchanged(created.id)).toEqual({ removed: true })
    expect(await exists(created.path)).toBe(false)
    expect(await branches(repo)).toEqual(['main'])
    expect((await store.worktrees.get(created.id))?.status).toBe('removed')
  })

  it('有新提交时保留（目录与分支都在）', async () => {
    const { repo, service, workspace, inWorktree } = await setup()
    const created = await service.createForSubagent(workspace.id, 'commit01')
    await writeFile(join(created.path, 'new.txt'), 'n\n')
    await inWorktree(created.path, 'add', 'new.txt')
    await inWorktree(created.path, 'commit', '-q', '-m', 'change')
    expect(await service.removeIfUnchanged(created.id)).toEqual({ removed: false, path: created.path, branch: created.branch })
    expect(await exists(join(created.path, 'new.txt'))).toBe(true)
    expect(await branches(repo)).toEqual(['coko/agent-commit01', 'main'])
  })

  it.each([
    ['未跟踪文件', async (path: string) => writeFile(join(path, 'scratch.txt'), 's\n')],
    ['已跟踪文件被修改', async (path: string) => writeFile(join(path, 'README.md'), 'changed\n')],
  ])('%s时保留', async (_label, change) => {
    const { repo, service, workspace } = await setup()
    const created = await service.createForSubagent(workspace.id, 'dirty001')
    await change(created.path)
    expect((await service.removeIfUnchanged(created.id)).removed).toBe(false)
    expect(await exists(created.path)).toBe(true)
    expect(await branches(repo)).toEqual(['coko/agent-dirty001', 'main'])
  })

  it('同一子 Session id 的名字冲突时换一个名字（不报 worktree-exists）', async () => {
    const { service, workspace } = await setup()
    const a = await service.createForSubagent(workspace.id, 'same0000')
    const b = await service.createForSubagent(workspace.id, 'same0000')
    expect(a.name).toBe('agent-same0000')
    expect(b.name).toMatch(/^agent-same0000-[0-9a-f]{4}$/)
  })
})

describe('WorktreeService 创建与工作目录', REAL_GIT_BUDGET, () => {
  it.each(['../x', 'a/b', 'Upper', 'x'.repeat(65), '.hidden', '-dash', 'a..b', 'end.', 'x.lock', ''])('非法 name %j', (name) => {
    expect(validWorktreeName(name)).toBe(false)
  })

  it.each(['a', 'feat-1', 'v1.2_x', 'x'.repeat(64)])('合法 name %j', (name) => {
    expect(validWorktreeName(name)).toBe(true)
  })

  it('Workspace 为仓库子目录：工作目录为 worktree 中的对应子目录', async () => {
    const { store, service, workspace, sessions } = await setup({ workspaceDir: 'pkg' })
    const created = await service.create(workspace.id, { name: 'sub' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id, worktreeId: created.id })
    expect(await service.cwd.resolve(session, workspace)).toBe(join(created.path, 'pkg'))
    expect(await sessions.list()).toEqual([expect.objectContaining({ id: session.id, cwd: join(created.path, 'pkg') })])
    expect(await readdir(join(created.path, 'pkg'))).toEqual(['a.txt'])
  })

  it('对手用例：git 报告的仓库根经过符号链接（祖先是链接）时 unsafe-worktree-path，链接目标下没有新文件', async () => {
    // 假的 rev-parse --show-toplevel 返回经链接的路径；其余调用交给真实 git。
    let link = ''
    const { repo, service, workspace } = await setup({
      git: (real) => ({
        run: (request) =>
          request.args.join(' ') === 'rev-parse --show-toplevel' ? Promise.resolve({ exitCode: 0, stdout: `${link}\n`, stderr: '' }) : real.run(request),
      }),
    })
    link = join(repo.home, 'linked-repo')
    await symlink(repo.root, link)
    const error = await service.create(workspace.id, { name: 'via-link' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('unsafe-worktree-path')
    expect(await exists(join(repo.root, '.coko-worktrees'))).toBe(false)
    expect(await branches(repo)).toEqual(['main'])
  })

  it('recover：路径已不存在的 active worktree 标为 removed，存在的不变', async () => {
    const { store, service, workspace } = await setup()
    const kept = await service.create(workspace.id, { name: 'kept' })
    const gone = await service.create(workspace.id, { name: 'gone' })
    await rm(gone.path, { recursive: true, force: true })
    expect(await service.recover({ listUnfinishedRuns: async () => [], listLatestEntries: async () => [] })).toBe(1)
    expect((await store.worktrees.list(workspace.id)).map((w) => [w.name, w.status])).toEqual([
      ['kept', 'active'],
      ['gone', 'removed'],
    ])
    expect(kept.status).toBe('active')
  })

  it('recover：子代理派发时创建、还没有子 Session 绑定就崩溃的 worktree 没有改动时回收；用户创建的与有改动的保留', async () => {
    const { store, service, workspace } = await setup()
    const user = await service.create(workspace.id, { name: 'mine' })
    const orphan = await service.createForSubagent(workspace.id, 'orphan01')
    const dirty = await service.createForSubagent(workspace.id, 'dirty002')
    await writeFile(join(dirty.path, 'x.txt'), 'x\n')
    const bound = await service.createForSubagent(workspace.id, 'bound001')
    const parent = await store.sessions.createSession({ workspaceId: workspace.id })
    await store.sessions.createSession({ workspaceId: workspace.id, parentSessionId: parent.id, worktreeId: bound.id })
    await service.recover({ listUnfinishedRuns: async () => [], listLatestEntries: async () => [] })
    expect(Object.fromEntries((await store.worktrees.list(workspace.id)).map((w) => [w.name, w.status]))).toEqual({
      [user.name]: 'active',
      [orphan.name]: 'removed',
      [dirty.name]: 'active',
      [bound.name]: 'active',
    })
    expect(await exists(orphan.path)).toBe(false)
  })
})

describe('WorktreeService.remove 与并发开始的 Run', REAL_GIT_BUDGET, () => {
  /** git worktree remove 停在 gate 上（busy 检查之后、git 之前）；fail 为真时该次 git 失败。 */
  const gated = () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let reached!: () => void
    const atGit = new Promise<void>((resolve) => (reached = resolve))
    const state = { fail: false }
    const git = (real: GitPort): GitPort => ({
      run: async (request) => {
        if (request.args[0] === 'worktree' && request.args[1] === 'remove') {
          reached()
          await gate
          if (state.fail) return { exitCode: 1, stdout: '', stderr: 'fatal: simulated failure' }
        }
        return real.run(request)
      },
    })
    return { git, release, atGit, state }
  }

  it('对手用例：移除停在 busy 检查之后、git 之前时，会话的工作目录解析为 409 worktree-busy（开始 Run 前即失败）；移除后为 worktree-removed', async () => {
    const g = gated()
    const { store, service, workspace, sessions } = await setup({ git: g.git })
    const created = await service.create(workspace.id, { name: 'racing' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id, worktreeId: created.id })
    const removing = service.remove(created.id)
    await g.atGit
    try {
      const busy = await service.cwd.resolve(session, workspace).catch((e: unknown) => e)
      expect(busy).toBeInstanceOf(AppError)
      expect((busy as AppError).code).toBe('worktree-busy')
      expect(await sessions.list()).toEqual([expect.objectContaining({ id: session.id, cwd: created.path })])
    } finally {
      g.release()
      await removing
    }
    expect(await sessions.list()).toEqual([
      expect.objectContaining({ id: session.id, cwd: created.path, worktree: expect.objectContaining({ status: 'removed' }) }),
    ])
    const removed = await service.cwd.resolve(session, workspace).catch((e: unknown) => e)
    expect((removed as AppError).code).toBe('worktree-removed')
  })

  it('git 失败时撤销登记：会话的工作目录照常解析（可以再提交），记录仍为 active', async () => {
    const g = gated()
    g.state.fail = true
    const { store, service, workspace } = await setup({ git: g.git })
    const created = await service.create(workspace.id, { name: 'fails' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id, worktreeId: created.id })
    const removing = service.remove(created.id).catch((e: unknown) => e)
    await g.atGit
    g.release()
    expect(await removing).toBeInstanceOf(Error)
    expect(await service.cwd.resolve(session, workspace)).toBe(created.path)
    expect((await store.worktrees.get(created.id))?.status).toBe('active')
  })
})

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createModelRegistry, InMemoryCredentialStore, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { expect, it, onTestFinished } from 'vitest'
import { installFauxProvider } from '../adapters/faux.ts'
import { SessionService } from './sessions.ts'
import { SessionHub } from './hub.ts'
import { createGitRunner } from '../adapters/git.ts'
import { BranchService } from './branches.ts'

it('directory admission lease covers async Git and releases after failure; primary uses explicit Workspace and busy child cwd survives changed membership', async () => {
  const base = await mkdtemp(join(tmpdir(), 'coko-branch-lease-'))
  onTestFinished(() => rm(base, { recursive: true, force: true }))
  const home = join(base, 'home'),
    cwd = join(base, 'repo')
  await mkdir(home)
  await mkdir(cwd)
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@coko.test',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@coko.test',
  }
  const exec = promisify(execFile)
  const git = async (...args: string[]) => (await exec('git', args, { cwd, env })).stdout
  await git('init', '-q', '-b', 'main')
  await writeFile(join(cwd, 'a'), 'a')
  await git('add', '-A')
  await git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
  await git('branch', 'target')
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: cwd })
  const project = await store.projects.create({ name: 'Fixture', primaryWorkspaceId: workspace.id, additionalFolders: [base] })
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const runner = createGitRunner({ env })
  let hold = true
  const service = new BranchService({
    store,
    git: {
      async run(request) {
        if (request.args[0] === 'switch' && hold) {
          entered()
          await barrier
          return { exitCode: 1, stdout: '', stderr: 'fixture failure' }
        }
        return runner.run(request)
      },
    },
    activity: { cwd: async () => ({ cwd }), busy: () => false, runningJobs: async () => false },
  })
  const registry = createModelRegistry({ credentials: new InMemoryCredentialStore() })
  const script = join(base, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Accepted after lease.' }] }))
  const fallbackModel = await installFauxProvider(registry, script)
  const finished: Promise<unknown>[] = []
  const sessionService = new SessionService({
    store,
    registry,
    fallbackModel,
    hub: new SessionHub(),
    runs: {
      launch: (_key, done) => {
        finished.push(done)
      },
    },
  })
  sessionService.runs.useDirectoryAdmission(service.assertAdmission)
  const changing = service.checkout(project.id, { name: 'target' })
  await reached
  expect(() => service.assertAdmission(cwd)).toThrow('changing branches')
  const future = await sessionService.createRecord({ workspaceId: workspace.id })
  await expect(sessionService.submit(future.id, 'During checkout')).rejects.toMatchObject({ code: 'session-busy' })
  expect(await store.sessions.listEntries(future.id)).toEqual([])
  expect(() => service.assertAdmission(join(base, 'other'))).not.toThrow()
  release()
  await expect(changing).rejects.toMatchObject({ code: 'invalid-transition' })
  expect(() => service.assertAdmission(cwd)).not.toThrow()
  await sessionService.submit(future.id, 'After checkout failure')
  await Promise.all(finished)
  expect((await store.sessions.listEntries(future.id)).some((entry) => entry.kind === 'run_end')).toBe(true)
  expect((await git('branch', '--show-current')).trim()).toBe('main')
  hold = false
  await service.checkout(project.id, { name: 'target' })
  expect((await git('branch', '--show-current')).trim()).toBe('target')
  const parent = await store.sessions.createSession({ workspaceId: workspace.id, projectId: null })
  const child = await store.sessions.createSession({ workspaceId: workspace.id, parentSessionId: parent.id })
  const busy = new BranchService({
    store,
    git: runner,
    activity: { cwd: async () => ({ cwd }), busy: (id) => id === child.id, runningJobs: async () => false },
  })
  await expect(busy.checkout(project.id, { name: 'main' })).rejects.toMatchObject({
    code: 'session-busy',
    details: { reasons: ['agent'], sessions: [{ id: child.id, title: '' }] },
  })
  expect((await git('branch', '--show-current')).trim()).toBe('target')
  const missing = new BranchService({
    store,
    git: {
      run: async () => {
        throw Object.assign(new Error('missing Git'), { code: 'ENOENT' })
      },
    },
    activity: { cwd: async () => ({ cwd }), busy: () => false, runningJobs: async () => false },
  })
  expect(await missing.list(project.id)).toEqual({ available: false, reason: 'git-unavailable', branches: [] })
}, 20_000)

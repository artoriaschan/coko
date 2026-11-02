import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, schedulePaths, jobPaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, connect, exchange, fauxScript, waitApproval, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

async function boot(responses: unknown[] = []) {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  const scratch = await tempDir()
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...fixture.env, COKO_FAUX_SCRIPT: await fauxScript(scratch, { responses }) } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects.find((p: { primaryWorkspaceId: string }) => p.primaryWorkspaceId === workspace.id)
  return { fixture, sidecar, api, cookie, workspace, path: `/api/projects/${project.id}/branches` }
}

it('CW-77: local branches current first, safe create/checkout, duplicate preserves commit, invalid refs never become options, global prefix', async () => {
  const h = await boot()
  await h.fixture.git('branch', 'older')
  const older = (await h.fixture.git('rev-parse', 'older')).trim()
  await promisify(execFile)('git', ['commit', '--allow-empty', '-qm', 'recent'], {
    cwd: h.fixture.root,
    env: { PATH: process.env.PATH, ...h.fixture.env, GIT_COMMITTER_DATE: '2026-02-01T00:00:00Z' },
  })
  await h.fixture.git('branch', 'recent')
  await h.fixture.git('update-ref', 'refs/remotes/origin/remote-only', 'HEAD')
  expect((await h.api.get(h.path)).body).toMatchObject({
    available: true,
    current: 'main',
    branches: [{ name: 'main' }, { name: 'recent' }, { name: 'older' }],
  })
  const before = (await h.fixture.git('rev-parse', 'HEAD')).trim()
  expect((await h.api.post(h.path, { name: 'feature/new', create: true })).status).toBe(200)
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('feature/new')
  expect((await h.api.post(h.path, { name: 'older', create: true })).body.error.code).toBe('already-exists')
  expect((await h.fixture.git('rev-parse', 'HEAD')).trim()).toBe(before)
  expect((await h.fixture.git('rev-parse', 'older')).trim()).toBe(older)
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('feature/new')
  for (const name of ['-B', 'bad..name', 'bad name', 'prefix/', 'a/.hidden', 'a.lock', '@', 'HEAD', 'x@{y']) {
    expect((await h.api.post(h.path, { name, create: true })).body.error.code).toBe('invalid-name')
  }
  expect((await h.api.post(h.path, { name: 'older' })).status).toBe(200)
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('older')
  expect((await h.api.put('/api/settings/git.branchPrefix', { value: 42, expectedRevision: 0 })).status).toBe(400)
  expect((await h.api.put('/api/settings/git.branchPrefix', { value: 'team/', expectedRevision: 0 })).status).toBe(200)
  expect((await h.api.get('/api/settings')).body.settings).toContainEqual(expect.objectContaining({ key: 'git.branchPrefix', value: 'team/' }))
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('CW-64: dirty rejection preserves original branch and files; non-Git primary returns unavailable', async () => {
  const h = await boot()
  await h.fixture.git('branch', 'other')
  await writeFile(join(h.fixture.root, 'untracked.txt'), 'preserved')
  const dirty = await h.api.post(h.path, { name: 'other' })
  expect([dirty.status, dirty.body.error.code, dirty.body.error.details]).toEqual([409, 'git-dirty', { files: ['untracked.txt'], count: 1 }])
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('main')
  const plain = (await h.api.post(API_ROUTES.workspaces, { path: await tempDir() })).body
  const project = (await h.api.get(API_ROUTES.projects)).body.projects.find((p: { primaryWorkspaceId: string }) => p.primaryWorkspaceId === plain.id)
  expect((await h.api.get(`/api/projects/${project.id}/branches`)).body).toEqual({ available: false, reason: 'not-a-git-repo', branches: [] })
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('CW-64: busy Run rejects checkout, including a session moved outside the project; enabled Schedule also rejects', async () => {
  const h = await boot([{ content: [{ type: 'toolCall', id: 'wait', name: 'bash', arguments: { command: 'echo approval' } }] }, { content: 'done' }])
  await h.fixture.git('branch', 'other')
  const session = (await h.api.post(API_ROUTES.sessions, { workspaceId: h.workspace.id })).body
  const stream = await connect(h.sidecar, h.cookie)
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  expect((await h.api.post(apiPaths.sessionMessages(session.id), { text: 'wait' })).status).toBe(202)
  await waitApproval(stream, session.id, 1)
  const busy = await h.api.post(h.path, { name: 'other' })
  expect([busy.status, busy.body.error.code, busy.body.error.details]).toEqual([
    409,
    'session-busy',
    { reasons: ['run'], sessions: [{ id: session.id, title: '' }] },
  ])
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('main')
  await h.api.post(apiPaths.sessionAbort(session.id), {})
  await stream.waitFor(() => stream.entries(session.id).some((e) => e.kind === 'run_end'))
  const schedule = await h.api.post(schedulePaths.sessionSchedules(session.id), {
    title: 'Future task',
    prompt: 'later',
    rule: { kind: 'every', seconds: 3600 },
  })
  expect(schedule.status).toBe(201)
  const scheduled = await h.api.post(h.path, { name: 'other' })
  expect(scheduled.body.error.details.reasons).toEqual(['schedule'])
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('main')
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('running background Job rejects checkout after its Run ends', async () => {
  const h = await boot([
    { content: [{ type: 'toolCall', id: 'job', name: 'bash', arguments: { command: 'sleep 60', run_in_background: true } }] },
    { content: 'started' },
  ])
  await h.fixture.git('branch', 'other')
  const session = (await h.api.post(API_ROUTES.sessions, { workspaceId: h.workspace.id })).body
  await h.api.put(permissionPaths.sessionPermissionMode(session.id), { mode: 'full-access' })
  const stream = await connect(h.sidecar, h.cookie)
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await h.api.post(apiPaths.sessionMessages(session.id), { text: 'start' })
  await stream.waitFor(() => stream.entries(session.id).some((e) => e.kind === 'run_end'))
  const busy = await h.api.post(h.path, { name: 'other' })
  expect(busy.body.error.details.reasons).toEqual(['job'])
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('main')
  const jobs = (await h.api.get(jobPaths.sessionJobs(session.id))).body.jobs
  await h.api.post(jobPaths.kill(jobs[0].jobId))
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('an archived root with a schedule enabled externally still blocks checkout of its fixed cwd', async () => {
  const h = await boot()
  await h.fixture.git('branch', 'other')
  const session = (await h.api.post(API_ROUTES.sessions, { workspaceId: h.workspace.id })).body
  expect((await h.api.post(`/api/sessions/${session.id}/archive`, {})).status).toBe(200)
  expect((await h.api.get(API_ROUTES.sessions)).body.sessions).toEqual([])
  expect(
    (await h.api.post(`/api/sessions/${session.id}/schedules`, { title: 'legacy schedule', prompt: 'later', rule: { kind: 'every', seconds: 600 } })).status,
  ).toBe(201)
  const busy = await h.api.post(h.path, { name: 'other' })
  expect(busy.status).toBe(409)
  expect(busy.body.error).toMatchObject({ code: 'session-busy', details: { reasons: ['schedule'] } })
  expect((await h.fixture.git('branch', '--show-current')).trim()).toBe('main')
})

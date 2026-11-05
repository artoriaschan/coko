import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, schedulePaths, worktreePaths, jobPaths } from '@coko/protocol'
import { bootAgents, call, starts, runEnds } from './sidecar-subagents-harness.ts'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, connect, isRunEnd, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('deletes a session tree atomically and persists deletion while preserving workspace files', async () => {
  const env = await bootAgents([
    { match: 'PARENT-DELETE', content: [call('agent', 'a', { description: 'child', prompt: 'CHILD-DELETE', subagent_type: 'general' })] },
    { match: 'CHILD-DELETE', content: 'Child done.' },
    { match: 'PARENT-DELETE', content: 'Done.' },
  ])
  await writeFile(join(env.wsPath, 'source.txt'), 'user source')
  const parent = await env.open()
  await env.submit(parent, 'PARENT-DELETE')
  await env.stream.waitFor(() => runEnds(env.stream, parent).length === 1)
  const child = starts(env.stream, parent)[0]!.agentId
  expect((await env.api.get(apiPaths.session(child))).status).toBe(200)
  for (const id of [parent, child])
    for (const kind of ['attachments', 'tool-results']) {
      await mkdir(join(env.dirs.dataDir, kind, id), { recursive: true })
      await writeFile(join(env.dirs.dataDir, kind, id, 'owned.txt'), 'owned')
    }
  await expect.poll(async () => (await env.api.delete(apiPaths.session(parent))).status).toBe(200)
  expect((await env.api.get(apiPaths.session(parent))).status).toBe(404)
  expect((await env.api.get(apiPaths.session(child))).status).toBe(404)
  expect((await env.api.get(API_ROUTES.sessions)).body.sessions).toEqual([])
  for (const id of [parent, child])
    for (const kind of ['attachments', 'tool-results']) await expect(access(join(env.dirs.dataDir, kind, id))).rejects.toThrow(/ENOENT/)
  expect(await readFile(join(env.wsPath, 'source.txt'), 'utf8')).toBe('user source')
  await env.sidecar.stop()
  const second = await startSidecar({ dirs: env.dirs })
  const after = client(second, await exchange(second))
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toEqual([])
  expect((await after.get(API_ROUTES.workspaces)).body.workspaces).toHaveLength(1)
})

it('retains bound worktree records and files, removes schedules, and retains standalone directories', async () => {
  const repo = await createGitWorkspace()
  onTestFinished(() => repo.dispose())
  const root = await tempDir()
  const sidecar = await startSidecar({
    dirs: await sidecarDirs(),
    env: { ...repo.env, COKO_CHATS_ROOT: join(root, 'chats'), COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [{ content: 'Ready.' }] }) },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: repo.root })).body
  const worktree = (await api.post(worktreePaths.workspaceWorktrees(workspace.id), { name: 'retained' })).body
  await writeFile(join(worktree.path, 'user.txt'), 'retained worktree')
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id, worktreeId: worktree.id })).body
  const schedule = await api.post(schedulePaths.sessionSchedules(session.id), { title: 'Future', prompt: 'later', rule: { kind: 'every', seconds: 600 } })
  expect(schedule.status).toBe(201)
  expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
  expect((await api.get(schedulePaths.list())).body).toEqual([])
  expect((await api.get(worktreePaths.workspaceWorktrees(workspace.id))).body).toEqual([
    expect.objectContaining({ id: worktree.id, status: 'active', sessionCount: 0 }),
  ])
  expect(await readFile(join(worktree.path, 'user.txt'), 'utf8')).toBe('retained worktree')
  const created = (await api.post(API_ROUTES.firstSend, { draftId: 'standalone', text: 'hello' })).body
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId: created.session.id, afterSeq: 0 })
  await stream.waitFor(isRunEnd(created.session.id))
  const path = (await api.get(API_ROUTES.workspaces)).body.workspaces.find((w: { id: string }) => w.id === created.session.workspaceId).path
  await writeFile(join(path, 'keep.txt'), 'standalone content')
  await expect.poll(async () => (await api.delete(apiPaths.session(created.session.id))).status).toBe(200)
  expect(await readFile(join(path, 'keep.txt'), 'utf8')).toBe('standalone content')
})

it('refuses active root Runs and background agents with typed distinct reasons without changing entries', async () => {
  const env = await bootAgents([
    { match: 'ROOT', content: [call('write', 'write', { path: 'blocked.txt', content: 'no' })] },
    { match: 'PARENT', content: [call('agent', 'agent', { description: 'bg', prompt: 'CHILD work', subagent_type: 'general', run_in_background: true })] },
    { match: 'PARENT', content: 'Parent done.' },
    { match: 'CHILD', content: [call('write', 'child-write', { path: 'child-blocked.txt', content: 'no' })] },
  ])
  const root = await env.open('default')
  await env.submit(root, 'ROOT')
  await expect
    .poll(async () => (await env.api.get(apiPaths.session(root))).body.entries.some((entry: { kind: string }) => entry.kind === 'approval_request'))
    .toBe(true)
  const before = (await env.api.get(apiPaths.session(root))).body
  const rejected = await env.api.delete(apiPaths.session(root))
  expect(rejected.status).toBe(409)
  expect(rejected.body.error).toMatchObject({ code: 'session-busy', details: { reasons: ['run'], sessions: [{ id: root, title: before.session.title }] } })
  expect((await env.api.get(apiPaths.session(root))).body.entries).toEqual(before.entries)
  await env.api.post(apiPaths.sessionAbort(root), {})
  const parent = await env.open('default')
  await env.submit(parent, 'PARENT')
  await env.stream.waitFor(() => runEnds(env.stream, parent).length === 1 && starts(env.stream, parent).length === 1)
  const child = starts(env.stream, parent)[0]!.agentId
  await expect
    .poll(async () => (await env.api.get(apiPaths.session(child))).body.entries.some((entry: { kind: string }) => entry.kind === 'approval_request'))
    .toBe(true)
  const agentBusy = await env.api.delete(apiPaths.session(parent))
  expect(agentBusy.status).toBe(409)
  expect(agentBusy.body.error).toMatchObject({ code: 'session-busy', details: { reasons: ['agent'], sessions: [{ id: child }] } })
  expect((await env.api.get(apiPaths.session(parent))).status).toBe(200)
  expect((await env.api.get(apiPaths.session(child))).status).toBe(200)
})

it('refuses a running background Job after the parent Run ends', async () => {
  const env = await bootAgents([{ content: [call('bash', 'job', { command: 'sleep 60', run_in_background: true })] }, { content: 'Started.' }])
  const id = await env.open('full-access')
  await env.submit(id, 'job')
  await env.stream.waitFor(() => runEnds(env.stream, id).length === 1)
  const before = (await env.api.get(apiPaths.session(id))).body
  const rejected = await env.api.delete(apiPaths.session(id))
  expect(rejected.status).toBe(409)
  expect(rejected.body.error).toMatchObject({ code: 'session-busy', details: { reasons: ['job'], sessions: [{ id }] } })
  expect((await env.api.get(apiPaths.session(id))).body.entries).toEqual(before.entries)
  const job = before.entries.find((entry: { kind: string }) => entry.kind === 'job_start').payload.jobId
  expect((await env.api.post(jobPaths.kill(job))).status).toBe(204)
  await expect.poll(async () => (await env.api.delete(apiPaths.session(id))).status).toBe(200)
})

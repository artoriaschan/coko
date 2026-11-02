import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, schedulePaths, jobPaths, worktreePaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, exchange, sidecarDirs, startSidecar } from './sidecar-harness.ts'
import { bootAgents, call, starts, runEnds } from './sidecar-subagents-harness.ts'

it('archives the whole tree, excludes normal lists, clears pins and restores project membership', async () => {
  const env = await bootAgents([
    { match: 'PARENT', content: [call('agent', 'a', { description: 'child', prompt: 'CHILD', subagent_type: 'general' })] },
    { match: 'CHILD', content: 'Child done.' },
    { match: 'PARENT', content: 'Done.' },
  ])
  const id = await env.open()
  await env.api.put(apiPaths.sessionPin(id), { pinned: true })
  await env.submit(id, 'PARENT')
  await env.stream.waitFor(() => runEnds(env.stream, id).length === 1)
  const child = starts(env.stream, id)[0]!.agentId
  const before = (await env.api.get(apiPaths.session(id))).body
  await expect.poll(async () => (await env.api.post(`/api/sessions/${id}/archive`, {})).status).toBe(200)
  expect((await env.api.get(API_ROUTES.sessions)).body.sessions).toEqual([])
  const archived = (await env.api.get('/api/sessions?archived=true')).body.sessions
  expect(archived).toEqual([expect.objectContaining({ id, pinnedAt: null, archivedAt: expect.any(Number), projectId: before.session.projectId })])
  expect((await env.api.get(apiPaths.session(child))).body.session.archivedAt).toBe(archived[0].archivedAt)
  expect((await env.api.get(apiPaths.session(id))).body.entries).toEqual(before.entries)
  for (const action of ['messages', 'retry', 'continue']) {
    const response = await env.api.post(`/api/sessions/${id}/${action}`, action === 'messages' ? { text: '/goal start' } : {})
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('session-archived')
  }
  expect((await env.api.post(`/api/sessions/${id}/restore`, {})).status).toBe(200)
  expect((await env.api.get(API_ROUTES.sessions)).body.sessions).toEqual([
    expect.objectContaining({ id, archivedAt: null, pinnedAt: null, projectId: before.session.projectId }),
  ])
  expect((await env.api.get(apiPaths.session(child))).body.session.archivedAt).toBeNull()
})

it('reports Run, agent, Job and enabled Schedule busy reasons and leaves the conversation unchanged', async () => {
  const env = await bootAgents([
    { match: 'ROOT', content: [call('write', 'w', { path: 'blocked.txt', content: 'no' })] },
    { match: 'PARENT-BUSY', content: [call('agent', 'a', { description: 'bg', prompt: 'CHILD-BUSY', subagent_type: 'general', run_in_background: true })] },
    { match: 'PARENT-BUSY', content: 'Parent done.' },
    { match: 'CHILD-BUSY', content: [call('write', 'cw', { path: 'blocked-child.txt', content: 'no' })] },
    { match: 'JOB', content: [call('bash', 'j', { command: 'sleep 60', run_in_background: true })] },
    { match: 'JOB', content: 'Started.' },
  ])
  const assertBusy = async (id: string, reason: string) => {
    const before = (await env.api.get(apiPaths.session(id))).body
    const response = await env.api.post(apiPaths.sessionArchive(id), {})
    expect(response.status).toBe(409)
    expect(response.body.error).toMatchObject({
      code: 'session-busy',
      details: { reasons: [reason], sessions: [expect.objectContaining({ id: expect.any(String), title: expect.any(String) })] },
    })
    expect((await env.api.get(apiPaths.session(id))).body).toEqual(before)
  }
  const root = await env.open('default')
  await env.submit(root, 'ROOT')
  await expect
    .poll(async () => (await env.api.get(apiPaths.session(root))).body.entries.some((e: { kind: string }) => e.kind === 'approval_request'))
    .toBe(true)
  await assertBusy(root, 'run')
  await env.api.post(apiPaths.sessionAbort(root), {})
  const parent = await env.open('default')
  await env.submit(parent, 'PARENT-BUSY')
  await env.stream.waitFor(() => runEnds(env.stream, parent).length === 1 && starts(env.stream, parent).length === 1)
  await expect
    .poll(async () =>
      (await env.api.get(apiPaths.session(starts(env.stream, parent)[0]!.agentId))).body.entries.some((e: { kind: string }) => e.kind === 'approval_request'),
    )
    .toBe(true)
  await assertBusy(parent, 'agent')
  const job = await env.open('full-access')
  await env.submit(job, 'JOB')
  await env.stream.waitFor(() => runEnds(env.stream, job).length === 1)
  await assertBusy(job, 'job')
  const jobId = (await env.api.get(apiPaths.session(job))).body.entries.find((e: { kind: string }) => e.kind === 'job_start').payload.jobId
  await env.api.post(jobPaths.kill(jobId))
  const scheduled = await env.open()
  await env.api.put(apiPaths.sessionPin(scheduled), { pinned: true })
  expect(
    (await env.api.post(schedulePaths.sessionSchedules(scheduled), { title: 'later', prompt: 'later', rule: { kind: 'every', seconds: 600 } })).status,
  ).toBe(201)
  await assertBusy(scheduled, 'schedule')
})

it('archive preserves worktree and workspace files and archive state survives restart', async () => {
  const repo = await createGitWorkspace()
  onTestFinished(() => repo.dispose())
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs, env: repo.env })
  const api = client(first, await exchange(first))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: repo.root })).body
  const worktree = (await api.post(worktreePaths.workspaceWorktrees(workspace.id), { name: 'archived' })).body
  await writeFile(join(worktree.path, 'retained.txt'), 'worktree file')
  await writeFile(join(repo.root, 'retained.txt'), 'main file')
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id, worktreeId: worktree.id })).body
  expect((await api.post(apiPaths.sessionArchive(session.id), {})).status).toBe(200)
  await first.stop()
  const second = await startSidecar({ dirs, env: repo.env })
  const after = client(second, await exchange(second))
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toEqual([])
  expect((await after.get('/api/sessions?archived=true')).body.sessions).toEqual([
    expect.objectContaining({ id: session.id, archivedAt: expect.any(Number), worktree: expect.objectContaining({ id: worktree.id, status: 'active' }) }),
  ])
  expect((await after.get(worktreePaths.workspaceWorktrees(workspace.id))).body).toEqual([
    expect.objectContaining({ id: worktree.id, status: 'active', sessionCount: 1 }),
  ])
  expect(await readFile(join(worktree.path, 'retained.txt'), 'utf8')).toBe('worktree file')
  expect(await readFile(join(repo.root, 'retained.txt'), 'utf8')).toBe('main file')
})

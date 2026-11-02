import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, jobPaths, memoryPaths, permissionPaths, schedulePaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { advanceClock, client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'
import { bootAgents, call, starts } from './sidecar-subagents-harness.ts'

it('removes project organization after stopping root and background child, preserving their records and unchanged isolated worktree across restart', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  const env = await bootAgents(
    [
      {
        match: 'PARENT-REMOVE',
        content: [
          call('agent', 'a', { description: 'kept child', prompt: 'CHILD-REMOVE', subagent_type: 'general', run_in_background: true, isolation: 'worktree' }),
        ],
      },
      { match: 'CHILD-REMOVE', delayMs: 60_000, content: 'child done' },
      { match: 'PARENT-REMOVE', delayMs: 60_000, content: 'parent done' },
    ],
    { workspace: fixture.root, env: { ...fixture.env, COKO_TEST_CLOCK: '1' } },
  )
  const project = (await env.api.get(API_ROUTES.projects)).body.projects[0]
  const parent = await env.open('full-access')
  await env.api.put(apiPaths.sessionPin(parent), { pinned: true })
  await env.submit(parent, 'PARENT-REMOVE')
  await expect.poll(async () => (await env.requests()).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3)
  const child = starts(env.stream, parent)[0]!.agentId
  const before = (await env.api.get(apiPaths.session(child))).body
  const archived = (
    await env.api.post(API_ROUTES.sessions, { workspaceId: env.workspaceId, worktreeId: before.session.worktree.id, title: 'Archived retained' })
  ).body
  const archiveResponse = await env.api.post(apiPaths.sessionArchive(archived.id))
  expect(archiveResponse.status).toBe(200)
  const archivedAt = archiveResponse.body.archivedAt
  const isolation = (await env.api.get(apiPaths.session(parent))).body.entries.find((entry: { kind: string }) => entry.kind === 'agent_start').payload.isolation
  expect(existsSync(isolation.path)).toBe(true)
  expect((await env.api.delete(apiPaths.project(project.id))).status).toBe(200)
  expect((await env.api.get(API_ROUTES.projects)).body.projects).toEqual([])
  expect((await env.api.get(`${API_ROUTES.sessions}?archived=true`)).body.sessions).toEqual([
    expect.objectContaining({ id: archived.id, projectId: null, archivedAt, worktree: before.session.worktree }),
  ])
  for (const id of [parent, child]) {
    const detail = (await env.api.get(apiPaths.session(id))).body
    expect(detail.session).toMatchObject({ id, projectId: null, running: false })
    expect(detail.entries.some((entry: { kind: string; payload: { status?: string } }) => entry.kind === 'run_end' && entry.payload.status === 'aborted')).toBe(
      true,
    )
  }
  const after = (await env.api.get(apiPaths.session(child))).body
  expect(after.session).toMatchObject({ parentSessionId: parent, worktree: before.session.worktree })
  expect((await env.api.get(apiPaths.session(parent))).body.session.pinnedAt).not.toBeNull()
  expect(existsSync(isolation.path)).toBe(true)
  expect(await fixture.git('branch', '--list')).toContain(isolation.branch)
  expect(await readFile(join(fixture.root, 'notes.txt'), 'utf8')).toBe('NOTES-CONTENT\n')
  await env.sidecar.stop()
  const restarted = await startSidecar({ dirs: env.dirs, env: fixture.env })
  const api = client(restarted, await exchange(restarted))
  expect((await api.get(API_ROUTES.projects)).body.projects).toEqual([])
  expect((await api.get(`${API_ROUTES.sessions}?archived=true`)).body.sessions).toEqual([
    expect.objectContaining({ id: archived.id, projectId: null, archivedAt, worktree: before.session.worktree }),
  ])
  expect((await api.get(apiPaths.session(child))).body.session).toMatchObject({ parentSessionId: parent, projectId: null, worktree: before.session.worktree })
  expect(existsSync(isolation.path)).toBe(true)
})

it('preserves a live background Job that writes after removal, active schedules, Workspace memory and approvals', async () => {
  const env = await bootAgents(
    [
      { match: 'KEEP-APPROVAL', content: [call('bash', 'approved', { command: 'printf approved > approved.txt' })] },
      { match: 'KEEP-APPROVAL', content: 'approved' },
      {
        match: 'JOB-KEEP',
        content: [
          call('bash', 'job', {
            command: `node --input-type=module -e 'import {watch,existsSync,writeFileSync} from "node:fs";const watcher=watch(".",()=>{if(existsSync("release-job")){writeFileSync("after-delete.txt","written after removal");console.log("after removal");watcher.close()}});console.log("ready")'`,
            run_in_background: true,
          }),
        ],
      },
      { match: 'JOB-KEEP', delayMs: 60_000, content: 'waiting' },
      { match: 'PRESERVED-SCHEDULE', content: 'scheduled after removal' },
    ],
    { env: { COKO_TEST_CLOCK: '1' } },
  )
  const project = (await env.api.get(API_ROUTES.projects)).body.projects[0]
  const id = await env.open('default')
  await env.submit(id, 'KEEP-APPROVAL')
  const approval = await waitApproval(env.stream, id)
  expect((await env.api.post(apiPaths.sessionApproval(id, approval.requestId), { decision: 'allow', scope: 'workspace' })).status).toBe(204)
  await env.stream.waitFor(isRunEnd(id))
  expect((await env.api.put(permissionPaths.sessionPermissionMode(id), { mode: 'full-access' })).status).toBe(200)
  const memory = (await env.api.post(memoryPaths.memories, { scope: 'workspace', workspaceId: env.workspaceId, content: 'Keep project knowledge' })).body
  const permissions = (await env.api.get(`${permissionPaths.permissions}?workspaceId=${env.workspaceId}`)).body
  expect(permissions.workspace.rules).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'printf approved > approved.txt' }])
  const schedule = (
    await env.api.post(schedulePaths.sessionSchedules(id), { title: 'keep timer', prompt: 'PRESERVED-SCHEDULE', rule: { kind: 'every', seconds: 60 } })
  ).body
  await env.submit(id, 'JOB-KEEP')
  await expect.poll(async () => (await env.api.get(jobPaths.sessionJobs(id))).body.jobs.length).toBe(1)
  const job = (await env.api.get(jobPaths.sessionJobs(id))).body.jobs[0]
  await expect.poll(async () => (await env.api.get(jobPaths.output(job.jobId))).body.chunk).toContain('ready')
  expect((await env.api.delete(apiPaths.project(project.id))).status).toBe(200)
  expect((await env.api.get(jobPaths.sessionJobs(id))).body.jobs[0]).toMatchObject({ jobId: job.jobId, status: 'running' })
  expect((await env.api.get(schedulePaths.list(id))).body).toContainEqual(schedule)
  expect((await env.api.get(`${memoryPaths.memories}?workspaceId=${env.workspaceId}`)).body.memories).toContainEqual(memory)
  expect((await env.api.get(`${permissionPaths.permissions}?workspaceId=${env.workspaceId}`)).body).toEqual(permissions)
  expect(await readFile(join(env.wsPath, 'approved.txt'), 'utf8')).toBe('approved')
  await writeFile(join(env.wsPath, 'release-job'), 'continue')
  await expect.poll(async () => (await env.api.get(jobPaths.sessionJobs(id))).body.jobs[0].status).toBe('completed')
  expect(await readFile(join(env.wsPath, 'after-delete.txt'), 'utf8')).toBe('written after removal')
  expect((await env.api.get(jobPaths.output(job.jobId))).body.chunk).toContain('after removal')
  await advanceClock(env.api, 60_000)
  await expect
    .poll(async () =>
      (await env.api.get(apiPaths.session(id))).body.entries.some(
        (entry: { kind: string; payload: { status?: string } }) => entry.kind === 'schedule_fire' && entry.payload.status === 'started',
      ),
    )
    .toBe(true)
  await expect.poll(async () => (await env.api.get(apiPaths.session(id))).body.session.running).toBe(false)
  expect((await env.api.get(schedulePaths.list(id))).body[0]).toMatchObject({ id: schedule.id, status: 'active' })
})

it('a slow model cancellation fails without deleting the project; admission is released and retry preserves history', async () => {
  const root = await tempDir()
  const folder = join(root, 'source')
  await mkdir(folder)
  const requests = join(root, 'requests.jsonl')
  const aborted = join(root, 'abort.jsonl')
  const script = await fauxScript(root, {
    requestLog: requests,
    abortLog: aborted,
    responses: [
      { match: 'SLOW-CANCEL', delayMs: 60_000, abortDelayMs: 20_000, content: 'late' },
      { match: 'FAST-CANCEL', delayMs: 60_000, content: 'fast' },
      { match: 'RETRY-AFTER-FAILURE', content: 'ready again' },
    ],
  })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: folder })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body
  const sibling = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id, title: 'Already stopped' })).body
  const outsider = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body
  expect((await api.put(apiPaths.sessionProject(outsider.id), { projectId: null })).status).toBe(200)
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed')
  expect((await api.post(apiPaths.sessionMessages(session.id), { text: 'SLOW-CANCEL' })).status).toBe(202)
  expect((await api.post(apiPaths.sessionMessages(sibling.id), { text: 'FAST-CANCEL' })).status).toBe(202)
  await expect.poll(async () => (await readFile(requests, 'utf8').catch(() => '')).includes('SLOW-CANCEL')).toBe(true)
  const deleting = api.delete(apiPaths.project(project.id))
  void deleting.catch(() => {})
  await expect.poll(async () => (await readFile(aborted, 'utf8').catch(() => '')).length > 0).toBe(true)
  expect((await api.post(apiPaths.sessionMessages(session.id), { text: 'denied during removal' })).status).toBe(409)
  expect((await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).status).toBe(409)
  expect((await api.put(apiPaths.sessionProject(outsider.id), { projectId: project.id })).status).toBe(409)
  expect((await api.put(apiPaths.sessionProject(session.id), { projectId: null })).status).toBe(409)
  await advanceClock(api, 10_001)
  expect(await deleting).toMatchObject({ status: 409, body: { error: { details: { reason: 'stop-failed' } } } })
  expect((await api.get(API_ROUTES.projects)).body.projects.map((item: { id: string }) => item.id)).toContain(project.id)
  expect((await api.get(apiPaths.session(session.id))).body.session.projectId).toBe(project.id)
  const stoppedSibling = (await api.get(apiPaths.session(sibling.id))).body
  expect(stoppedSibling.session).toMatchObject({ projectId: project.id, running: false })
  expect(stoppedSibling.entries.filter((entry: { kind: string }) => entry.kind === 'run_start')).toHaveLength(1)
  await advanceClock(api, 10_000)
  await stream.waitFor(isRunEnd(session.id))
  expect((await api.post(apiPaths.sessionMessages(session.id), { text: 'RETRY-AFTER-FAILURE' })).status).toBe(202)
  await expect.poll(async () => (await api.get(apiPaths.session(session.id))).body.session.running).toBe(false)
  expect((await api.delete(apiPaths.project(project.id))).status).toBe(200)
  const after = (await api.get(apiPaths.session(session.id))).body
  expect(after.session.projectId).toBeNull()
  expect(after.entries.filter((entry: { kind: string }) => entry.kind === 'run_end')).toHaveLength(2)
})

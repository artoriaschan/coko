// Global status is observed without subscribing to the Session; entries/API remain the source of completion facts.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, agentPaths, teamPaths, jobPaths, type ServerMessage, type Session } from '@coko/protocol'
import { client, exchange, killAndRestart, tempDir } from './sidecar-harness.ts'
import { bootAgents, call } from './sidecar-subagents-harness.ts'

type Status = Extract<ServerMessage, { type: 'session_status' }>
const statuses = (messages: ServerMessage[], id: string) => messages.filter((m): m is Status => m.type === 'session_status' && m.sessionId === id)
const gate = (path: string) => call('bash', 'gate-' + path.split('/').pop(), { command: "until [ -f '" + path + "' ]; do sleep 0.05; done" })
const detail = async (api: Awaited<ReturnType<typeof bootAgents>>['api'], id: string) => (await api.get(apiPaths.session(id))).body
async function waitIdle(api: Awaited<ReturnType<typeof bootAgents>>['api'], id: string, runs = 1) {
  await expect.poll(async () => (await detail(api, id)).entries.filter((e: { kind: string }) => e.kind === 'run_end').length, { timeout: 20000 }).toBe(runs)
}

describe('Session status broadcasts', () => {
  it('broadcasts Run start and end to a connection that never subscribed', async () => {
    const { api, stream, workspaceId, submit } = await bootAgents([{ content: 'done' }])
    const id = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await submit(id, 'finish')
    await expect
      .poll(async () => (await api.get(apiPaths.session(id))).body.entries.some((e: { kind: string }) => e.kind === 'run_end'), { timeout: 20000 })
      .toBe(true)
    const observed = statuses(stream.messages, id)
    expect(observed).toEqual([
      { type: 'session_status', sessionId: id, running: true, agentsRunning: false },
      { type: 'session_status', sessionId: id, running: false, agentsRunning: false },
    ])
    expect(stream.entries(id)).toEqual([])
  })

  it('keeps the root busy while a background Subagent waits for approval, clears on cancel, and restarts idle', async () => {
    const env = await bootAgents([
      { match: 'ROOT', content: [call('agent', 'a', { description: 'write', prompt: 'CHILD write', subagent_type: 'general', run_in_background: true })] },
      { match: 'CHILD', content: [call('write', 'w', { path: 'out.txt', content: 'x' })] },
      { match: 'ROOT', content: 'dispatched' },
      {
        match: 'ROOT2',
        content: [call('agent', 'a2', { description: 'write again', prompt: 'CHILD2 write', subagent_type: 'general', run_in_background: true })],
      },
      { match: 'CHILD2', content: [call('write', 'w2', { path: 'out2.txt', content: 'x' })] },
      { match: 'ROOT2', content: 'dispatched again' },
    ])
    const { api, stream, workspaceId, submit } = env
    const id = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await submit(id, 'ROOT delegate')
    await waitIdle(api, id)
    await expect.poll(() => statuses(stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: true })
    const agents = (await api.get(agentPaths.sessionAgents(id))).body as { agentId: string }[]
    const child = agents[0]!.agentId
    await expect.poll(async () => (await detail(api, child)).session.activity).toBe('awaiting-approval')
    expect((await detail(api, id)).session).toMatchObject({ running: false, agentsRunning: true })
    const listed = (await api.get(API_ROUTES.sessions)).body.sessions as Session[]
    expect(listed.find((s) => s.id === id)).toMatchObject({ running: false, agentsRunning: true })
    expect(statuses(stream.messages, id).map(({ running, agentsRunning }) => [running, agentsRunning])).toEqual([
      [true, false],
      [true, true],
      [false, true],
    ])
    await api.post(agentPaths.cancel(id, child), {})
    await expect.poll(() => statuses(stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: false })
    expect(stream.messages.filter((m) => m.type === 'session_status' && m.sessionId !== id)).toEqual([])
    await submit(id, 'ROOT2 delegate again')
    await waitIdle(api, id, 2)
    await expect.poll(() => statuses(stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: true })
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs })
    const restoredApi = client(restarted, await exchange(restarted))
    expect((await detail(restoredApi, id)).session).toMatchObject({ running: false })
    expect((await detail(restoredApi, id)).session.agentsRunning ?? false).toBe(false)
  })

  it('counts Teammate Runs, excludes idle Teammates, and broadcasts each rearm', async () => {
    const root = await tempDir()
    // Each response is consumed once. File gates keep the two child Runs observably alive.
    const firstGate = join(root, 'first-gate')
    const secondGate = join(root, 'second-gate')
    const h = await bootAgents([
      { match: 'ROOT1', content: [call('agent', 'a', { description: 'review', prompt: 'MATE work', subagent_type: 'general', name: 'reviewer' })] },
      { match: 'MATE', content: [gate(firstGate)] },
      { match: 'ROOT1', content: 'dispatched' },
      { match: 'MATE', content: 'first done' },
      { match: 'ROOT2', content: [call('send_message', 's', { to: 'reviewer', message: 'PING again' })] },
      { match: 'PING', content: [gate(secondGate)] },
      { match: 'ROOT2', content: 'sent' },
      { match: 'PING', content: 'second done' },
    ])
    const id = await h.open('full-access')
    await h.submit(id, 'ROOT1 start')
    await waitIdle(h.api, id)
    await expect.poll(() => statuses(h.stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: true })
    await writeFile(firstGate, 'open')
    await expect.poll(() => statuses(h.stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: false })
    expect((await h.api.get(teamPaths.team(id))).body.members[0].status).toBe('idle')
    await h.submit(id, 'ROOT2 ask again')
    await waitIdle(h.api, id, 2)
    await expect.poll(() => statuses(h.stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: true })
    await writeFile(secondGate, 'open')
    await expect.poll(() => statuses(h.stream.messages, id).at(-1)).toMatchObject({ running: false, agentsRunning: false })
    const observed = statuses(h.stream.messages, id)
    expect(observed.map(({ running, agentsRunning }) => [running, agentsRunning])).toEqual([
      [true, false],
      [true, true],
      [false, true],
      [false, false],
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ])
    const runEnd = h.stream.messages.findIndex((m) => m.type === 'progress' && m.sessionId === id && m.event.type === 'run_end')
    const endStatus = h.stream.messages.findIndex((m) => m.type === 'session_status' && m.sessionId === id && !m.running)
    expect(endStatus).toBeGreaterThan(runEnd)
  })

  it('does not count a surviving Background Job and emits no duplicate idle status when it completes', async () => {
    const root = await tempDir()
    const jobGate = join(root, 'job-gate')
    const h = await bootAgents([
      { content: [call('bash', 'bg', { command: "until [ -f '" + jobGate + "' ]; do sleep 0.05; done", run_in_background: true })] },
      { content: 'job dispatched' },
    ])
    const id = await h.open('full-access')
    await h.submit(id, 'start background job')
    await waitIdle(h.api, id)
    const jobs = (await h.api.get(jobPaths.sessionJobs(id))).body.jobs as { jobId: string; status: string }[]
    expect(jobs[0]!.status).toBe('running')
    expect((await detail(h.api, id)).session.agentsRunning ?? false).toBe(false)
    await writeFile(jobGate, 'open')
    await expect.poll(async () => (await h.api.get(jobPaths.sessionJobs(id))).body.jobs[0].status).toBe('completed')
    expect(statuses(h.stream.messages, id).map(({ running, agentsRunning }) => [running, agentsRunning])).toEqual([
      [true, false],
      [false, false],
    ])
  })
})

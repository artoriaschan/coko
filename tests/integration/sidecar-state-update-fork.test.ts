// Fork copies State Update provenance with its message, while domain state remains Session-owned.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { pairedStateUpdates } from '@coko/agent/entries'
import { API_ROUTES, apiPaths, checkpointPaths, goalPaths, type SessionEntryRecord } from '@coko/protocol'
import { DATE_TEST_ENV } from './date-state-fixture.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const role = (entry: SessionEntryRecord) => (entry.payload as { role?: string }).role
const text = (entry: SessionEntryRecord) => JSON.stringify((entry.payload as { content?: unknown }).content)

it('assistant/user forks preserve only paired updates and clear inherited Goal/Todo snapshots on the first Run', async () => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      {
        content: [
          call('todo_write', 'todo', { items: [{ content: 'source task', status: 'pending' }] }),
          call('create_goal', 'create', { objective: 'source goal', criteria: ['done'], budget: { max_rounds: 1 } }),
        ],
      },
      { content: 'seeded' },
      { content: 'round finished' },
      { content: 'snapshot answer' },
      { content: 'boundary answer' },
      { content: 'assistant fork answer' },
      { content: 'user fork answer' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...DATE_TEST_ENV, COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  const entries = async (id: string) => (await api.get(apiPaths.session(id))).body.entries as SessionEntryRecord[]
  const subscribe = async (id: string) => {
    stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
    await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === id)
  }
  const send = async (id: string, input: string) => {
    const run = await api.post(apiPaths.sessionMessages(id), { text: input })
    expect(run.status).toBe(202)
    await stream.waitFor(() => stream.entries(id).some((entry) => entry.kind === 'run_end' && entry.runId === run.body.runId))
    return run.body.runId as string
  }
  await subscribe(sessionId)
  await send(sessionId, 'seed the source')
  await stream.waitFor(() =>
    stream.entries(sessionId).some((entry) => entry.kind === 'goal' && (entry.payload as { phase: string }).phase === 'budget-exhausted'),
  )
  await stream.waitFor(() => stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length === 2)
  expect((await api.get(goalPaths.sessionGoal(sessionId))).body.goal).toMatchObject({ phase: 'budget-exhausted' })
  await send(sessionId, 'snapshot')
  await send(sessionId, 'boundary')
  const source = await entries(sessionId)
  const snapshotInput = source.find((entry) => entry.kind === 'message' && role(entry) === 'user' && text(entry).includes('snapshot'))!
  const snapshotReply = source.find((entry) => entry.kind === 'message' && role(entry) === 'assistant' && text(entry).includes('snapshot answer'))!
  const boundaryInput = source.find((entry) => entry.kind === 'message' && role(entry) === 'user' && text(entry).includes('boundary'))!
  const early = await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: snapshotInput.seq })
  expect(early.status).toBe(201)
  const earlyUpdates = (await entries(early.body.sessionId)).filter((entry) => entry.kind === 'state_update')
  expect(earlyUpdates.map((entry) => (entry.payload as { name: string }).name)).toEqual(['date', 'goal', 'todo_list'])
  expect(earlyUpdates.find((entry) => (entry.payload as { name: string }).name === 'goal')!.payload).toMatchObject({ value: { phase: 'running' } })

  for (const [boundary, targetSeq] of [
    ['assistant-inclusive', snapshotReply.seq],
    ['user-before', boundaryInput.seq],
  ] as const) {
    const fork = await api.post(checkpointPaths.sessionFork(sessionId), { boundary, targetSeq })
    expect(fork.status).toBe(201)
    const id = fork.body.sessionId as string
    const copied = await entries(id)
    const updates = copied.filter((entry) => entry.kind === 'state_update')
    expect(updates.map((entry) => (entry.payload as { name: string }).name)).toEqual(['date', 'goal', 'todo_list', 'goal'])
    expect([...pairedStateUpdates(copied).values()].flatMap((pairs) => pairs.map((pair) => pair.entry))).toEqual(updates)
    expect(copied.filter((entry) => ['goal', 'todo_list'].includes(entry.kind))).toEqual([])
    expect((await api.get(goalPaths.sessionGoal(id))).body).toEqual({ goal: null, usage: { rounds: 0 } })
    await subscribe(id)
    const runId = await send(id, 'continue the fork')
    const delivered = (await entries(id)).filter((entry) => entry.runId === runId && entry.kind === 'state_update')
    expect(delivered.map((entry) => entry.payload)).toEqual([
      { name: 'goal', value: null },
      { name: 'todo_list', value: null },
    ])
    const requests = (await readFile(requestLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { role: string; content?: unknown }[])
    const input = requests
      .at(-1)!
      .filter((message) => message.role === 'user')
      .at(-1)!
    expect(input.content).toEqual([
      {
        type: 'text',
        text: '<state_update name="goal">\nThis item currently has no content. Previous updates with this name no longer apply.\n</state_update>',
      },
      {
        type: 'text',
        text: '<state_update name="todo_list">\nThis item currently has no content. Previous updates with this name no longer apply.\n</state_update>',
      },
      { type: 'text', text: 'continue the fork' },
    ])
  }
  expect(await entries(sessionId)).toEqual(source)
  expect(stream.invalidEntries).toEqual([])
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})

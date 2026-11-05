// State Update delivery on continue, driven through a real Sidecar and its HTTP/WS interfaces.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, goalPaths, hookPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

type LoggedMessage = { role: string; content?: { type: string; text?: string }[] }
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const barrier = (id: string) => call('bash', id, { command: `while [ ! -f ${id}.release ]; do sleep 0.02; done; echo released` })
const role = (entry: SessionEntryRecord) => (entry.kind === 'message' ? (entry.payload as { role: string }).role : entry.kind)

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  const entries = () => stream.entries(sessionId)
  const waitEnd = (runId: string) => stream.waitFor(() => entries().some((entry) => entry.kind === 'run_end' && entry.runId === runId), 30_000)
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  const submit = async (text: string) => {
    const result = await api.post(apiPaths.sessionMessages(sessionId), { text })
    expect(result.status).toBe(202)
    return result.body.runId as string
  }
  const pauseAt = async (toolCallId: string, runId: string) => {
    await stream.waitFor(
      (message) =>
        message.type === 'progress' && message.sessionId === sessionId && message.event.type === 'tool_start' && message.event.toolCallId === toolCallId,
    )
    expect((await api.post(runPaths.sessionPause(sessionId))).status).toBe(204)
    await writeFile(join(root, toolCallId + '.release'), '')
    await waitEnd(runId)
    expect(entries().find((entry) => entry.kind === 'run_end' && entry.runId === runId)!.payload).toEqual({ status: 'paused' })
  }
  const resume = async () => {
    const result = await api.post(runPaths.sessionContinue(sessionId))
    expect(result.status).toBe(202)
    await waitEnd(result.body.runId)
    return entries().filter((entry) => entry.runId === result.body.runId)
  }
  return { root, api, stream, sessionId, sidecar, entries, requests, submit, pauseAt, resume, waitEnd }
}

it('continue sends changed Todo after a tool result, and unchanged Todo adds no message or entry', { timeout: 60_000 }, async () => {
  const h = await boot([
    { content: [call('todo_write', 'todo', { items: [{ content: 'review the changes', status: 'in_progress' }] }), barrier('first')] },
    { content: 'continued with current state' },
    { content: [barrier('second')] },
    { content: 'continued without another update' },
  ])
  await h.pauseAt('first', await h.submit('plan and wait'))
  expect(
    h
      .entries()
      .filter((entry) => entry.kind === 'message')
      .at(-1),
  ).toMatchObject({ payload: { role: 'toolResult' } })
  const continued = await h.resume()
  expect(continued.slice(0, 3).map(role)).toEqual(['run_start', 'state_update', 'user'])
  expect(continued[1]!.payload).toEqual({ name: 'todo_list', value: { items: [{ id: 't1', content: 'review the changes', status: 'in_progress' }] } })
  const input = (continued[2]!.payload as { content: { type: string; text: string }[] }).content
  expect(input).toEqual([
    {
      type: 'text',
      text: '<state_update name="todo_list">\nUpdated todo list: 0 pending, 1 in progress, 0 completed, 0 cancelled.\n\n- [in_progress] t1: review the changes\n</state_update>',
    },
  ])
  expect((await h.requests())[1]!.at(-1)).toMatchObject({ role: 'user', content: input })
  expect(continued.at(-1)!.payload).toEqual({ status: 'completed' })

  await h.pauseAt('second', await h.submit('wait again'))
  const unchanged = await h.resume()
  expect(unchanged.map(role)).toEqual(['run_start', 'model_request', 'assistant', 'run_end'])
  expect((await h.requests()).at(-1)!.at(-1)).toMatchObject({ role: 'toolResult' })
  expect(h.stream.invalidEntries).toEqual([])
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('continuing a Goal Round with only State Updates neither grants user authority nor wakes a waiting Goal', { timeout: 60_000 }, async () => {
  const h = await boot([
    { content: [call('create_goal', 'create', { objective: 'review the project', criteria: ['done'], budget: { max_rounds: 3 } })] },
    { content: 'goal set' },
    {
      content: [
        call('todo_write', 'todo', { items: [{ content: 'review', status: 'pending' }] }),
        call('write', 'write', { path: 'guarded.txt', content: 'guarded' }),
      ],
    },
    { content: [call('update_goal', 'pause', { goal_id: 'goal-1', revision: 2, action: 'pause' })] },
    { content: 'waiting for the user' },
  ])
  expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })).status).toBe(200)
  await h.submit('create the goal')
  await waitApproval(h.stream, h.sessionId)
  const goalRun = h
    .entries()
    .filter((entry) => entry.kind === 'run_start')
    .at(-1)!
  expect((goalRun.payload as { trigger: string }).trigger).toBe('goal')
  expect((await h.api.post(runPaths.sessionPause(h.sessionId))).status).toBe(204)
  await h.waitEnd(goalRun.runId!)
  expect((await h.api.post(goalPaths.sessionGoal(h.sessionId), { action: 'pause', revision: 999 })).status).toBe(409)
  const before = await h.api.get(goalPaths.sessionGoal(h.sessionId))
  expect(before.body.goal).toMatchObject({ phase: 'waiting-input', revision: 2 })
  const continued = await h.resume()
  expect(continued.filter((entry) => entry.kind === 'state_update').map((entry) => (entry.payload as { name: string }).name)).toEqual(['goal', 'todo_list'])
  const result = continued.find((entry) => entry.kind === 'message' && (entry.payload as { toolName?: string }).toolName === 'update_goal')!.payload as {
    isError: boolean
    content: { text: string }[]
  }
  expect(result).toMatchObject({ isError: true })
  expect(result.content[0]!.text).toContain('pause needs a user request')
  // A rejected stale action takes the Goal lock after run-end processing without changing its state.
  expect((await h.api.post(goalPaths.sessionGoal(h.sessionId), { action: 'pause', revision: 999 })).status).toBe(409)
  const after = await h.api.get(goalPaths.sessionGoal(h.sessionId))
  expect(after.body.goal).toMatchObject({ phase: 'waiting-input', revision: 2 })
  expect(h.entries().filter((entry) => entry.kind === 'run_start')).toHaveLength(3)
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('continue can append an edited Goal snapshot directly after a paused user message', { timeout: 60_000 }, async () => {
  const h = await boot([
    { content: [call('create_goal', 'create', { objective: 'review', criteria: ['done'], budget: { max_rounds: 3 } })] },
    { content: 'goal set' },
    { content: [call('update_goal', 'wait', { goal_id: 'goal-1', revision: 1, action: 'wait_input', reason: 'need a decision' })] },
    { content: 'waiting' },
    { content: 'received edited state' },
  ])
  await h.submit('create the goal')
  await h.stream.waitFor(() => h.entries().some((entry) => entry.kind === 'goal' && (entry.payload as { phase: string }).phase === 'waiting-input'))
  await h.waitEnd(
    h
      .entries()
      .filter((entry) => entry.kind === 'run_start')
      .at(-1)!.runId!,
  )
  expect(
    (
      await h.api.put(hookPaths.hooks, {
        expectedRevision: 0,
        hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `printf '%s' '{"continue":false,"stopReason":"hold before request"}'` }] }] },
      })
    ).status,
  ).toBe(200)
  const held = await h.submit('hold this request')
  await h.waitEnd(held)
  expect(
    h
      .entries()
      .filter((entry) => entry.kind === 'message')
      .at(-1),
  ).toMatchObject({ payload: { role: 'user' } })
  expect((await h.api.post(goalPaths.sessionGoal(h.sessionId), { action: 'edit', revision: 2, objective: 'review the edited target' })).status).toBe(200)
  const continued = await h.resume()
  expect(continued.filter((entry) => entry.kind === 'state_update').map((entry) => entry.payload)).toEqual([
    expect.objectContaining({ name: 'goal', value: expect.objectContaining({ revision: 3, phase: 'waiting-input' }) }),
  ])
  const last = (await h.requests()).at(-1)!
  expect(last.slice(-2).map((message) => message.role)).toEqual(['user', 'user'])
  expect(last.at(-1)!.content).toEqual((continued.find((entry) => role(entry) === 'user')!.payload as { content: unknown }).content)
  expect((await h.api.post(goalPaths.sessionGoal(h.sessionId), { action: 'pause', revision: 999 })).status).toBe(409)
  expect((await h.api.get(goalPaths.sessionGoal(h.sessionId))).body.goal).toMatchObject({ phase: 'waiting-input', revision: 3 })
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

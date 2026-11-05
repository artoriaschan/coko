// State Update delivery on continue, driven through a real Sidecar and its HTTP/WS interfaces.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, agentPaths, checkpointPaths, handoffPaths, apiPaths } from '@coko/protocol'
import { advanceClock, connect, isRunEnd, client, exchange, fauxScript, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('titles a first accepted message outside its Run with a text-only, tool-free request', async () => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const requestDetailsLog = join(root, 'details.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    requestDetailsLog,
    responses: [{ match: 'COKO_SESSION_TITLE', content: '修复登录流程', usage: { input: 10, output: 5, cost: { total: 0.25 } } }, { content: 'Ready.' }],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const observer = await connect(sidecar, cookie)
  const accepted = await api.post('/api/chats/first-send', { draftId: 'title-basic', text: '帮我修复登录流程' })
  expect(accepted.status).toBe(201)
  const id = accepted.body.session.id
  const detail = await pollUntil(
    async () => {
      const value = (await api.get(apiPaths.session(id))).body
      return value.entries.some((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title') && value
    },
    { timeoutMs: 5000, what: 'title request persisted' },
  )
  expect(detail.session.title).toBe('修复登录流程')
  // A list-only connection receives the title even without a Session subscription.
  await observer.waitFor((message) => message.type === 'session_title' && message.sessionId === id)
  const title = detail.entries.find((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title')
  expect(title.runId).toBeNull()
  expect(title.payload).toMatchObject({ runId: null, usage: { input: 10, output: 5 }, cost: 0.25 })
  const requests = (await readFile(requestDetailsLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const request = requests.find((request) => JSON.stringify(request.messages).includes('COKO_SESSION_TITLE'))
  expect(request.tools ?? []).toHaveLength(0)
  expect(request.options.reasoning).toBe('off')
  const users = request.messages.filter((message: any) => message.role === 'user')
  expect(users).toEqual([{ role: 'user', content: expect.any(String), timestamp: expect.any(Number) }])
  expect(JSON.parse(users[0].content)).toEqual({ text: '帮我修复登录流程', filenames: [] })
  expect((await api.get(`/api/sessions/${id}/trace`)).body.totals.cost).toBeGreaterThanOrEqual(0.25)
})

async function controlled(title: Record<string, unknown>) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    responses: [{ match: 'COKO_SESSION_TITLE', content: 'Generated title', delayMs: 1000, ...title }, { content: 'Ready.' }],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const accepted = await api.post('/api/chats/first-send', { draftId: 'controlled-title', text: 'Original first line' })
  const id = accepted.body.session.id
  stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await pollUntil(async () => (await readFile(requestLog, 'utf8').catch(() => '')).includes('COKO_SESSION_TITLE'), { timeoutMs: 5000 })
  return { root, api, stream, id, sidecar, requestLog }
}

it('an in-flight manual rename wins the conditional title write; duplicate first sends do not request another title', async () => {
  const { api, stream, id } = await controlled({})
  expect((await api.put(apiPaths.sessionTitle(id), { title: 'My own title' })).status).toBe(200)
  await advanceClock(api, 1000)
  await stream.waitFor((message) => message.type === 'entry' && message.entry.kind === 'model_request' && (message.entry.payload as any).purpose === 'title')
  expect((await api.get(apiPaths.session(id))).body.session.title).toBe('My own title')
  await api.post('/api/chats/first-send', { draftId: 'controlled-title', text: 'Original first line' })
  const entries = (await api.get(apiPaths.session(id))).body.entries
  expect(entries.filter((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title')).toHaveLength(1)
})

it.each([
  ['empty', { content: '  ' }, 1000],
  ['failure', { content: '', stopReason: 'error', errorMessage: 'provider refused' }, 1000],
  ['timeout', { content: 'Late answer', delayMs: 16000 }, 15000],
] as const)('%s title keeps the first-message title', async (_name, response, ms) => {
  const { api, stream, id } = await controlled(response)
  await advanceClock(api, ms)
  await stream.waitFor((message) => message.type === 'entry' && message.entry.kind === 'model_request' && (message.entry.payload as any).purpose === 'title')
  const detail = (await api.get(apiPaths.session(id))).body
  expect(detail.session.title).toBe('Original first line')
  const requests = detail.entries.filter((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title')
  expect(requests).toHaveLength(1)
  expect(requests[0].payload.durationMs).toBe(ms)
  expect(requests[0].payload.errorCode).toBe(_name === 'timeout' ? 'timeout' : _name === 'failure' ? 'model_error' : undefined)
})

it('stopping the Run preserves the independent title', async () => {
  const { api, stream, id } = await controlled({})
  await api.post(`/api/sessions/${id}/stop`)
  await stream.waitFor(isRunEnd(id))
  await advanceClock(api, 1000)
  await stream.waitFor((message) => message.type === 'session_title' && message.sessionId === id)
  expect((await api.get(apiPaths.session(id))).body.session.title).toBe('Generated title')
  expect(stream.invalid).toEqual([])
})

it('deleting a Session settles its in-flight title before removing storage, with no late observable update', async () => {
  const { api, stream, id, sidecar } = await controlled({ delayMs: 14000 })
  await stream.waitFor(isRunEnd(id))
  expect((await api.delete(apiPaths.session(id))).status).toBe(200)
  await advanceClock(api, 15000)
  expect((await api.get(apiPaths.session(id))).status).toBe(404)
  expect(stream.messages.filter((message) => message.type === 'session_title' && message.sessionId === id)).toEqual([])
  expect(stream.modelRequests(id).filter((request) => request.purpose === 'title')).toEqual([])
  expect(sidecar.stderr()).not.toContain('FOREIGN KEY')
})

it('handoff, fork and actual subagent Sessions do not start title requests', async () => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      { match: 'COKO_SESSION_TITLE', content: 'Delegate research' },
      {
        match: 'PARENT-TITLE',
        content: [
          {
            type: 'toolCall',
            id: 'delegate',
            name: 'agent',
            arguments: { description: 'Research', prompt: 'CHILD-TITLE investigate', subagent_type: 'explore' },
          },
        ],
      },
      { match: 'CHILD-TITLE', content: 'Child complete.' },
      { match: 'PARENT-TITLE', content: 'Parent complete.' },
      { content: '## Task\nContinue the research.' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const accepted = await api.post(API_ROUTES.firstSend, { draftId: 'derived-titles', text: 'PARENT-TITLE delegate research', permissionMode: 'full-access' })
  expect(accepted.status).toBe(201)
  const id = accepted.body.session.id
  stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await stream.waitFor(isRunEnd(id))
  const agents = (await api.get(agentPaths.sessionAgents(id))).body
  expect(agents).toHaveLength(1)
  const child = (await api.get(apiPaths.session(agents[0].agentId))).body
  expect(child.entries.some((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title')).toBe(false)
  const user = stream.entries(id).find((entry) => entry.kind === 'message' && (entry.payload as any).role === 'user')!
  const fork = await api.post(checkpointPaths.sessionFork(id), { targetSeq: user.seq })
  expect(fork.status).toBe(201)
  expect(
    (await api.get(apiPaths.session(fork.body.sessionId))).body.entries.some(
      (entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title',
    ),
  ).toBe(false)
  expect((await api.post(handoffPaths.handoff(id), { instructions: 'Continue research', target: { kind: 'current' } })).status).toBe(202)
  const handed = await stream.waitFor((message) => message.type === 'entry' && message.entry.kind === 'handoff')
  if (handed.type !== 'entry') throw new Error('Expected handoff entry')
  const target = (handed.entry.payload as { targetSessionId: string }).targetSessionId
  expect((await api.get(apiPaths.session(target))).body.entries.some((entry: any) => entry.kind === 'model_request' && entry.payload.purpose === 'title')).toBe(
    false,
  )
  const requests = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .filter((line) => line.includes('COKO_SESSION_TITLE'))
  expect(requests).toHaveLength(1)
})

it('normalizes a multiline title and caps Unicode characters at20', async () => {
  const { api, stream, id } = await controlled({ content: '标题：“一二三四五六七八九十一二三四五六七八九十一二三四五六”\nAdditional explanation' })
  await advanceClock(api, 1000)
  await stream.waitFor((message) => message.type === 'session_title')
  expect((await api.get(apiPaths.session(id))).body.session.title).toBe('一二三四五六七八九十一二三四五六七八九十')
})

it('archive cancels a pending title and prevents late title or trace writes after restore', async () => {
  const { api, stream, id } = await controlled({})
  await stream.waitFor(isRunEnd(id))
  await expect.poll(async () => (await api.post(apiPaths.sessionArchive(id), {})).status).toBe(200)
  const before = (await api.get(apiPaths.session(id))).body
  await advanceClock(api, 1000)
  expect((await api.get(apiPaths.session(id))).body).toEqual(before)
  expect(before.session.title).toBe('Original first line')
  expect(
    before.entries.filter((entry: { kind: string; payload: { purpose?: string } }) => entry.kind === 'model_request' && entry.payload.purpose === 'title'),
  ).toEqual([])
  await api.post(apiPaths.sessionRestore(id), {})
  await advanceClock(api, 15_000)
  expect((await api.get(apiPaths.session(id))).body.session.title).toBe('Original first line')
})

// Real protocol adapters and Sidecar persistence; only the remote model service is controlled.
import { createServer, type ServerResponse } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, SessionEntry, tracePaths, goalPaths, type SessionEntryRecord } from '@coko/protocol'
import { Value } from 'typebox/value'
import {
  answerDecrypts,
  catalogModel,
  client,
  connect,
  customProvider,
  exchange,
  killAndRestart,
  saveProvider,
  sidecarDirs,
  startSidecar,
  tempDir,
} from './sidecar-harness.ts'

const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`
const chat = (usage?: object) =>
  sse({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
  }) +
  sse({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  }) +
  'data: [DONE]\n\n'
const responses = () => {
  const item = { id: 'msg1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }
  return [
    { type: 'response.created', response: { id: 'resp1', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'ok' },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp1',
        status: 'completed',
        output: [item],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 25, cache_write_tokens: 5 },
          output_tokens_details: { reasoning_tokens: 7 },
        },
      },
    },
  ]
    .map(sse)
    .join('')
}
const anthropic = () =>
  [
    {
      type: 'message_start',
      message: {
        id: 'msg1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 70,
          output_tokens: 0,
          cache_read_input_tokens: 25,
          cache_creation_input_tokens: 5,
          cache_creation: { ephemeral_1h_input_tokens: 3 },
        },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 7 } },
    },
    { type: 'message_stop' },
  ]
    .map((event) => `event: ${event.type}\n${sse(event)}`)
    .join('')

async function streamingServer(body: (response: ServerResponse) => void) {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      body(res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

const modelServer = (body: () => string) => streamingServer((res) => res.end(body()))

describe('request usage survives the actual adapters and Sidecar', () => {
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
    it(`${api}: exact buckets, legitimate extensions, one canonical request and persistence after restart`, async () => {
      const origin = await modelServer(() =>
        api === 'openai-responses'
          ? responses()
          : api === 'anthropic-messages'
            ? anthropic()
            : chat({
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
                prompt_tokens_details: { cached_tokens: 30 },
                completion_tokens_details: { reasoning_tokens: 7 },
              }),
      )
      const dirs = await sidecarDirs()
      const first = await startSidecar({ dirs })
      answerDecrypts(first)
      expect(
        await saveProvider(
          first,
          customProvider(
            'p',
            origin + (api === 'anthropic-messages' ? '' : '/v1'),
            [catalogModel('m', { price: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 1 } })],
            api,
          ),
          { secret: 'test-usage-key' },
        ),
      ).toMatchObject({ ok: true })
      const cookie = await exchange(first)
      const http = client(first, cookie)
      const stream = await connect(first, cookie)
      const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
      const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))
      const entries = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
      expect(entries.filter((e) => e.kind === 'run_end').at(-1)?.payload).toEqual({ status: 'completed' })
      const request = entries.filter((e) => e.kind === 'model_request')
      expect(request).toHaveLength(1)
      const cached = api === 'openai-completions' ? { cacheRead: 30, cacheWrite: 0 } : { cacheRead: 25, cacheWrite: 5 }
      expect(request[0]?.payload).toMatchObject({
        requestId: expect.any(String),
        runId: request[0]?.runId,
        usage: { input: 70, output: 20, ...cached, total: 120 },
        reasoning: 7,
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      })
      const assistant = entries.find((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'assistant')!
      // A visible assistant must never be committed before its authoritative request fact.
      expect(request[0]!.seq).toBeLessThan(assistant.seq)
      expect(Value.Check(SessionEntry, assistant)).toBe(true)
      expect(assistant.payload).toMatchObject({ usage: { input: 70, output: 20, ...cached, totalTokens: 120, reasoning: 7 } })
      expect((assistant.payload as { usage: { cacheWrite1h?: number } }).usage.cacheWrite1h).toBe(api === 'anthropic-messages' ? 3 : undefined)
      // Anthropic 1h writes: 2 short × 1 + 3 long × (2 × input price 2) = 14 / million.
      expect((request[0]!.payload as { cost: number }).cost).toBeCloseTo(
        api === 'openai-completions' ? 0.000315 : api === 'anthropic-messages' ? 0.0003265 : 0.0003175,
        10,
      )
      expect((await http.get(tracePaths.trace(sessionId))).body.totals).toMatchObject({ requests: 1, tokens: 120 })
      expect(await first.stop()).toEqual({ code: 0, signal: null })
      const second = await startSidecar({ dirs })
      const again = client(second, await exchange(second))
      expect((await again.get(apiPaths.session(sessionId))).body.entries).toEqual(entries)
      expect((await again.get(tracePaths.trace(sessionId))).body.totals).toMatchObject({ requests: 1, tokens: 120 })
      expect(await second.stop()).toEqual({ code: 0, signal: null })
    })
  }

  it('reported zero differs from absent and partial counters through persisted requests', async () => {
    let report: object | undefined = { prompt_tokens: 0, completion_tokens: 0 }
    const origin = await modelServer(() => chat(report))
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    answerDecrypts(sidecar)
    expect(await saveProvider(sidecar, customProvider('p', origin + '/v1', ['m']), { secret: 'test-usage-key' })).toMatchObject({ ok: true })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    for (const [index, next] of [report, undefined, { completion_tokens: 9 }].entries()) {
      report = next
      expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length === index + 1)
    }
    const records = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    const requests = records.filter((e) => e.kind === 'model_request').map((e) => e.payload)
    expect(requests).toEqual([
      expect.objectContaining({
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }),
      expect.objectContaining({ usageReport: { complete: false, known: [] } }),
      expect.objectContaining({
        usageReport: { complete: false, known: ['output', 'cacheRead', 'cacheWrite'] },
        usage: { input: 0, output: 9, cacheRead: 0, cacheWrite: 0, total: 9 },
      }),
    ])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
  it('keeps usage from a discarded failed attempt and counts the successful retry once after restart', async () => {
    let calls = 0
    const origin = await modelServer(() => {
      calls++
      if (calls === 1)
        return (
          sse({ id: 'failed', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } }) +
          sse({ error: { message: '503 Service unavailable', type: 'server_error', code: 'server_error' } })
        )
      return chat({ prompt_tokens: 20, completion_tokens: 5 })
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    answerDecrypts(sidecar)
    expect(
      await saveProvider(sidecar, customProvider('p', origin + '/v1', [catalogModel('m', { price: { input: 1, output: 2 } })]), { secret: 'test-retry-key' }),
    ).toMatchObject({ ok: true })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'retry safely' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))
    const entries = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    const requests = entries.filter((e) => e.kind === 'model_request')
    expect(calls).toBe(2)
    expect(requests.map((e) => e.payload)).toEqual([
      expect.objectContaining({
        usage: { input: 11, output: 3, cacheRead: 0, cacheWrite: 0, total: 14 },
        stopReason: 'error',
        usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      }),
      expect.objectContaining({
        usage: { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, total: 25 },
        stopReason: 'stop',
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      }),
    ])
    expect(new Set(requests.map((e) => (e.payload as { requestId: string }).requestId)).size).toBe(2)
    expect((await http.get(tracePaths.trace(sessionId))).body.totals).toMatchObject({ requests: 2, tokens: 39, cost: 0.000047 })
    await sidecar.stop()
    const restarted = await startSidecar({ dirs })
    const again = client(restarted, await exchange(restarted))
    expect((await again.get(apiPaths.session(sessionId))).body.entries).toEqual(entries)
    expect((await again.get(tracePaths.trace(sessionId))).body.totals).toMatchObject({ requests: 2, tokens: 39 })
    await restarted.stop()
  })

  it('cancel after reported usage preserves known counters and starts no further attempt', async () => {
    let calls = 0
    const origin = await streamingServer((res) => {
      calls++
      res.write(
        sse({ id: 'partial', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 31, completion_tokens: 4 } }),
      )
      res.write(sse({ id: 'partial', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { completion_tokens: 7 } }))
      res.write(
        sse({
          id: 'partial',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'm',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }],
        }),
      )
    })
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    answerDecrypts(sidecar)
    expect(await saveProvider(sidecar, customProvider('p', origin + '/v1', ['m']), { secret: 'test-cancel-key' })).toMatchObject({ ok: true })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'cancel after a report' })).status).toBe(202)
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'assistant_delta')
    expect((await http.post(apiPaths.sessionAbort(sessionId), {})).status).toBeLessThan(300)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))
    const entries = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(calls).toBe(1)
    expect(entries.filter((e) => e.kind === 'model_request').map((e) => e.payload)).toEqual([
      expect.objectContaining({
        stopReason: 'aborted',
        usage: { input: 31, output: 7, cacheRead: 0, cacheWrite: 0, total: 38 },
        usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      }),
    ])
    await sidecar.stop()
  })

  it('cancel during retry backoff preserves the first attempt without inventing a second request', async () => {
    let calls = 0
    const origin = await modelServer(() => {
      calls++
      return (
        sse({ id: 'failed', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } }) +
        sse({ error: { message: '503 Service unavailable', type: 'server_error', code: 'server_error' } })
      )
    })
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    answerDecrypts(sidecar)
    await saveProvider(sidecar, customProvider('p', origin + '/v1', ['m']), { secret: 'test-backoff-key' })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'stop in backoff' })).status).toBe(202)
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'retry')
    await http.post(apiPaths.sessionAbort(sessionId), {})
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))
    const entries = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(calls).toBe(1)
    expect(entries.filter((e) => e.kind === 'model_request').map((e) => e.payload)).toEqual([
      expect.objectContaining({
        stopReason: 'error',
        retries: 0,
        usage: { input: 11, output: 3, cacheRead: 0, cacheWrite: 0, total: 14 },
        usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      }),
    ])
    expect(entries.filter((e) => e.kind === 'run_end').at(-1)?.payload).toEqual({ status: 'aborted' })
    await sidecar.stop()
  })

  it('failed compaction keeps reported request usage even without a compaction success entry', async () => {
    let calls = 0
    const origin = await modelServer(() => {
      calls++
      if (calls === 3)
        return (
          sse({
            id: 'summary-failed',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'm',
            choices: [],
            usage: { prompt_tokens: 30, completion_tokens: 7 },
          }) + sse({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } })
        )
      return chat({ prompt_tokens: 100, completion_tokens: 10 })
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    answerDecrypts(sidecar)
    await saveProvider(sidecar, customProvider('p', origin + '/v1', ['m']), { secret: 'test-compaction-key' })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    for (const [i, text] of ['a'.repeat(100_000), 'b'.repeat(100_000), '/compact'].entries()) {
      expect((await http.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length === i + 1)
    }
    const entries = (await http.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(calls).toBe(3)
    expect(entries.some((e) => e.kind === 'compaction')).toBe(false)
    const last = entries.filter((e) => e.kind === 'model_request').at(-1)!
    expect(last.payload).toMatchObject({
      purpose: 'compaction',
      stopReason: 'error',
      usage: { input: 30, output: 7, cacheRead: 0, cacheWrite: 0, total: 37 },
      usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
    })
    expect((await http.get(tracePaths.trace(sessionId))).body.runs.at(-1)).toMatchObject({ tokens: 37, status: 'error' })
    await sidecar.stop()
    const restarted = await startSidecar({ dirs })
    const again = client(restarted, await exchange(restarted))
    expect((await again.get(apiPaths.session(sessionId))).body.entries).toEqual(entries)
    expect((await again.get(tracePaths.trace(sessionId))).body.runs.at(-1)).toMatchObject({ tokens: 37, status: 'error' })
    await restarted.stop()
  })

  it('Goal budget stops subsequent requests using failed attempt plus retry consumption', async () => {
    let calls = 0
    const origin = await modelServer(() => {
      calls++
      if (calls === 1)
        return (
          sse({
            id: 'goal',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'm',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'create-goal',
                      type: 'function',
                      function: {
                        name: 'create_goal',
                        arguments: JSON.stringify({ objective: 'finish safely', criteria: ['finished'], budget: { max_tokens: 30 } }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }) +
          sse({
            id: 'goal',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'm',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
          }) +
          'data: [DONE]\n\n'
        )
      if (calls === 2) return chat({ prompt_tokens: 10, completion_tokens: 1 })
      if (calls === 3)
        return (
          sse({ id: 'failed', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } }) +
          sse({ error: { message: '503 Service unavailable', type: 'server_error', code: 'server_error' } })
        )
      return chat({ prompt_tokens: 20, completion_tokens: 5 })
    })
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    answerDecrypts(sidecar)
    await saveProvider(sidecar, customProvider('p', origin + '/v1', [catalogModel('m', { price: { input: 1, output: 2 } })]), { secret: 'test-budget-key' })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    expect((await http.post(apiPaths.sessionMessages(sessionId), { text: 'Create a Goal to finish safely with max 30 tokens.' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'goal' && (e.payload as { phase?: string }).phase === 'budget-exhausted'))
    const result = (await http.get(goalPaths.sessionGoal(sessionId))).body
    expect(result.goal).toMatchObject({ phase: 'budget-exhausted', reason: { code: 'tokens' } })
    expect(result.usage).toMatchObject({ tokens: 39, rounds: 1, cost: expect.closeTo(0.000047, 10) })
    expect(calls).toBe(4)
    await sidecar.stop()
  })
  it('crash during retry backoff keeps the already finished attempt on restart', async () => {
    let calls = 0
    const origin = await modelServer(() => {
      calls++
      return (
        sse({ id: 'failed', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } }) +
        sse({ error: { message: '503 Service unavailable', type: 'server_error', code: 'server_error' } })
      )
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    answerDecrypts(sidecar)
    await saveProvider(sidecar, customProvider('p', origin + '/v1', ['m']), { secret: 'test-backoff-restart-key' })
    const cookie = await exchange(sidecar)
    const http = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await http.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id
    const sessionId = (await http.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await http.post(apiPaths.sessionMessages(sessionId), { text: 'report before waiting' })
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'retry')
    const restarted = await killAndRestart(sidecar, { dirs })
    const again = client(restarted, await exchange(restarted))
    const entries = (await again.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(calls).toBe(1)
    expect(entries.filter((e) => e.kind === 'model_request').map((e) => e.payload)).toEqual([
      expect.objectContaining({
        usage: { input: 11, output: 3, cacheRead: 0, cacheWrite: 0, total: 14 },
        usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      }),
    ])
    expect((await again.get(tracePaths.trace(sessionId))).body.totals).toMatchObject({ requests: 1, tokens: 14 })
    await restarted.stop()
  })
})

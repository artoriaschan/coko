// Real protocol adapters and Sidecar persistence; only the remote model service is controlled.
import { createServer } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, SessionEntry, tracePaths, type SessionEntryRecord } from '@coko/protocol'
import { Value } from 'typebox/value'
import { answerDecrypts, catalogModel, client, connect, customProvider, exchange, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

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

async function modelServer(body: () => string) {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(body())
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
})

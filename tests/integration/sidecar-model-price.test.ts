// 模型价格（Model Catalog 的可选 price，每百万 token）：provider.save 保存价格并读回（重启后同样）；价格写入模型的 cost，assistant 条目的
// usage.cost 按价格与模型服务返回的 usage 计算（手算期望值）；未定价模型的 usage.cost 为 0；负数价格 400 且不写入；没有价格的旧目录照常可用。
import { createServer } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ProviderFields } from '@coko/protocol'
import {
  answerDecrypts,
  catalogModel,
  client,
  connect,
  customProvider,
  exchange,
  saveProvider,
  sidecarDirs,
  startSidecar,
  tempDir,
  type Sidecar,
} from './sidecar-harness.ts'

/** 模拟 OpenAI Chat Completions：每个请求以流式回复 "ok" 并带 usage（300 000 输入，其中 100 000 命中缓存；50 000 输出）。 */
async function usageModelServer() {
  let requests = 0
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests++
      const chunk = (body: object) => 'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', ...body }) + '\n\n'
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }) +
          chunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 300_000, completion_tokens: 50_000, prompt_tokens_details: { cached_tokens: 100_000 } },
          }) +
          'data: [DONE]\n\n',
      )
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
  return { baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', requests: () => requests }
}

async function open(sidecar: Sidecar) {
  answerDecrypts(sidecar)
  const cookie = await exchange(sidecar)
  return { api: client(sidecar, cookie), stream: await connect(sidecar, cookie) }
}

/** 在新 Session 中发一条消息，返回提交的 assistant 消息的 usage。 */
async function assistantUsage(env: Awaited<ReturnType<typeof open>>, modelId: string) {
  const { api, stream } = env
  const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model: { providerId: 'custom-provider-1', modelId } })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
  await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)
  const runEnd = stream.entries(sessionId).find((e) => e.kind === 'run_end')!.payload
  expect(runEnd).toEqual({ status: 'completed' })
  const assistant = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'assistant')!
  return (assistant.payload as { usage: { input: number; output: number; cacheRead: number; cost: Record<string, number> } }).usage
}

describe('模型价格', { timeout: 120_000 }, () => {
  it('provider.save 保存价格并读回（重启后同样）；usage.cost 按价格计算；未定价为 0；负数价格 400；没有价格的旧目录照常可用', async () => {
    const server = await usageModelServer()
    const dirs = await sidecarDirs()
    const price = { input: 2, output: 8, cacheRead: 0.5 }
    const provider: ProviderFields = customProvider('custom-provider-1', server.baseUrl, [catalogModel('priced', { price }), catalogModel('plain')])
    const first = await startSidecar({ dirs })
    expect(await saveProvider(first, provider, { secret: 'sk-price-key-0001' })).toMatchObject({
      ok: true,
      provider: { models: [{ id: 'priced', price }, { id: 'plain' }] },
    })
    const env = await open(first)
    const listed = (await env.api.get(API_ROUTES.providers)).body.providers as { models: { id: string; price?: unknown }[] }[]
    expect(listed[0]!.models.map((m) => [m.id, m.price])).toEqual([
      ['priced', price],
      ['plain', undefined],
    ])

    // 手算：输入 200 000 × 2 / 1e6 = 0.4；缓存读 100 000 × 0.5 / 1e6 = 0.05；输出 50 000 × 8 / 1e6 = 0.4；合计 0.85。
    const close = (n: number) => expect.closeTo(n, 12)
    const usage = await assistantUsage(env, 'priced')
    expect(usage).toMatchObject({ input: 200_000, cacheRead: 100_000, output: 50_000 })
    expect(usage.cost).toEqual({ input: close(0.4), output: close(0.4), cacheRead: close(0.05), cacheWrite: 0, total: close(0.85) })
    // 没有价格的模型（旧目录的形状）照常请求，费用为 0。
    expect((await assistantUsage(env, 'plain')).cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
    expect(server.requests()).toBe(2)

    // 负数价格：400 bad-request，原配置不变。
    const negative = await saveProvider(
      first,
      customProvider('custom-provider-1', server.baseUrl, [catalogModel('priced', { price: { input: -1, output: 8 } })]),
      {
        mode: 'update',
      },
    )
    expect(negative).toMatchObject({ ok: false, error: { code: 'bad-request', message: expect.stringMatching(/non-negative price/) } })
    const negativeCache = await saveProvider(
      first,
      customProvider('custom-provider-1', server.baseUrl, [catalogModel('priced', { price: { input: 1, output: 1, cacheWrite: -0.5 } })]),
      { mode: 'update' },
    )
    expect(negativeCache).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(((await env.api.get(API_ROUTES.providers)).body.providers as { models: unknown[] }[])[0]!.models).toEqual(provider.models)
    expect(await first.stop()).toEqual({ code: 0, signal: null })

    // 重启后读回价格，计费不变；去掉价格后不再计费。
    const second = await startSidecar({ dirs })
    const again = await open(second)
    expect(((await again.api.get(API_ROUTES.providers)).body.providers as { models: { price?: unknown }[] }[])[0]!.models[0]!.price).toEqual(price)
    expect((await assistantUsage(again, 'priced')).cost.total).toBeCloseTo(0.85, 12)
    expect(await saveProvider(second, customProvider('custom-provider-1', server.baseUrl, [catalogModel('priced')]), { mode: 'update' })).toMatchObject({
      ok: true,
    })
    expect((await assistantUsage(again, 'priced')).cost.total).toBe(0)
    expect(await second.stop()).toEqual({ code: 0, signal: null })
  })
})

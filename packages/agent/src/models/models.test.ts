import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelRegistry, ModelConfigError, resolveModel, selectableThinkingLevels, type ModelSpec, type ProviderConfig } from './registry.ts'

interface Recorded {
  method: string
  url: string
  headers: IncomingMessage['headers']
}

let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

/** Loopback server on port 0; `respond` writes the HTTP response. */
async function startServer(respond: (req: IncomingMessage, res: import('node:http').ServerResponse) => void) {
  const requests: Recorded[] = []
  server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    req.resume()
    req.on('end', () => respond(req, res))
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, requests }
}

function chatCompletionSse(text: string): string {
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({ id: 'cmpl-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  return chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n'
}

/** 只带必填能力的模型配置；显示名称留空表示使用模型 ID。 */
const spec = (id: string, extra: Partial<ModelSpec> = {}): ModelSpec => ({
  id,
  name: '',
  contextWindow: 128_000,
  maxTokens: 16_000,
  input: ['text'],
  reasoning: false,
  thinkingLevels: [],
  ...extra,
})

const provider = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'https://gateway.example/v1',
  models: [spec('custom-model-1')],
  ...extra,
})

describe('模型适配：自定义 Provider 与 Model Catalog', () => {
  it('按 Provider 自身的协议与地址注册，模型带目录中的显示名称、容量、输入类型、推理开关与 thinkingLevelMap', () => {
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [
        provider({
          api: 'openai-responses',
          models: [
            spec('custom-model-1', {
              name: '自定义模型一',
              contextWindow: 1_000_000,
              maxTokens: 128_000,
              input: ['text', 'image'],
              reasoning: true,
              thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }, { level: 'max', value: 'very-high' }],
            }),
            spec('custom-model-2'),
          ],
        }),
      ],
    })
    expect(resolveModel(registry, 'custom-provider-1', 'custom-model-1')).toMatchObject({
      id: 'custom-model-1',
      name: '自定义模型一',
      provider: 'custom-provider-1',
      api: 'openai-responses',
      baseUrl: 'https://gateway.example/v1',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: true,
      // 未配置的档位为 null（不支持）；off 不写入，按协议的默认关闭方式请求。
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'very-high' },
    })
    // 显示名称留空时使用模型 ID；没有档位的模型只支持 off。
    expect(resolveModel(registry, 'custom-provider-1', 'custom-model-2')).toMatchObject({
      name: 'custom-model-2',
      reasoning: false,
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: null, xhigh: null, max: null },
    })
    expect(registry.models.getProviders().map((p) => [p.id, p.name])).toEqual([['custom-provider-1', '自定义供应商一']])
  })

  it.each([
    ['地址不是 http(s) URL', provider({ baseUrl: 'ftp://gateway.example' }), /http/],
    ['地址无法解析', provider({ baseUrl: 'gateway.example/v1' }), /http/],
    ['目录为空', provider({ models: [] }), /at least one model/],
    ['模型 ID 重复', provider({ models: [spec('m'), spec('m')] }), /duplicate model/i],
    ['最大输出超过上下文窗口', provider({ models: [spec('m', { contextWindow: 1000, maxTokens: 1001 })] }), /maxTokens/],
    [
      '档位重复',
      provider({
        models: [
          spec('m', {
            thinkingLevels: [
              { level: 'low', value: 'a' },
              { level: 'low', value: 'b' },
            ],
          }),
        ],
      }),
      /duplicate thinking level/i,
    ],
  ])('配置非法（%s）时报 ModelConfigError', (_case, config, message) => {
    expect(() => createModelRegistry({ credentials: new InMemoryCredentialStore(), providers: [config] })).toThrow(ModelConfigError)
    expect(() => createModelRegistry({ credentials: new InMemoryCredentialStore(), providers: [config] })).toThrow(message)
  })

  it('会话可选的 Thinking Level：始终有 off；推理开关打开时再按固定顺序列出已配置的档位，未配置的不出现', () => {
    const levels = [{ level: 'max', value: 'very-high' }, { level: 'off' }, { level: 'low', value: 'low' }, { level: 'high', value: 'deep' }] as const
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [
        provider({
          models: [
            spec('reasoner', { reasoning: true, thinkingLevels: [...levels] }),
            spec('switched-off', { reasoning: false, thinkingLevels: [...levels] }),
            spec('no-levels', { reasoning: true }),
          ],
        }),
      ],
    })
    const selectable = (id: string) => selectableThinkingLevels(resolveModel(registry, 'custom-provider-1', id))
    expect(selectable('reasoner')).toEqual(['off', 'low', 'high', 'max'])
    expect(selectable('switched-off')).toEqual(['off'])
    expect(selectable('no-levels')).toEqual(['off'])
  })

  it('价格（每百万 token）写入 model.cost；留空为未定价（cost 为 0）；显式价格即使为 0 也算已定价；负数或非有限数拒绝', () => {
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [
        provider({
          models: [spec('priced', { price: { input: 2, output: 10, cacheRead: 0.5 } }), spec('free', { price: { input: 0, output: 0 } }), spec('unpriced')],
        }),
      ],
    })
    const id = provider().id
    const priced = resolveModel(registry, id, 'priced')
    expect(priced.cost).toEqual({ input: 2, output: 10, cacheRead: 0.5, cacheWrite: 0 })
    expect(registry.priced(priced)).toBe(true)
    expect(registry.priced(resolveModel(registry, id, 'free'))).toBe(true)
    const unpriced = resolveModel(registry, id, 'unpriced')
    expect(unpriced.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(registry.priced(unpriced)).toBe(false)
    // 去掉价格后重新保存：不再算已定价；删除 Provider 后同样。
    registry.setProvider(provider({ models: [spec('priced')] }))
    expect(registry.priced(resolveModel(registry, id, 'priced'))).toBe(false)
    registry.setProvider(provider({ models: [spec('priced', { price: { input: 1, output: 1 } })] }))
    registry.deleteProvider(id)
    expect(registry.priced({ ...priced, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })).toBe(false)
    for (const price of [
      { input: -1, output: 0 },
      { input: 0, output: Number.NaN },
      { input: 0, output: 0, cacheWrite: -0.1 },
    ])
      expect(() => createModelRegistry({ credentials: new InMemoryCredentialStore(), providers: [provider({ models: [spec('m', { price })] })] })).toThrow(
        /non-negative price/,
      )
  })

  it('未知的 Provider 或模型报 ModelConfigError', () => {
    const registry = createModelRegistry({ credentials: new InMemoryCredentialStore(), providers: [provider()] })
    expect(() => resolveModel(registry, 'nope', 'custom-model-1')).toThrow(/Unknown model/)
    expect(() => resolveModel(registry, 'custom-provider-1', 'nope')).toThrow(ModelConfigError)
  })
})

describe('模型适配：CredentialStore 与请求', () => {
  it('OpenAI Chat Completions 协议以 CredentialStore 中的密钥发起流式请求', async () => {
    const { baseUrl, requests } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(chatCompletionSse('hello from mock'))
    })
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('local', async () => ({ type: 'api_key', key: 'sk-test-1234' }))
    const registry = createModelRegistry({
      credentials,
      providers: [provider({ id: 'local', baseUrl: `${baseUrl}/v1`, models: [spec('mock-model')] })],
    })
    const message = await registry.models.completeSimple(resolveModel(registry, 'local', 'mock-model'), {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    })
    expect(message.stopReason).toBe('stop')
    expect(message.content).toEqual([{ type: 'text', text: 'hello from mock' }])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions' })
    expect(requests[0]?.headers.authorization).toBe('Bearer sk-test-1234')
  })

  it.each([
    ['openai-responses' as const, '/v1', '/v1/responses', 'authorization', 'Bearer sk-oa'],
    ['anthropic-messages' as const, '', '/v1/messages', 'x-api-key', 'sk-oa'],
  ])('%s 协议走各自端点并携带密钥', async (api, prefix, path, header, value) => {
    const { baseUrl, requests } = await startServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'mock rejects request' } }))
    })
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('p', async () => ({ type: 'api_key', key: 'sk-oa' }))
    const registry = createModelRegistry({ credentials, providers: [provider({ id: 'p', api, baseUrl: `${baseUrl}${prefix}` })] })
    const message = await registry.models.completeSimple(resolveModel(registry, 'p', 'custom-model-1'), {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    })
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toMatch(/mock rejects request/)
    expect(requests[0]?.method).toBe('POST')
    expect(new URL(requests[0]?.url ?? '', 'http://x').pathname).toBe(path)
    expect(requests[0]?.headers[header]).toBe(value)
  })

  it('未配置 Credential 时不发请求，以流错误结束', async () => {
    const { baseUrl, requests } = await startServer((_req, res) => res.end())
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [provider({ id: 'local', baseUrl, models: [spec('m')] })],
    })
    const message = await registry.models.completeSimple(resolveModel(registry, 'local', 'm'), {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    })
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toBe('Provider is not configured: local')
    expect(requests).toHaveLength(0)
  })
})

it('真实 Chat SSE 保留缓存、reasoning 与报告完整性；缺失 usage 不冒充实测零', async () => {
  let report = true
  const { baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const usage = report
      ? `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 7 } } })}\n\n`
      : ''
    res.end(chatCompletionSse('hello').replace('data: [DONE]\n\n', usage + 'data: [DONE]\n\n'))
  })
  const credentials = new InMemoryCredentialStore()
  await credentials.modify('p', async () => ({ type: 'api_key', key: 'test' }))
  const registry = createModelRegistry({ credentials, providers: [provider({ id: 'p', baseUrl: `${baseUrl}/v1`, models: [spec('m')] })] })
  const request = () => registry.models.completeSimple(resolveModel(registry, 'p', 'm'), { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] })
  const message = await request()
  expect(message.usage).toMatchObject({
    input: 70,
    cacheRead: 30,
    cacheWrite: 0,
    output: 20,
    totalTokens: 120,
    reasoning: 7,
    report: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
  })
  report = false
  expect((await request()).usage).toMatchObject({ report: { complete: false, known: [] } })
})

it('invalid input counters remain unknown while valid output survives; invalid reasoning is not exposed', async () => {
  const { baseUrl } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: -1, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 11 } } })}\n\n`
    res.end(chatCompletionSse('hello').replace('data: [DONE]\n\n', usage + 'data: [DONE]\n\n'))
  })
  const credentials = new InMemoryCredentialStore()
  await credentials.modify('p', async () => ({ type: 'api_key', key: 'test' }))
  const registry = createModelRegistry({ credentials, providers: [provider({ id: 'p', baseUrl: `${baseUrl}/v1`, models: [spec('m')] })] })
  const message = await registry.models.completeSimple(resolveModel(registry, 'p', 'm'), { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] })
  expect(message.usage).toMatchObject({ output: 9, totalTokens: 9, report: { complete: false, known: ['output', 'cacheRead', 'cacheWrite'] } })
  expect(message.usage).not.toHaveProperty('reasoning')
})

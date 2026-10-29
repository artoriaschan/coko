import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelRegistry, ModelConfigError, resolveModel, type ModelSpec, type ProviderConfig } from './registry.ts'

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

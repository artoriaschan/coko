import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelRegistry, ModelConfigError, resolveModel } from './registry.ts'

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

describe('模型适配：Provider 配置', () => {
  it('预设 Provider 使用 pi-ai 目录中的模型元数据，可覆盖 baseUrl', () => {
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [{ id: 'my-deepseek', kind: 'deepseek', baseUrl: 'https://proxy.example/v1', models: [{ id: 'deepseek-flash' }] }],
    })
    const model = resolveModel(registry, 'my-deepseek', 'deepseek-flash')
    expect(model).toMatchObject({
      id: 'deepseek-flash',
      provider: 'my-deepseek',
      api: 'openai-completions',
      baseUrl: 'https://proxy.example/v1',
      reasoning: true,
    })
  })

  it('三种协议分别映射到 Chat Completions、Responses、Anthropic Messages', () => {
    const registry = createModelRegistry({
      credentials: new InMemoryCredentialStore(),
      providers: [
        { id: 'oa', kind: 'openai', models: [{ id: 'gpt-5' }] },
        { id: 'an', kind: 'anthropic', models: [{ id: 'claude-sonnet-4-6' }] },
        { id: 'custom', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', models: [{ id: 'local', contextWindow: 32000 }] },
      ],
    })
    expect(resolveModel(registry, 'oa', 'gpt-5').api).toBe('openai-responses')
    expect(resolveModel(registry, 'an', 'claude-sonnet-4-6').api).toBe('anthropic-messages')
    expect(resolveModel(registry, 'custom', 'local')).toMatchObject({ api: 'openai-completions', contextWindow: 32000 })
  })

  it('配置非法时报 ModelConfigError', () => {
    const credentials = new InMemoryCredentialStore()
    expect(() => createModelRegistry({ credentials, providers: [{ id: 'c', kind: 'openai-compatible', models: [{ id: 'm' }] }] })).toThrow(ModelConfigError)
    expect(() => createModelRegistry({ credentials, providers: [{ id: 'd', kind: 'deepseek', models: [{ id: 'not-in-catalog' }] }] })).toThrow(/contextWindow/)
    const registry = createModelRegistry({ credentials, providers: [] })
    expect(() => resolveModel(registry, 'nope', 'm')).toThrow(/Unknown model/)
  })
})

describe('模型适配：CredentialStore 与请求', () => {
  it('自定义 OpenAI 兼容 Provider 以 CredentialStore 中的密钥发起 Chat Completions 流式请求', async () => {
    const { baseUrl, requests } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(chatCompletionSse('hello from mock'))
    })
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('local', async () => ({ type: 'api_key', key: 'sk-test-1234' }))
    const registry = createModelRegistry({
      credentials,
      providers: [{ id: 'local', kind: 'openai-compatible', baseUrl: `${baseUrl}/v1`, models: [{ id: 'mock-model' }] }],
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
    ['openai' as const, 'gpt-5', '/v1/responses', 'authorization', 'Bearer sk-oa'],
    ['anthropic' as const, 'claude-sonnet-4-6', '/v1/messages', 'x-api-key', 'sk-oa'],
  ])('%s 预设走各自协议端点并携带密钥', async (kind, modelId, path, header, value) => {
    const { baseUrl, requests } = await startServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'mock rejects request' } }))
    })
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('p', async () => ({ type: 'api_key', key: 'sk-oa' }))
    const registry = createModelRegistry({
      credentials,
      providers: [{ id: 'p', kind, baseUrl: kind === 'anthropic' ? baseUrl : `${baseUrl}/v1`, models: [{ id: modelId }] }],
    })
    const message = await registry.models.completeSimple(resolveModel(registry, 'p', modelId), {
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
      providers: [{ id: 'local', kind: 'openai-compatible', baseUrl, models: [{ id: 'm' }] }],
    })
    const message = await registry.models.completeSimple(resolveModel(registry, 'local', 'm'), {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    })
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toBe('Provider is not configured: local')
    expect(requests).toHaveLength(0)
  })
})

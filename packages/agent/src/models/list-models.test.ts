// 模型列表适配（ADR 0010 获取可用模型）：按协议请求供应商的模型列表。供应商是本测试启动的 loopback HTTP 服务。
// 时限与按值脱敏由宿主（apps/server）负责，见其 provider-models.test.ts。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { listProviderModels, ListModelsError } from './list-models.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
const servers: Server[] = []

/** 启动一个假供应商，返回其基址与收到的请求。 */
async function fakeProvider(handler: Handler) {
  const requests: { method: string | undefined; url: string | undefined; headers: IncomingMessage['headers'] }[] = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers })
    handler(req, res)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${port}`, requests }
}

const json =
  (body: unknown, status = 200): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ListModelsError)
  return error as ListModelsError
}

const KEY = 'sk-fetch-models-unit-0f3a9c'

describe('listProviderModels', () => {
  it.each([
    ['openai-completions', '/v1/models'],
    ['openai-responses', '/v1/models'],
  ] as const)('%s：GET <地址>/models，Bearer Key；按返回顺序给出模型 ID，去重', async (api, path) => {
    const provider = await fakeProvider(json({ object: 'list', data: [{ id: 'custom-model-2' }, { id: 'custom-model-1' }, { id: 'custom-model-2' }] }))
    const models = await listProviderModels({ api, baseUrl: `${provider.origin}/v1/`, key: KEY })
    expect(models).toEqual(['custom-model-2', 'custom-model-1'])
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]).toMatchObject({ method: 'GET', url: path })
    expect(provider.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('anthropic-messages：GET <地址>/v1/models，x-api-key 与 anthropic-version', async () => {
    const provider = await fakeProvider(json({ data: [{ id: 'custom-model-a', type: 'model' }], has_more: false }))
    expect(await listProviderModels({ api: 'anthropic-messages', baseUrl: provider.origin, key: KEY })).toEqual(['custom-model-a'])
    expect(provider.requests[0]!.url).toBe('/v1/models?limit=1000')
    expect(provider.requests[0]!.headers['x-api-key']).toBe(KEY)
    expect(provider.requests[0]!.headers['anthropic-version']).toBeTruthy()
    expect(provider.requests[0]!.headers.authorization).toBeUndefined()
  })

  it('空列表返回空数组', async () => {
    const provider = await fakeProvider(json({ data: [] }))
    expect(await listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY })).toEqual([])
  })

  it('非 2xx 为 upstream-error，带状态码与返回体摘要', async () => {
    const provider = await fakeProvider(json({ error: { message: 'Incorrect API key provided' } }, 401))
    const error = await failure(listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY }))
    expect(error).toMatchObject({ code: 'upstream-error', status: 401 })
    expect(error.message).toContain('401')
    expect(error.message).toContain('Incorrect API key provided')
  })

  it('返回体不是模型列表时为 invalid-response', async () => {
    const provider = await fakeProvider((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>login</html>')
    })
    expect(await failure(listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY }))).toMatchObject({ code: 'invalid-response' })
    const shape = await fakeProvider(json({ data: [{ name: 'no id' }] }))
    expect(await failure(listProviderModels({ api: 'openai-completions', baseUrl: shape.origin, key: KEY }))).toMatchObject({ code: 'invalid-response' })
  })

  it('重定向不跟随（Key 不会被带到其他主机），视为 upstream-error', async () => {
    const other = await fakeProvider(json({ data: [{ id: 'leaked' }] }))
    const provider = await fakeProvider((_req, res) => {
      res.writeHead(302, { location: `${other.origin}/v1/models` })
      res.end()
    })
    expect(await failure(listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY }))).toMatchObject({
      code: 'upstream-error',
      status: 302,
    })
    expect(other.requests).toHaveLength(0)
  })

  it('地址不是 http(s) 时为 bad-request，不发请求', async () => {
    for (const baseUrl of ['ftp://gateway.example/v1', 'not a url'])
      expect(await failure(listProviderModels({ api: 'openai-completions', baseUrl, key: KEY }))).toMatchObject({ code: 'bad-request' })
  })

  it('连不上为 unreachable', async () => {
    const provider = await fakeProvider(json({}))
    for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve))
    expect(await failure(listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY }))).toMatchObject({ code: 'unreachable' })
  })

  it('signal 中止为 cancelled，并中止对供应商的请求', async () => {
    const closed: string[] = []
    const provider = await fakeProvider((req) => req.on('close', () => closed.push(req.url ?? '')))
    const controller = new AbortController()
    const pending = listProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY, signal: controller.signal })
    await expect.poll(() => provider.requests.length).toBe(1)
    controller.abort()
    expect(await failure(pending)).toMatchObject({ code: 'cancelled' })
    await expect.poll(() => closed.length).toBe(1)
  })
})

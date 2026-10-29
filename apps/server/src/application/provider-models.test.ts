// 获取可用模型的宿主部分（ADR 0010）：时限、按值脱敏与错误码映射；协议适配本身见 packages/agent 的 list-models.test.ts。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchProviderModels, ProviderModelsError } from './provider-models.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
const servers: Server[] = []

async function fakeProvider(handler: Handler) {
  const requests: { url: string | undefined }[] = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url })
    handler(req, res)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
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
  expect(error).toBeInstanceOf(ProviderModelsError)
  return error as ProviderModelsError
}

const KEY = 'sk-fetch-models-unit-0f3a9c'

describe('fetchProviderModels', () => {
  it('成功时给出模型 ID', async () => {
    const provider = await fakeProvider(json({ data: [{ id: 'custom-model-1' }] }))
    expect(await fetchProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY })).toEqual(['custom-model-1'])
  })

  it('错误文本中回显的 Key 被替换，包括不是 sk- 形态的 Key（按值脱敏）', async () => {
    const provider = await fakeProvider(json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401))
    const error = await failure(fetchProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY }))
    expect(error).toMatchObject({ code: 'upstream-error', status: 401 })
    expect(error.message).toContain('Incorrect API key provided')
    expect(error.message).not.toContain(KEY)
    const plain = 'plainkeyvalue-77421'
    const echo = await fakeProvider(json({ error: `bad key ${plain}` }, 403))
    expect((await failure(fetchProviderModels({ api: 'openai-completions', baseUrl: echo.origin, key: plain }))).message).not.toContain(plain)
  })

  it('超过时限为 timeout，signal 中止为 cancelled；两者都中止对供应商的请求', async () => {
    const closed: string[] = []
    const provider = await fakeProvider((req) => req.on('close', () => closed.push(req.url ?? '')))
    expect(await failure(fetchProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY, timeoutMs: 100 }))).toMatchObject({
      code: 'timeout',
    })
    const controller = new AbortController()
    const pending = fetchProviderModels({ api: 'openai-completions', baseUrl: provider.origin, key: KEY, signal: controller.signal })
    await expect.poll(() => provider.requests.length).toBe(2)
    controller.abort()
    expect(await failure(pending)).toMatchObject({ code: 'cancelled' })
    await expect.poll(() => closed.length).toBe(2)
  })

  it('地址不是 http(s) 时为 bad-request', async () => {
    expect(await failure(fetchProviderModels({ api: 'openai-completions', baseUrl: 'ftp://gateway.example/v1', key: KEY }))).toMatchObject({
      code: 'bad-request',
    })
  })
})

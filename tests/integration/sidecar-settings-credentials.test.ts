// 设置与 Provider 协议、Credential 的 IPC 往返与环境变量模式、日志脱敏、独立运行与启动失败。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  isRunEnd,
  request,
  sidecarDirs,
  spawnSidecar,
  startSidecar,
  tempDir,
  type SidecarDirs,
} from './sidecar-harness.ts'

/** 模拟模型服务：记录请求，返回不可重试的 400。 */
async function fakeModelServer(errorBody = '{"error":{"message":"bad request","type":"invalid_request_error"}}') {
  const requests: { path: string; headers: IncomingHttpHeaders }[] = []
  const server = createServer((req, res) => {
    requests.push({ path: req.url ?? '', headers: req.headers })
    req.resume()
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(errorBody)
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
  const address = server.address() as { port: number }
  return { requests, baseUrl: `http://127.0.0.1:${address.port}/v1` }
}

/** 测试中的"safeStorage"：可逆变换，密文字节不含明文。 */
const encrypt = (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64')
const decrypt = (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString()

async function readAll(dir: string): Promise<Buffer> {
  const names = await readdir(dir).catch(() => [] as string[])
  return Buffer.concat(await Promise.all(names.map((name) => readFile(join(dir, name)))))
}

async function logLines(dirs: SidecarDirs): Promise<Record<string, any>[]> {
  const text = await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, any>)
}

describe('设置与 Provider', () => {
  it('设置带 revision 乐观并发：冲突返回 409 并带 expected / actual，值不变', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    expect((await api.get(API_ROUTES.settings)).body).toEqual({ settings: [] })
    const set = await api.put(apiPaths.setting('theme'), { value: 'dark', expectedRevision: 0 })
    expect(set).toMatchObject({ status: 200, body: { key: 'theme', value: 'dark', revision: 1 } })
    const conflict = await api.put(apiPaths.setting('theme'), { value: 'light', expectedRevision: 0 })
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'revision-conflict', details: { expected: 0, actual: 1 } } } })
    expect((await api.get(API_ROUTES.settings)).body.settings).toMatchObject([{ key: 'theme', value: 'dark', revision: 1 }])
    expect((await api.put(apiPaths.setting('theme'), { value: 'light' })).status).toBe(400)
    expect((await api.put(apiPaths.setting('bad key!'), { value: 1, expectedRevision: 0 })).status).toBe(400)
  })

  it('Provider 增改删：kind 决定协议，响应不含密钥；无效配置以 400 拒绝且不写库', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    const created = await api.post(API_ROUTES.providers, { name: 'DeepSeek', kind: 'deepseek', models: ['deepseek-flash'] })
    expect(created).toMatchObject({ status: 201, body: { kind: 'deepseek', api: 'openai-completions', baseUrl: '', credential: null } })
    const id = created.body.id as string
    expect((await api.patch(apiPaths.provider(id), { name: 'DS' })).body).toMatchObject({ id, name: 'DS' })
    expect((await api.post(API_ROUTES.providers, { name: 'x', kind: 'openai-compatible', models: ['m'] })).status).toBe(400)
    expect((await api.post(API_ROUTES.providers, { name: 'x', kind: 'deepseek', models: ['not-in-catalog'] })).status).toBe(400)
    expect((await api.post(API_ROUTES.providers, { name: 'x', kind: 'nope', models: ['m'] })).status).toBe(400)
    expect((await api.get(API_ROUTES.providers)).body.providers).toHaveLength(1)

    // 没有 faux 时，新建 Session 默认使用第一个 Provider 的第一个模型。
    const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    expect((await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id })).body.model).toEqual({ providerId: id, modelId: 'deepseek-flash' })

    expect((await api.delete(apiPaths.provider(id))).status).toBe(204)
    expect((await api.get(API_ROUTES.providers)).body).toEqual({ providers: [] })
    expect((await api.delete(apiPaths.provider(id))).status).toBe(404)
  })

  it('预设目录：三个预设 kind 给出默认地址与目录中的模型；自定义兼容 Provider 无目录', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    const res = await api.get(API_ROUTES.providerPresets)
    expect(res.status).toBe(200)
    const presets = res.body.presets as { kind: string; name: string; baseUrl: string; models: string[] }[]
    expect(presets.map((p) => p.kind)).toEqual(['deepseek', 'openai', 'anthropic'])
    expect(presets[0]).toMatchObject({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' })
    expect(presets[0]!.models).toContain('deepseek-flash')
    // 目录中的模型都能用于创建该 kind 的 Provider。
    for (const preset of presets) {
      expect(preset.models.length).toBeGreaterThan(0)
      expect((await api.post(API_ROUTES.providers, { name: preset.name, kind: preset.kind, models: [preset.models.at(-1)] })).status).toBe(201)
    }
  })

  it('可用模型：列出已注册 Provider 的模型与默认模型；增删 Provider 后随之变化', async () => {
    const root = await tempDir()
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    expect((await api.get(API_ROUTES.models)).body).toEqual({ models: [], defaultModel: null })

    const created = (await api.post(API_ROUTES.providers, { name: 'Local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', models: ['m1', 'm2'] }))
      .body
    const listed = (await api.get(API_ROUTES.models)).body
    expect(listed).toEqual({
      models: [
        { providerId: created.id, providerName: 'Local', modelId: 'm1', name: 'm1' },
        { providerId: created.id, providerName: 'Local', modelId: 'm2', name: 'm2' },
      ],
      defaultModel: { providerId: created.id, modelId: 'm1' },
    })
    await api.patch(apiPaths.provider(created.id), { models: ['m2'] })
    expect((await api.get(API_ROUTES.models)).body.models.map((m: { modelId: string }) => m.modelId)).toEqual(['m2'])
    await api.delete(apiPaths.provider(created.id))
    expect((await api.get(API_ROUTES.models)).body).toEqual({ models: [], defaultModel: null })

    // faux 开启时（测试），faux 模型也在列表中并作为默认。
    const faux = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [] }) } })
    const fauxApi = client(faux, await exchange(faux))
    expect((await fauxApi.get(API_ROUTES.models)).body).toEqual({
      models: [{ providerId: 'faux', providerName: 'faux', modelId: 'faux-1', name: 'Faux' }],
      defaultModel: { providerId: 'faux', modelId: 'faux-1' },
    })
  })
})

describe('Credential', () => {
  it('IPC 模式：credential.store 只存密文；调用模型时经 credential.decrypt 取明文；库与日志不含令牌、cookie 与密钥', async () => {
    const dirs = await sidecarDirs()
    const fake = await fakeModelServer()
    const apiKey = 'test-key-9f8e7d6c5b4a3210'
    const sidecar = await startSidecar({ dirs })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const decryptRequests: string[] = []
    sidecar.onMessage((message) => {
      if (message.type !== 'credential.decrypt') return
      decryptRequests.push(message.ciphertext)
      sidecar.send({ type: 'credential.decrypt.result', requestId: message.requestId, plaintext: decrypt(message.ciphertext) })
    })

    const provider = (await api.post(API_ROUTES.providers, { name: 'Local', kind: 'openai-compatible', baseUrl: fake.baseUrl, models: ['m1'] })).body
    const ciphertext = encrypt(apiKey)
    sidecar.send({ type: 'credential.store', requestId: 7, providerId: provider.id, ciphertext, hint: apiKey.slice(-4) })
    expect(await sidecar.waitMessage('credential.store.result')).toEqual({ type: 'credential.store.result', requestId: 7, ok: true })
    const listed = (await api.get(API_ROUTES.providers)).body
    expect(listed.providers[0].credential).toEqual({ hint: '3210' })
    expect(JSON.stringify(listed)).not.toContain(apiKey)

    const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model: { providerId: provider.id, modelId: 'm1' } })).body
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })
    const end = (await stream.waitFor(isRunEnd(session.id))) as Extract<ServerMessage, { type: 'entry' }>
    expect(end.entry.payload).toMatchObject({ status: 'error', error: { code: 'model_error' } })

    expect(decryptRequests).toEqual([ciphertext])
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ path: '/v1/chat/completions', headers: { authorization: `Bearer ${apiKey}` } })

    sidecar.send({ type: 'credential.store', requestId: 8, providerId: 'missing', ciphertext, hint: '3210' })
    await expect.poll(() => sidecar.messages.find((m) => m.type === 'credential.store.result' && m.requestId === 8)).toMatchObject({ ok: false })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

    const db = await readAll(dirs.dataDir)
    expect(db.length).toBeGreaterThan(0)
    expect(db.includes(apiKey)).toBe(false)
    const logs = await readAll(dirs.logDir)
    const lines = await logLines(dirs)
    expect(lines.some((line) => line.message?.includes('request') && line.properties?.path === API_ROUTES.providers)).toBe(true)
    expect(lines.some((line) => line.message === 'run ended')).toBe(true)
    for (const secret of [apiKey, sidecar.token, cookie.split('=')[1]!, ciphertext]) expect(logs.includes(secret)).toBe(false)
  })

  it('模型服务在错误中回显密钥时，日志中被脱敏', async () => {
    const dirs = await sidecarDirs()
    const apiKey = 'sk-echoed0123456789abcdef'
    const fake = await fakeModelServer(JSON.stringify({ error: { message: `Incorrect API key provided: ${apiKey}` } }))
    const sidecar = await startSidecar({ dirs })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    sidecar.onMessage(
      (m) => m.type === 'credential.decrypt' && sidecar.send({ type: 'credential.decrypt.result', requestId: m.requestId, plaintext: decrypt(m.ciphertext) }),
    )
    const provider = (await api.post(API_ROUTES.providers, { name: 'Local', kind: 'openai-compatible', baseUrl: fake.baseUrl, models: ['m1'] })).body
    sidecar.send({ type: 'credential.store', requestId: 1, providerId: provider.id, ciphertext: encrypt(apiKey), hint: 'cdef' })
    await sidecar.waitMessage('credential.store.result')
    const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model: { providerId: provider.id, modelId: 'm1' } })).body
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })
    await stream.waitFor(isRunEnd(session.id))
    await sidecar.stop()
    const logs = await readAll(dirs.logDir)
    expect(logs.includes(apiKey)).toBe(false)
    expect((await readAll(dirs.dataDir)).includes(apiKey)).toBe(false)
    expect((await logLines(dirs)).find((line) => line.message === 'run ended')?.properties?.error?.message).toContain('[REDACTED]')
  })

  it('独立运行：ready 写到 stdout；Credential 从环境变量读取；SIGTERM 有序退出', async () => {
    const dirs = await sidecarDirs()
    const fake = await fakeModelServer()
    const apiKey = 'env-key-0011223344556677'
    const proc = spawnSidecar({ dirs, ipc: false, env: { DEEPSEEK_API_KEY: apiKey } })
    const ready = await proc.waitMessage('ready')
    expect(proc.messages.map((m) => m.type)).toEqual(['starting', 'ready'])
    const sidecar = { port: ready.port, token: ready.token }
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const provider = (await api.post(API_ROUTES.providers, { name: 'DS', kind: 'deepseek', baseUrl: fake.baseUrl, models: ['deepseek-flash'] })).body
    const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id })).body
    expect(session.model).toEqual({ providerId: provider.id, modelId: 'deepseek-flash' })
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })
    await stream.waitFor(isRunEnd(session.id))
    expect(fake.requests[0]?.headers.authorization).toBe(`Bearer ${apiKey}`)

    proc.child.kill('SIGTERM')
    expect(await proc.exited).toEqual({ code: 0, signal: null })
    expect(proc.messages.at(-1)).toEqual({ type: 'shutdown-complete' })
    expect((await readAll(dirs.logDir)).includes(apiKey)).toBe(false)
  })
})

describe('启动失败', () => {
  it('参数缺失或不是绝对路径时 fatal invalid-arguments 并以 1 退出', async () => {
    const dirs = await sidecarDirs()
    for (const args of [[], ['--data-dir', 'relative', '--log-dir', dirs.logDir], ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--unknown', 'x']]) {
      const proc = spawnSidecar({ dirs, args })
      expect(await proc.waitMessage('fatal')).toMatchObject({ code: 'invalid-arguments' })
      expect((await proc.exited).code).toBe(1)
    }
  })

  it('同一数据目录已有 Sidecar 运行时，第二个 fatal storage-lease-held；第一个不受影响', async () => {
    const dirs = await sidecarDirs()
    const first = await startSidecar({ dirs })
    const second = spawnSidecar({ dirs })
    expect(await second.waitMessage('fatal')).toMatchObject({ code: 'storage-lease-held' })
    expect((await second.exited).code).toBe(1)
    expect(second.messages.some((m) => m.type === 'ready')).toBe(false)
    expect((await client(first, await exchange(first)).get(API_ROUTES.health)).status).toBe(200)
  })

  it('faux 脚本无效时 fatal faux-script-invalid', async () => {
    const root = await tempDir()
    const proc = spawnSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: await fauxScript(root, { nope: true }) } })
    expect(await proc.waitMessage('fatal')).toMatchObject({ code: 'faux-script-invalid' })
    expect((await proc.exited).code).toBe(1)
  })

  it('IPC 父进程断开时 Sidecar 自行关闭', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    sidecar.child.disconnect()
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    expect((await request(sidecar.port, 'GET', API_ROUTES.health).catch((error: NodeJS.ErrnoException) => ({ status: error.code }))).status).toBe(
      'ECONNREFUSED',
    )
  })
})

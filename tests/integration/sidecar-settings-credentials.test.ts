// 设置与 Provider 协议、Provider 与 Credential 的一次提交（provider.save，ADR 0010）、解密往返与环境变量模式、日志脱敏、独立运行与启动失败。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage } from '@coko/protocol'
import {
  answerDecrypts,
  catalogModel,
  client,
  connect,
  customProvider,
  exchange,
  fauxScript,
  isRunEnd,
  request,
  saveProvider,
  seedProviders,
  sidecarDirs,
  spawnSidecar,
  startSidecar,
  tempDir,
  testCipher,
  type Sidecar,
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

/** 在 Session 中发一条消息并等到 Run 结束。 */
async function runOnce(sidecar: Sidecar, cookie: string, model: { providerId: string; modelId: string }) {
  const api = client(sidecar, cookie)
  const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model })).body
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })
  return (await stream.waitFor(isRunEnd(session.id))) as Extract<ServerMessage, { type: 'entry' }>
}

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

  it('自定义 Provider：用户输入的 ID、协议与带能力的 Model Catalog 原样保存；重启 Sidecar 后读回完全一致，模型仍可用', async () => {
    const dirs = await sidecarDirs()
    const first = await startSidecar({ dirs })
    const api = client(first, await exchange(first))
    const body = customProvider(
      'custom-provider-1',
      'https://gateway.example/v1',
      [
        catalogModel('custom-model-1', {
          name: '自定义模型一',
          contextWindow: 1_000_000,
          maxTokens: 128_000,
          input: ['text', 'image'],
          reasoning: true,
          thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }, { level: 'max', value: 'max' }],
        }),
        'custom-model-2',
      ],
      'openai-responses',
    )
    const created = await saveProvider(first, body)
    expect(created).toMatchObject({ ok: true, provider: { ...body, credential: null } })
    expect(created.ok && created.provider).not.toHaveProperty('kind')
    const before = (await api.get(API_ROUTES.providers)).body
    expect(before).toEqual({ providers: [created.ok && created.provider] })
    expect((await first.stop()).code).toBe(0)

    const second = await startSidecar({ dirs })
    const again = client(second, await exchange(second))
    expect((await again.get(API_ROUTES.providers)).body).toEqual(before)
    expect((await again.get(API_ROUTES.models)).body).toEqual({
      models: [
        {
          providerId: 'custom-provider-1',
          providerName: 'custom-provider-1',
          modelId: 'custom-model-1',
          name: '自定义模型一',
          thinkingLevels: ['off', 'high', 'max'],
        },
        { providerId: 'custom-provider-1', providerName: 'custom-provider-1', modelId: 'custom-model-2', name: 'custom-model-2', thinkingLevels: ['off'] },
      ],
      defaultModel: { providerId: 'custom-provider-1', modelId: 'custom-model-1' },
    })
    // 重启后新建 Session 的默认模型来自库中的目录。
    const ws = await again.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await again.post(API_ROUTES.sessions, { workspaceId: ws.body.id })).body
    expect(session.model).toEqual({ providerId: 'custom-provider-1', modelId: 'custom-model-1' })
  })

  it('provider.save：ID 重复、地址不是 http(s)、目录不合规则或修改不存在的 Provider 时拒绝且库不变；HTTP 不再提供创建与更新，列表与删除可用', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    expect(await saveProvider(sidecar, customProvider('custom-provider-1', 'http://127.0.0.1:9/v1', ['m1']), { secret: 'sk-original-key-1111' })).toMatchObject(
      {
        ok: true,
      },
    )
    const snapshot = (await api.get(API_ROUTES.providers)).body
    const rejected = [
      customProvider('custom-provider-2', 'ftp://127.0.0.1/v1', ['m']),
      customProvider('custom-provider-2', 'http://127.0.0.1:9/v1', ['m', 'm']),
      customProvider('custom-provider-2', 'http://127.0.0.1:9/v1', [catalogModel('m', { contextWindow: 1000, maxTokens: 1001 })]),
    ]
    for (const body of rejected) {
      expect(await saveProvider(sidecar, body, { secret: 'sk-rejected-key-2222' })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    const duplicate = await saveProvider(sidecar, customProvider('custom-provider-1', 'https://other.example/v1', ['other']), { secret: 'sk-duplicate-3333' })
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'already-exists', details: { field: 'id', id: 'custom-provider-1' } } })
    const missing = await saveProvider(sidecar, customProvider('custom-provider-9', 'http://127.0.0.1:9/v1', ['m']), {
      mode: 'update',
      secret: 'sk-missing-4444',
    })
    expect(missing).toMatchObject({ ok: false, error: { code: 'not-found' } })
    const badUpdate = await saveProvider(sidecar, customProvider('custom-provider-1', 'ftp://x/v1', ['m1']), { mode: 'update', secret: 'sk-bad-update-5555' })
    expect(badUpdate).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    // 失败的提交既没有写配置，也没有写密文：原 Provider 与其 Credential 提示不变，其他 ID 不存在。
    expect((await api.get(API_ROUTES.providers)).body).toEqual(snapshot)
    expect(snapshot.providers).toMatchObject([{ id: 'custom-provider-1', credential: { hint: '1111' } }])

    // HTTP 的创建与更新路由已移除（ADR 0010）。
    expect((await api.post(API_ROUTES.providers, customProvider('custom-provider-3', 'http://127.0.0.1:9/v1', ['m']))).status).toBe(404)
    expect((await api.patch(apiPaths.provider('custom-provider-1'), { name: 'renamed' })).status).toBe(404)
    expect((await api.get(API_ROUTES.providers)).body).toEqual(snapshot)
    expect((await api.get('/api/provider-presets')).status).toBe(404)

    const updated = await saveProvider(
      sidecar,
      { ...customProvider('custom-provider-1', 'http://127.0.0.1:9/v1', ['m1'], 'anthropic-messages'), name: '自定义供应商一' },
      {
        mode: 'update',
      },
    )
    expect(updated).toMatchObject({
      ok: true,
      provider: { id: 'custom-provider-1', name: '自定义供应商一', api: 'anthropic-messages', credential: { hint: '1111' } },
    })

    expect((await api.delete(apiPaths.provider('custom-provider-1'))).status).toBe(204)
    expect((await api.get(API_ROUTES.providers)).body).toEqual({ providers: [] })
    expect((await api.delete(apiPaths.provider('custom-provider-1'))).status).toBe(404)
  })

  it('可用模型：列出已注册 Provider 的模型与默认模型；保存与删除 Provider 后随之变化', async () => {
    const root = await tempDir()
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const api = client(sidecar, await exchange(sidecar))
    expect((await api.get(API_ROUTES.models)).body).toEqual({ models: [], defaultModel: null })

    const created = await saveProvider(sidecar, customProvider('local', 'http://127.0.0.1:9/v1', ['m1', 'm2']))
    expect(created.ok).toBe(true)
    const listed = (await api.get(API_ROUTES.models)).body
    expect(listed).toEqual({
      models: [
        { providerId: 'local', providerName: 'local', modelId: 'm1', name: 'm1', thinkingLevels: ['off'] },
        { providerId: 'local', providerName: 'local', modelId: 'm2', name: 'm2', thinkingLevels: ['off'] },
      ],
      defaultModel: { providerId: 'local', modelId: 'm1' },
    })
    await saveProvider(sidecar, customProvider('local', 'http://127.0.0.1:9/v1', ['m2']), { mode: 'update' })
    expect((await api.get(API_ROUTES.models)).body.models.map((m: { modelId: string }) => m.modelId)).toEqual(['m2'])
    await api.delete(apiPaths.provider('local'))
    expect((await api.get(API_ROUTES.models)).body).toEqual({ models: [], defaultModel: null })

    // faux 开启时（测试），faux 模型也在列表中并作为默认。
    const faux = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [] }) } })
    const fauxApi = client(faux, await exchange(faux))
    expect((await fauxApi.get(API_ROUTES.models)).body).toEqual({
      models: [{ providerId: 'faux', providerName: 'faux', modelId: 'faux-1', name: 'Faux', thinkingLevels: ['off'] }],
      defaultModel: { providerId: 'faux', modelId: 'faux-1' },
    })
  })
})

describe('Credential', () => {
  it('一次提交：配置与密文在同一条 provider.save 中保存，调用模型时经 credential.decrypt 取明文；库与日志不含令牌、cookie 与密钥', async () => {
    const dirs = await sidecarDirs()
    const fake = await fakeModelServer()
    const apiKey = 'test-key-9f8e7d6c5b4a3210'
    const sidecar = await startSidecar({ dirs })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const decryptRequests = answerDecrypts(sidecar)

    const saved = await saveProvider(sidecar, customProvider('local', fake.baseUrl, ['m1']), { secret: apiKey })
    expect(saved).toMatchObject({ ok: true, provider: { id: 'local', credential: { hint: '3210' } } })
    expect(JSON.stringify(saved)).not.toContain(apiKey)
    const listed = (await api.get(API_ROUTES.providers)).body
    expect(listed.providers[0].credential).toEqual({ hint: '3210' })
    expect(JSON.stringify(listed)).not.toContain(apiKey)

    const end = await runOnce(sidecar, cookie, { providerId: 'local', modelId: 'm1' })
    expect(end.entry.payload).toMatchObject({ status: 'error', error: { code: 'model_error' } })
    expect(decryptRequests).toEqual([testCipher.encrypt(apiKey)])
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ path: '/v1/chat/completions', headers: { authorization: `Bearer ${apiKey}` } })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

    const db = await readAll(dirs.dataDir)
    expect(db.length).toBeGreaterThan(0)
    expect(db.includes(apiKey)).toBe(false)
    const logs = await readAll(dirs.logDir)
    const lines = await logLines(dirs)
    expect(
      lines.some((line) => line.message === 'provider saved' && line.properties?.providerId === 'local' && line.properties?.credential === 'replaced'),
    ).toBe(true)
    expect(lines.some((line) => line.message === 'run ended')).toBe(true)
    for (const secret of [apiKey, sidecar.token, cookie.split('=')[1]!, testCipher.encrypt(apiKey)]) expect(logs.includes(secret)).toBe(false)
  })

  it('编辑：不带新 Key 保存时原 Credential 继续有效；带新 Key 时替换密文并清除明文缓存，之后的请求使用新 Key', async () => {
    const fake = await fakeModelServer()
    const first = 'sk-first-key-aaaa1111'
    const second = 'sk-second-key-bbbb2222'
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const decryptRequests = answerDecrypts(sidecar)
    const model = { providerId: 'custom-provider-1', modelId: 'm1' }
    await saveProvider(sidecar, customProvider('custom-provider-1', fake.baseUrl, ['m1']), { secret: first })
    await runOnce(sidecar, cookie, model)

    // 只改名称与目录：Credential 不变，明文缓存仍有效（不再解密）。
    const renamed = await saveProvider(
      sidecar,
      { ...customProvider('custom-provider-1', fake.baseUrl, ['m1', 'm2']), name: '自定义供应商一' },
      { mode: 'update' },
    )
    expect(renamed).toMatchObject({ ok: true, provider: { name: '自定义供应商一', credential: { hint: '1111' } } })
    await runOnce(sidecar, cookie, model)
    expect(decryptRequests).toEqual([testCipher.encrypt(first)])

    // 带新 Key：替换密文并清除缓存，下一次请求重新解密并使用新 Key。
    const replaced = await saveProvider(sidecar, customProvider('custom-provider-1', fake.baseUrl, ['m1', 'm2']), { mode: 'update', secret: second })
    expect(replaced).toMatchObject({ ok: true, provider: { credential: { hint: '2222' } } })
    await runOnce(sidecar, cookie, model)
    expect(decryptRequests).toEqual([testCipher.encrypt(first), testCipher.encrypt(second)])
    expect(fake.requests.map((r) => r.headers.authorization)).toEqual([`Bearer ${first}`, `Bearer ${first}`, `Bearer ${second}`])
    expect((await api.get(API_ROUTES.providers)).body.providers).toMatchObject([{ credential: { hint: '2222' } }])
  })

  it('模型服务在错误中回显密钥时，日志中被脱敏', async () => {
    const dirs = await sidecarDirs()
    const apiKey = 'sk-echoed0123456789abcdef'
    const fake = await fakeModelServer(JSON.stringify({ error: { message: `Incorrect API key provided: ${apiKey}` } }))
    const sidecar = await startSidecar({ dirs })
    const cookie = await exchange(sidecar)
    answerDecrypts(sidecar)
    await saveProvider(sidecar, customProvider('local', fake.baseUrl, ['m1']), { secret: apiKey })
    await runOnce(sidecar, cookie, { providerId: 'local', modelId: 'm1' })
    await sidecar.stop()
    const logs = await readAll(dirs.logDir)
    expect(logs.includes(apiKey)).toBe(false)
    expect((await readAll(dirs.dataDir)).includes(apiKey)).toBe(false)
    expect((await logLines(dirs)).find((line) => line.message === 'run ended')?.properties?.error?.message).toContain('[REDACTED]')
  })

  it('独立运行：ready 写到 stdout；Credential 只从 COKO_CREDENTIAL_<PROVIDER_ID> 读取；SIGTERM 有序退出', async () => {
    const dirs = await sidecarDirs()
    const fake = await fakeModelServer()
    const apiKey = 'env-key-0011223344556677'
    // 按旧 kind 命名的变量不再被读取：同名 Provider 没有密钥，请求不会发出。
    const brandKey = 'brand-key-8899aabbccddeeff'
    // 独立运行没有 main，不能保存 Provider：先经 IPC 模式写入（ADR 0010）。
    await seedProviders(dirs, [
      customProvider('custom-provider-1', fake.baseUrl, ['custom-model-1']),
      customProvider('deepseek', fake.baseUrl, ['deepseek-flash']),
    ])
    const proc = spawnSidecar({ dirs, ipc: false, env: { COKO_CREDENTIAL_CUSTOM_PROVIDER_1: apiKey, DEEPSEEK_API_KEY: brandKey } })
    const ready = await proc.waitMessage('ready')
    expect(proc.messages.map((m) => m.type)).toEqual(['starting', 'ready'])
    const sidecar = { port: ready.port, token: ready.token }
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    // 独立运行时 HTTP 同样不能创建 Provider。
    expect((await api.post(API_ROUTES.providers, customProvider('other', fake.baseUrl, ['m']))).status).toBe(404)
    const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id })).body
    expect(session.model).toEqual({ providerId: 'custom-provider-1', modelId: 'custom-model-1' })
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await api.post(apiPaths.sessionMessages(session.id), { text: 'hello' })
    await stream.waitFor(isRunEnd(session.id))
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.headers.authorization).toBe(`Bearer ${apiKey}`)

    const brand = (await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model: { providerId: 'deepseek', modelId: 'deepseek-flash' } })).body
    stream.send({ type: 'subscribe', sessionId: brand.id, afterSeq: 0 })
    await api.post(apiPaths.sessionMessages(brand.id), { text: 'hello' })
    const brandEnd = (await stream.waitFor(isRunEnd(brand.id))) as Extract<ServerMessage, { type: 'entry' }>
    expect(brandEnd.entry.payload).toMatchObject({ status: 'error', error: { message: expect.stringContaining('not configured') } })
    expect(fake.requests).toHaveLength(1)

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

// 删除 Provider（MS-32、MS-33）：确认用的引用数量与库一致；删除后 Credential 与明文缓存被清除，引用它的 Session 模型字段为空、
// 下次运行前要求重新选择模型（model-required），默认模型回退为第一个可用模型；用相同 ID 重新创建不会接回原 Session。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage } from '@coko/protocol'
import {
  answerDecrypts,
  client,
  connect,
  customProvider,
  exchange,
  isRunEnd,
  saveProvider,
  sidecarDirs,
  startSidecar,
  tempDir,
  testCipher,
} from './sidecar-harness.ts'

/** 模拟模型服务：记录请求头，返回不可重试的 400（Run 以模型错误结束即可）。 */
async function fakeModelServer() {
  const requests: { headers: IncomingHttpHeaders }[] = []
  const server = createServer((req, res) => {
    requests.push({ headers: req.headers })
    req.resume()
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"bad request","type":"invalid_request_error"}}')
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
  return { requests, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
}

it('删除被 Session 引用的 Provider：引用数量与库一致；确认后 Credential 与明文缓存被清除、Session 下次运行前要求重新选择模型、默认模型回退；重新创建相同 ID 不接回', async () => {
  const fake = await fakeModelServer()
  const dirs = await sidecarDirs()
  const firstKey = 'sk-first-key-aaaa1111'
  const sidecar = await startSidecar({ dirs })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const decrypts = answerDecrypts(sidecar)
  expect(await saveProvider(sidecar, customProvider('custom-provider-1', fake.baseUrl, ['custom-model-1']), { secret: firstKey })).toMatchObject({ ok: true })
  expect(await saveProvider(sidecar, customProvider('custom-provider-2', fake.baseUrl, ['custom-model-2']), { secret: 'sk-other-key-bbbb2222' })).toMatchObject(
    {
      ok: true,
    },
  )
  const deleted = { providerId: 'custom-provider-1', modelId: 'custom-model-1' }
  const kept = { providerId: 'custom-provider-2', modelId: 'custom-model-2' }
  expect((await api.get(API_ROUTES.models)).body.defaultModel).toEqual(deleted)

  const ws = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body
  const s1 = (await api.post(API_ROUTES.sessions, { workspaceId: ws.id, model: deleted })).body
  const s2 = (await api.post(API_ROUTES.sessions, { workspaceId: ws.id })).body
  const s3 = (await api.post(API_ROUTES.sessions, { workspaceId: ws.id, model: kept })).body
  expect(s2.model).toEqual(deleted)
  // 运行一次，使明文进入 Sidecar 的缓存。
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId: s1.id, afterSeq: 0 })
  expect((await api.post(apiPaths.sessionMessages(s1.id), { text: 'hello' })).status).toBe(202)
  await stream.waitFor(isRunEnd(s1.id))
  expect(decrypts).toEqual([testCipher.encrypt(firstKey)])

  // 确认框的引用数量与库中一致。
  expect(await api.get(apiPaths.providerReferences('custom-provider-1'))).toMatchObject({ status: 200, body: { sessions: 2 } })
  expect(await api.get(apiPaths.providerReferences('custom-provider-2'))).toMatchObject({ status: 200, body: { sessions: 1 } })
  expect((await api.get(apiPaths.providerReferences('missing'))).status).toBe(404)

  expect((await api.delete(apiPaths.provider('custom-provider-1'))).status).toBe(204)
  const sessions = (await api.get(API_ROUTES.sessions)).body.sessions as { id: string; model: unknown; thinkingLevel: string }[]
  const byId = (id: string) => sessions.find((s) => s.id === id)
  expect(byId(s1.id)).toMatchObject({ model: null, thinkingLevel: 'off' })
  expect(byId(s2.id)).toMatchObject({ model: null, thinkingLevel: 'off' })
  expect(byId(s3.id)).toMatchObject({ model: kept })
  // 默认模型回退为第一个可用模型。
  expect((await api.get(API_ROUTES.models)).body.defaultModel).toEqual(kept)

  // 下次运行前提示重新选择模型：不自动选用默认模型，不写入任何条目。
  const before = (await api.get(apiPaths.session(s1.id))).body.entries.length
  expect(await api.post(apiPaths.sessionMessages(s1.id), { text: 'again' })).toMatchObject({ status: 409, body: { error: { code: 'model-required' } } })
  expect((await api.get(apiPaths.session(s1.id))).body).toMatchObject({ session: { model: null } })
  expect((await api.get(apiPaths.session(s1.id))).body.entries).toHaveLength(before)

  // 用相同 ID 重新创建（不带 Key）：原 Session 不会接到新 Provider 上；旧 Credential 与明文缓存都已不在，请求不带旧 Key。
  expect(await saveProvider(sidecar, customProvider('custom-provider-1', fake.baseUrl, ['custom-model-1']))).toMatchObject({
    ok: true,
    provider: { credential: null },
  })
  expect(await api.get(apiPaths.providerReferences('custom-provider-1'))).toMatchObject({ body: { sessions: 0 } })
  expect((await api.get(apiPaths.session(s1.id))).body.session.model).toBeNull()
  expect((await api.post(apiPaths.sessionMessages(s1.id), { text: 'again' })).body).toMatchObject({ error: { code: 'model-required' } })
  // 用户重新选择模型后可以运行；新 Provider 没有 Key，模型服务收不到任何请求。
  expect((await api.put(apiPaths.sessionModel(s1.id), { model: deleted })).status).toBe(200)
  const requestsBefore = fake.requests.length
  expect((await api.post(apiPaths.sessionMessages(s1.id), { text: 'third' })).status).toBe(202)
  const end = (await stream.waitFor((m) => isRunEnd(s1.id)(m) && m.type === 'entry' && m.entry.seq > before)) as Extract<ServerMessage, { type: 'entry' }>
  expect(end.entry.payload).toMatchObject({ status: 'error' })
  expect(fake.requests).toHaveLength(requestsBefore)
  expect(decrypts).toEqual([testCipher.encrypt(firstKey)])
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

  // 库中没有该 Credential。
  const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
  try {
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_credentials WHERE provider_id = ?').get('custom-provider-1')).toEqual({ n: 0 })
  } finally {
    db.close()
  }
})

// 秘密不外泄总闸：获取可用模型通道（provider.models，ADR 0010）。新建表单的临时 Key 经 provider.models 交给 Sidecar，
// 供应商替身在错误中回显它；随后编辑已保存的 Provider 时带另一个临时 Key 获取。临时 Key 不得出现在库文件（含 -wal / -shm）、
// sidecar.jsonl、WebSocket 帧、HTTP 响应体或 sidecar 发往 main 的控制消息中，也不进入 CredentialStore 缓存（之后的 Run
// 仍用已保存的 Key）。
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage } from '@coko/protocol'
import { answerDecrypts, connect, customProvider, exchange, fetchModels, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, marker, persisted, recordingClient } from './secrets-gate-harness.ts'

/** 供应商替身：/models 在 Key 为 accepted 时返回模型列表，否则 401 并回显 Key；其他路径 400 并回显。记录全部鉴权头。 */
async function echoingProvider(accepted: string) {
  const auth: string[] = []
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const key = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
      auth.push(key)
      const listing = req.url?.endsWith('/models') && key === accepted
      res.writeHead(listing ? 200 : req.url?.endsWith('/models') ? 401 : 400, { 'content-type': 'application/json' })
      res.end(JSON.stringify(listing ? { data: [{ id: 'gate-model' }, { id: 'gate-model-2' }] } : { error: { message: `Incorrect API key provided: ${key}` } }))
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
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, auth }
}

describe('秘密不外泄总闸：获取可用模型', () => {
  it('临时 Key 不出现在库、日志、WebSocket 帧、HTTP 响应体与控制消息中，也不进入 CredentialStore 缓存', { timeout: 120_000 }, async () => {
    const saved = marker('saved')
    const creating = marker('create')
    // 不是凭据形态（不以 sk- 开头）：不能依赖按形态的脱敏规则，只能靠按值替换。
    const editing = `cokogateplain${randomBytes(12).toString('hex')}`
    const dirs = await sidecarDirs()
    const provider = await echoingProvider(creating)
    const sidecar = await startSidecar({ dirs })
    const decrypts = answerDecrypts(sidecar)
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)

    // 新建表单：用表单中的 Key 获取成功；同一 Key 被供应商拒绝并回显时，回答中已替换。
    expect(await fetchModels(sidecar, { baseUrl: provider.baseUrl, secret: creating })).toMatchObject({ ok: true, models: ['gate-model', 'gate-model-2'] })
    const rejected = await fetchModels(sidecar, { baseUrl: provider.baseUrl, secret: editing })
    // 前置：Key 确实发给了供应商并被回显（否则"没有明文"不能证明什么）。
    expect(rejected).toMatchObject({ ok: false, error: { code: 'upstream-error', status: 401, message: expect.stringContaining('Incorrect API key') } })

    // 保存 Provider（另一个 Key），编辑时带临时 Key 获取；之后的 Run 用的仍是已保存的 Key。
    expect(await saveProvider(sidecar, customProvider('gate-provider', provider.baseUrl, ['gate-model']), { secret: saved })).toMatchObject({ ok: true })
    expect(await fetchModels(sidecar, { baseUrl: provider.baseUrl, providerId: 'gate-provider', secret: editing })).toMatchObject({ ok: false })
    const workspace = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, model: { providerId: 'gate-provider', modelId: 'gate-model' } }))
      .body.id as string
    stream.send({ type: 'subscribe', sessionId: session, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === session)
    await api.post(apiPaths.sessionMessages(session), { text: 'hello' })
    const end = (await stream.waitFor((m) => m.type === 'entry' && m.sessionId === session && m.entry.kind === 'run_end')) as Extract<
      ServerMessage,
      { type: 'entry' }
    >
    expect(end.entry.payload).toMatchObject({ status: 'error' })
    expect(provider.auth.at(-1)).toBe(saved)
    expect(decrypts).toHaveLength(1)
    await api.get(apiPaths.session(session))
    await api.get(API_ROUTES.providers)
    await api.get(API_ROUTES.models)

    const running = await persisted(dirs)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...sidecar.messages.map((message, i): [string, string] => [`control ${message.type} ${i}`, JSON.stringify(message)]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { 'create key': creating, 'edit key': editing, 'saved key': saved })).toEqual([])
  })
})

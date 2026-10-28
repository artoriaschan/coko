// 秘密不外泄总闸（M1 retro 第 3 条，M2 规格 B4）：唯一标记的 Credential（环境变量模式）与同形态的宿主环境变量
// 经各种输出通道驱动后，WebSocket 帧、HTTP 响应体、coko.db（含 -wal / -shm）与 sidecar.jsonl 中都不得出现明文。
// 后续票引入新的输出通道（审批卡、沙箱、快照、确认）时，在本文件追加驱动步骤并把新的落盘位置加入扫描。
// 票 02：bash `env` 经审批卡通道（approval_request / approval_decision 条目、回答路由），参数原样出现在审批请求中。
// 票 03：该审批以"本 Workspace 总是允许"回答，建议规则写入设置（permissions.rules.workspace.*）；读回 /api/permissions 与 Session 规则。
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type ServerMessage } from '@coko/protocol'
import {
  connect,
  exchange,
  fauxScript,
  request,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  type HttpResult,
  type Sidecar,
  type SidecarDirs,
} from './sidecar-harness.ts'

/** 与真实密钥同形态（sk- 前缀、足够长）的唯一标记。 */
const marker = (label: string) => `sk-cokogate${label}${randomBytes(12).toString('hex')}`

/** 模型服务替身：把请求带来的 Authorization 原样回显在 400 错误里（真实服务的 "Incorrect API key provided: …"）。 */
async function echoingModelServer() {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${String(req.headers.authorization ?? '').replace(/^Bearer /, '')}` } }))
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
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
}

/** 记录每个 HTTP 响应体原文的客户端。 */
function recordingClient(sidecar: Pick<Sidecar, 'port'>, cookie: string, bodies: string[]) {
  const call = async (method: string, path: string, body?: unknown): Promise<HttpResult> => {
    const result = await request(sidecar.port, method, path, { headers: { cookie }, ...(body === undefined ? {} : { body }) })
    bodies.push(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null))
    return result
  }
  return { get: (path: string) => call('GET', path), post: (path: string, body?: unknown) => call('POST', path, body ?? {}) }
}

async function readDir(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  return Promise.all(names.map(async (name) => ({ name, bytes: await readFile(join(dir, name)) })))
}

/** 落盘位置：库文件（含 -wal、-shm）与日志目录（含轮转文件）。 */
async function persisted(dirs: SidecarDirs) {
  const files = [...(await readDir(dirs.dataDir)), ...(await readDir(dirs.logDir))]
  expect(files.some((f) => f.name === 'coko.db')).toBe(true)
  expect(files.some((f) => f.name === 'sidecar.jsonl')).toBe(true)
  return files
}

describe('秘密不外泄总闸', () => {
  it('Credential 与同形态宿主环境变量不出现在 WebSocket 帧、HTTP 响应体、库文件与日志中', { timeout: 120_000 }, async () => {
    const credential = marker('cred')
    const hostSecret = marker('host')
    const secrets = [credential, hostSecret]
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const baseUrl = await echoingModelServer()
    const script = await fauxScript(root, {
      responses: [
        // Run 1：可重试错误（retry 进度）后，不可重试错误回显 Credential（assistant.errorMessage 与 run_end.error）。
        { content: [], stopReason: 'error', errorMessage: `503 Service Unavailable for key ${credential}` },
        { content: [], stopReason: 'error', errorMessage: `Incorrect API key provided: ${credential}` },
        // retry 的 Run：bash env 与读取不存在的文件。
        {
          content: [
            { type: 'toolCall', name: 'bash', id: 'env1', arguments: { command: 'env' } },
            { type: 'toolCall', name: 'read', id: 'read1', arguments: { path: 'does/not/exist.txt' } },
          ],
        },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({
      dirs,
      ipc: false,
      env: { COKO_FAUX_SCRIPT: script, DEEPSEEK_API_KEY: credential, MY_SERVICE_API_KEY: hostSecret },
    })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: root })
    const ended = (sessionId: string, count: number) =>
      stream.waitFor(
        (m) =>
          m.type === 'entry' &&
          m.sessionId === sessionId &&
          m.entry.kind === 'run_end' &&
          stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= count,
      )

    // 1. faux：模型错误回显、可重试错误、bash env、读取失败。
    const faux = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId: faux, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === faux)
    await api.post(apiPaths.sessionMessages(faux), { text: 'hello' })
    await ended(faux, 1)
    expect((await api.post(apiPaths.sessionRetry(faux))).status).toBe(202)
    // 审批卡通道：bash env 等待审批（read 在 Workspace 内，不询问），经协议允许一次；等待时读回详情与列表。
    const approval = await waitApproval(stream, faux)
    expect(approval).toMatchObject({ toolCallId: 'env1', toolName: 'bash', subject: 'env' })
    await api.get(apiPaths.session(faux))
    await api.get(API_ROUTES.sessions)
    expect((await api.post(apiPaths.sessionApproval(faux, approval.requestId), { decision: 'allow', scope: 'workspace' })).status).toBe(204)
    await ended(faux, 2)
    // 权限通道：保存的 Workspace 规则、Session 规则与模式的读回。
    const permissions = await api.get(`${permissionPaths.permissions}?workspaceId=${workspace.body.id}`)
    expect(permissions.body.workspace.rules).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'env' }])
    await api.get(permissionPaths.sessionPermissionRules(faux))
    await api.get(API_ROUTES.settings)
    const fauxEntries = stream.entries(faux)
    // 前置：各通道确实被驱动（否则"没有明文"不能证明什么）。
    expect(stream.messages.some((m) => m.type === 'progress' && m.event.type === 'retry')).toBe(true)
    expect(fauxEntries.some((e) => e.kind === 'run_end' && (e.payload as { status: string }).status === 'error')).toBe(true)
    const results = fauxEntries.filter((e) => (e.payload as { role?: string }).role === 'toolResult').map((e) => JSON.stringify(e.payload))
    expect(results).toHaveLength(2)
    expect(results[0]).toContain('PATH=')
    expect(results[1]).toMatch(/ENOENT|not found|no such file/i)
    expect(fauxEntries.filter((e) => e.kind === 'approval_request' || e.kind === 'approval_decision')).toHaveLength(2)

    // 2. 环境变量模式的 Credential 经真实 Provider 发给模型服务，服务在错误中回显它。
    const provider = (await api.post(API_ROUTES.providers, { name: 'DS', kind: 'deepseek', baseUrl, models: ['deepseek-flash'] })).body
    const real = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, model: { providerId: provider.id, modelId: 'deepseek-flash' } })).body
      .id as string
    stream.send({ type: 'subscribe', sessionId: real, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === real)
    await api.post(apiPaths.sessionMessages(real), { text: 'hello' })
    const realEnd = (await ended(real, 1)) as Extract<ServerMessage, { type: 'entry' }>
    expect(realEnd.entry.payload).toMatchObject({ status: 'error', error: { code: 'model_error', message: expect.stringContaining('Incorrect API key') } })

    // 读回通道：详情与列表。
    await api.get(apiPaths.session(faux))
    await api.get(apiPaths.session(real))
    await api.get(API_ROUTES.sessions)
    await api.get(API_ROUTES.providers)
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    expect(running.some((f) => f.name === 'coko.db-wal')).toBe(true)
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)

    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    const leaks = channels.flatMap(([where, content]) =>
      secrets.filter((secret) => content.includes(secret)).map((secret) => `${where} contains ${secret === credential ? 'credential' : 'host secret'}`),
    )
    expect(leaks).toEqual([])
  })
})

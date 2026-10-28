// 秘密不外泄总闸（M1 retro 第 3 条，M2 规格 B4）：唯一标记的 Credential（环境变量模式）与同形态的宿主环境变量
// 经各种输出通道驱动后，WebSocket 帧、HTTP 响应体、coko.db（含 -wal / -shm）与 sidecar.jsonl 中都不得出现明文。
// 后续票引入新的输出通道（审批卡、沙箱、快照、确认）时，在本文件追加驱动步骤并把新的落盘位置加入扫描。
// 票 02：bash `env` 经审批卡通道（approval_request / approval_decision 条目、回答路由），参数原样出现在审批请求中。
// 票 03：该审批以"本 Workspace 总是允许"回答，建议规则写入设置（permissions.rules.workspace.*）；读回 /api/permissions 与 Session 规则。
// 票 05：沙箱拒绝输出（bash env 写到 Workspace 外被 Seatbelt 拒绝，拒绝标记与提权提示）、escalation 审批（理由回显 env 输出）、
// 提权后的 bash env，以及声明 Secrets 的测试工具（secret_probe，注入第三个标记）。Seatbelt 部分只在 darwin 运行。
// 票 07：accept-edits 下 write 覆盖已有文件，产生 file_backup / file_change 条目与 <dataDir>/blobs 下的快照文件；快照目录纳入扫描。
// 票 08：结果确认通道。bash 执行中 SIGKILL，重启后的启动扫描（confirmation_request、run_end interrupted、恢复日志）、确认回答
// （confirmation_answer 与补齐的 toolResult）与之后的继续；两个 Sidecar 进程的帧、响应体与落盘文件都纳入扫描。
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, runPaths, type ServerMessage } from '@coko/protocol'
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
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    put: (path: string, body: unknown) => call('PUT', path, body),
  }
}

/** 扫描全部通道，返回含明文的位置。 */
function leaksIn(channels: [string, string | Buffer][], secrets: Record<string, string>): string[] {
  return channels.flatMap(([where, content]) =>
    Object.entries(secrets)
      .filter(([, secret]) => content.includes(secret))
      .map(([label]) => `${where} contains ${label}`),
  )
}

/** 目录下的全部文件（递归，含 blobs/ 下的快照），name 为相对路径。 */
async function readDir(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
  return Promise.all(files.map(async (path) => ({ name: path.slice(dir.length + 1), bytes: await readFile(path) })))
}

/** 落盘位置：库文件（含 -wal、-shm）、快照目录（<dataDir>/blobs）与日志目录（含轮转文件）。 */
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
        // Checkpoint：write 覆盖已有文件（原内容存为快照）。
        { content: [{ type: 'toolCall', name: 'write', id: 'w1', arguments: { path: 'notes.txt', content: 'updated notes\n' } }] },
        { content: 'written' },
      ],
    })
    await writeFile(join(root, 'notes.txt'), 'original notes\n')
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
    // 执行记录通道：bash env 在执行前提交 tool_exec（只含 toolCallId、工具名与幂等键）。
    expect(fauxEntries.filter((e) => e.kind === 'tool_exec').map((e) => e.payload)).toEqual([
      { toolCallId: 'env1', toolName: 'bash', idempotencyKey: `${faux}:env1` },
    ])
    // 快照通道：accept-edits 下 write 覆盖 notes.txt → file_backup（blob）、file_change 与快照文件。
    expect((await api.put(permissionPaths.sessionPermissionMode(faux), { mode: 'accept-edits' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(faux), { text: 'update notes' })
    await ended(faux, 3)
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('updated notes\n')
    expect(
      stream
        .entries(faux)
        .filter((e) => e.kind === 'file_backup' || e.kind === 'file_change')
        .map((e) => e.kind),
    ).toEqual(['file_backup', 'file_change'])
    const snapshots = (await readDir(join(dirs.dataDir, 'blobs'))).filter((f) => !f.name.startsWith('.'))
    expect(snapshots.map((f) => f.bytes.toString())).toEqual(['original notes\n'])

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
    expect(leaksIn(channels, { credential, 'host secret': hostSecret })).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')('沙箱拒绝输出、提权流程与 Secrets 注入之后仍无明文（Seatbelt 只在 darwin 运行）', { timeout: 120_000 }, async () => {
    const credential = marker('cred')
    const hostSecret = marker('host')
    const toolSecret = marker('tool')
    const root = await tempDir()
    const outside = await tempDir('coko-gate-outside-')
    const dirs = await sidecarDirs()
    const escalated = { sandbox_permissions: 'danger-full-access', justification: 'Write the environment listing outside the workspace.' }
    const script = await fauxScript(root, {
      responses: [
        // 被沙箱拒绝的 env 转储（workspace-write）：输出含拒绝标记与提权提示。
        { content: [{ type: 'toolCall', name: 'bash', id: 'd1', arguments: { command: `env; env > ${outside}/env.txt` } }] },
        // 提权重试：escalation 审批后在 danger-full-access 下运行。
        { content: [{ type: 'toolCall', name: 'bash', id: 'e1', arguments: { command: `env; env > ${outside}/env.txt`, ...escalated } }] },
        // 声明 Secrets 的测试工具：值只进入其子进程，结果只有散列。
        { content: [{ type: 'toolCall', name: 'secret_probe', id: 's1', arguments: {} }] },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({
      dirs,
      ipc: false,
      env: { COKO_FAUX_SCRIPT: script, DEEPSEEK_API_KEY: credential, MY_SERVICE_API_KEY: hostSecret, COKO_TEST_TOOLS: '1', COKO_TEST_SECRET: toolSecret },
    })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: root })
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'dump env' })

    const answer = async (n: number, kind: string) => {
      const request = await waitApproval(stream, sessionId, n)
      expect(request.kind).toBe(kind)
      await api.get(apiPaths.session(sessionId))
      expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })).status).toBe(204)
    }
    await answer(1, 'tool')
    await answer(2, 'escalation')
    await answer(3, 'tool')
    await stream.waitFor((m) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === 'run_end')
    await api.get(apiPaths.session(sessionId))

    // 前置：各通道确实被驱动。
    const results = stream
      .entries(sessionId)
      .filter((e) => (e.payload as { role?: string }).role === 'toolResult')
      .map((e) => JSON.stringify(e.payload))
    expect(results).toHaveLength(3)
    expect(results[0]).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(results[0]).toContain('PATH=')
    expect(results[1]).toContain('PATH=')
    expect(results[2]).toContain('sha256')
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const written = await readDir(outside)
    expect(written.map((f) => f.name)).toEqual(['env.txt'])
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      // 提权后命令写出的文件同样经过宿主环境剔除。
      ...written.map((f): [string, Buffer] => [`escalated output ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential, 'host secret': hostSecret, 'tool secret': toolSecret })).toEqual([])
  })

  it('崩溃恢复与结果确认流程之后仍无明文', { timeout: 120_000 }, async () => {
    const credential = marker('cred')
    const hostSecret = marker('host')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    // 命令先输出环境再睡眠：被强杀时结果不明，重启后进入待确认。
    const script = await fauxScript(root, {
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'k1', arguments: { command: 'env; sleep 30' } }] }],
    })
    // 重启后的 faux 队列从头开始：继续时的回复单独成一个脚本。
    const resumed = await fauxScript(root, { responses: [{ content: 'resumed' }] }, 'faux-resumed.json')
    const env = { COKO_FAUX_SCRIPT: script, DEEPSEEK_API_KEY: credential, MY_SERVICE_API_KEY: hostSecret }
    const first = await startSidecar({ dirs, ipc: false, env })
    const bodies: string[] = []
    const firstCookie = await exchange(first)
    const firstApi = recordingClient(first, firstCookie, bodies)
    const firstStream = await connect(first, firstCookie)
    const workspace = await firstApi.post(API_ROUTES.workspaces, { path: root })
    const sessionId = (await firstApi.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    expect((await firstApi.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    firstStream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await firstStream.waitFor((m) => m.type === 'subscribed')
    await firstApi.post(apiPaths.sessionMessages(sessionId), { text: 'dump env' })
    await firstStream.waitFor((m) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === 'tool_exec')
    first.child.kill('SIGKILL')
    await first.exited

    const second = await startSidecar({ dirs, ipc: false, env: { ...env, COKO_FAUX_SCRIPT: resumed } })
    const cookie = await exchange(second)
    const api = recordingClient(second, cookie, bodies)
    const stream = await connect(second, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')
    await api.get(API_ROUTES.sessions)
    await api.get(apiPaths.session(sessionId))
    expect((await api.post(runPaths.sessionConfirmation(sessionId, 'k1'), { answer: 'unknown' })).status).toBe(204)
    expect((await api.post(runPaths.sessionContinue(sessionId))).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 2)
    await api.get(apiPaths.session(sessionId))
    // 前置：确认通道确实被驱动。
    const kinds = stream.entries(sessionId).map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['confirmation_request', 'confirmation_answer']))
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    second.child.kill('SIGTERM')
    expect(await second.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    expect(stopped.some((f) => f.name === 'sidecar.jsonl' && f.bytes.toString().includes('interrupted run recovered'))).toBe(true)
    const channels: [string, string | Buffer][] = [
      ...[...firstStream.frames, ...stream.frames].map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential, 'host secret': hostSecret })).toEqual([])
  })
})

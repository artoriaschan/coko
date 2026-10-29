// 秘密不外泄总闸（ADR 0004）：唯一标记的 Credential（环境变量模式）与同形态的宿主环境变量
// 经各种输出通道驱动后，WebSocket 帧、HTTP 响应体、coko.db（含 -wal / -shm）与 sidecar.jsonl 中都不得出现明文。
// M2 的通道在本文件；M3 起的新通道新增 secrets-gate-<channel>.test.ts，复用 secrets-gate-harness.ts。本文件覆盖的通道：
// 审批：bash `env` 经审批卡通道（approval_request / approval_decision 条目、回答路由），参数原样出现在审批请求中。
// 规则：该审批以"本 Workspace 总是允许"回答，建议规则写入设置（permissions.rules.workspace.*）；读回 /api/permissions 与 Session 规则。
// 沙箱：沙箱拒绝输出（bash env 写到 Workspace 外被 Seatbelt 拒绝，拒绝标记与提权提示）、escalation 审批（理由回显 env 输出）、
// 提权后的 bash env，以及声明 Secrets 的测试工具（secret_probe，注入第三个标记）。Seatbelt 部分只在 darwin 运行。
// Checkpoint：accept-edits 下 write 覆盖已有文件，产生 file_backup / file_change 条目与 <dataDir>/blobs 下的快照文件；快照目录纳入扫描。
// 恢复：结果确认通道。bash 执行中 SIGKILL，重启后的启动扫描（confirmation_request、run_end interrupted、恢复日志）、确认回答
// （confirmation_answer 与补齐的 toolResult）与之后的继续；两个 Sidecar 进程的帧、响应体与落盘文件都纳入扫描。
// 回退与分叉通道。Checkpoint 列表、回退 dry-run 与 both（rewind 条目、恢复的文件）、分叉（fork_origin 与复制的条目）及其读回。
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, permissionPaths, runPaths, type ServerMessage } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'
import { echoingModelServer, leaksIn, marker, persisted, readDir, recordingClient } from './secrets-gate-harness.ts'

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
    // 回退与分叉通道：Checkpoint 列表、dry-run、回退对话与代码（文件恢复为快照内容）、从此分叉（第一条消息，仍有效）与读回。
    const anchors = stream
      .entries(faux)
      .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')
      .map((e) => e.seq)
    const anchor = anchors.at(-1)!
    expect((await api.get(checkpointPaths.sessionCheckpoints(faux))).status).toBe(200)
    expect((await api.post(checkpointPaths.sessionRewind(faux), { targetSeq: anchor, mode: 'both', dryRun: true })).body.restored).toHaveLength(1)
    expect((await api.post(checkpointPaths.sessionRewind(faux), { targetSeq: anchor, mode: 'both' })).status).toBe(200)
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('original notes\n')
    const forked = await api.post(checkpointPaths.sessionFork(faux), { targetSeq: anchors[0] })
    expect(forked.status).toBe(201)
    await api.get(apiPaths.session(forked.body.sessionId))
    expect(stream.entries(faux).at(-1)?.kind).toBe('rewind')

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

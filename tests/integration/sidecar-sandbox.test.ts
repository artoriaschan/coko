// 命令沙箱、单次提权与 Secrets（票 05）：真实 Sidecar（faux 模型）经协议驱动 Seatbelt 拒绝、escalation 审批、
// sandbox-exec 不可用时 fail-closed、越出可写根的文件写入与 Secrets 注入。
// Seatbelt 用例只在 darwin 运行：其他平台没有 sandbox-exec，受限档位的命令在那里一律 fail-closed（ADR 0005）。
// Sidecar 进程未设 TMPDIR，系统临时目录为 /tmp；"Workspace 外"的目录建在测试进程的临时目录下，并先断言它不在可写根内。
import { createHash, randomBytes } from 'node:crypto'
import { access, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'

interface Paths {
  root: string
  outside: string
}

async function boot(responses: (paths: Paths) => unknown[], env: Record<string, string> = {}) {
  const root = await realpath(await tempDir())
  const outside = await realpath(await tempDir('coko-outside-'))
  // 前置：Workspace 外的目录确实不在 workspace-write 的可写根（Workspace、/tmp）内。
  expect(outside.startsWith(`${await realpath('/tmp')}/`)).toBe(false)
  const script = await fauxScript(root, { responses: responses({ root, outside }) }, '.faux.json')
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, ...env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  return { root, outside, sidecar, api, sessionId, stream }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
type ToolResult = { toolCallId: string; isError: boolean; content: { text?: string }[]; details?: unknown }
const toolResults = (entries: SessionEntryRecord[]) => entries.filter((e) => kindOf(e) === 'toolResult').map((e) => e.payload as ToolResult)
const text = (result: ToolResult) => result.content.map((b) => b.text ?? '').join('')
const bash = (id: string, command: string, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', name: 'bash', id, arguments: { command, ...extra } })
const runEnds = (stream: Stream, sessionId: string, n: number) =>
  stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
const resultOf = async (stream: Stream, sessionId: string, toolCallId: string) => {
  await stream.waitFor(() => toolResults(stream.entries(sessionId)).some((r) => r.toolCallId === toolCallId))
  return toolResults(stream.entries(sessionId)).find((r) => r.toolCallId === toolCallId)!
}
const approvals = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'approval_request')
const DENIED = (mode: string) => `[sandbox: file access denied under ${mode} mode]`
const HINT = '[sandbox: escalation available — retry this exact command once with sandbox_permissions'

describe.skipIf(!darwin)('Seatbelt（只在 darwin 运行：其他平台没有 sandbox-exec）', () => {
  it('default：已批准的 Workspace 外写入被拒绝（拒绝标记、提权提示、文件不存在）；Workspace 内与 /tmp 写入成功', async () => {
    const tmpFile = `/tmp/coko-it-${randomBytes(6).toString('hex')}`
    onTestFinished(() => rm(tmpFile, { force: true }))
    const { root, outside, api, sessionId, stream } = await boot(({ outside }) => [
      { content: [bash('b1', `echo x > ${outside}/f`)] },
      { content: [bash('b2', `echo in > in.txt && echo t > ${tmpFile}`)] },
      { content: 'done' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    for (const n of [1, 2]) {
      const request = await waitApproval(stream, sessionId, n)
      expect(request.kind).toBe('tool')
      expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })).status).toBe(204)
    }
    await runEnds(stream, sessionId, 1)
    const [denied, allowed] = toolResults(stream.entries(sessionId))
    expect(denied).toMatchObject({ toolCallId: 'b1', isError: true, details: { sandbox: { mode: 'workspace-write', denied: true } } })
    expect(text(denied!)).toMatch(/operation not permitted/i)
    expect(text(denied!)).toContain(DENIED('workspace-write'))
    expect(text(denied!)).toContain(HINT)
    expect(await exists(join(outside, 'f'))).toBe(false)
    expect(allowed).toMatchObject({ toolCallId: 'b2', isError: false })
    expect(await readFile(join(root, 'in.txt'), 'utf8')).toBe('in\n')
    expect(await readFile(tmpFile, 'utf8')).toBe('t\n')
    expect(stream.invalidEntries).toEqual([])
  })

  it('default：已批准的命令不能写 Workspace 内的 .git 与 .coko（受保护路径），普通文件照常写入', async () => {
    const { root, api, sessionId, stream } = await boot(() => [
      { content: [bash('b1', 'mkdir -p .git/hooks && echo x > .git/hooks/pre-commit')] },
      { content: [bash('b2', 'mkdir .coko')] },
      { content: [bash('b3', 'echo ok > ok.txt')] },
      { content: 'done' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    for (const n of [1, 2, 3]) {
      const request = await waitApproval(stream, sessionId, n)
      await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })
    }
    await runEnds(stream, sessionId, 1)
    for (const id of ['b1', 'b2']) expect(text(await resultOf(stream, sessionId, id))).toContain(DENIED('workspace-write'))
    expect(await exists(join(root, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(await exists(join(root, '.coko'))).toBe(false)
    expect(await readFile(join(root, 'ok.txt'), 'utf8')).toBe('ok\n')
  })

  it('read-only：已批准的命令不能写 Workspace', async () => {
    const { root, api, sessionId, stream } = await boot(() => [{ content: [bash('b1', 'echo x > in.txt')] }, { content: 'done' }])
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'read-only' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const request = await waitApproval(stream, sessionId)
    await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })
    const result = await resultOf(stream, sessionId, 'b1')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(DENIED('read-only'))
    expect(await exists(join(root, 'in.txt'))).toBe(false)
  })

  it('提权：未被沙箱拒绝过的命令不能提权；被拒后 escalation 卡带目标档位与理由、只能允许一次；批准后成功；随后不带参数的同一命令再次被拒；拒绝提权 → 停止并说明', async () => {
    const escalated = { sandbox_permissions: 'danger-full-access', justification: 'The file lives outside the workspace.' }
    const { outside, api, sessionId, stream } = await boot(({ outside }) => [
      { content: [bash('e0', `printf 1 >> ${outside}/f`, escalated)] },
      { content: [bash('p0', `printf 1 >> ${outside}/f`)] },
      { content: [bash('e1', `printf 1 >> ${outside}/f`, escalated)] },
      { content: [bash('p1', `printf 1 >> ${outside}/f`)] },
      { content: [bash('e2', `printf 1 >> ${outside}/f`, escalated)] },
      { content: 'should not be used' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'append' })

    // 先请求提权（本 Run 中没有被拒绝过）：参数错误，不询问。随后不带参数运行：普通审批，在 workspace-write 下被拒。
    const first = await waitApproval(stream, sessionId, 1)
    expect(first).toMatchObject({ toolCallId: 'p0', kind: 'tool' })
    expect(text(await resultOf(stream, sessionId, 'e0'))).toContain('sandbox_permissions only retries a command the sandbox denied in this run')
    await api.post(apiPaths.sessionApproval(sessionId, first.requestId), { decision: 'allow' })
    expect(text(await resultOf(stream, sessionId, 'p0'))).toContain(DENIED('workspace-write'))

    const escalation = await waitApproval(stream, sessionId, 2)
    expect(escalation).toMatchObject({
      toolCallId: 'e1',
      kind: 'escalation',
      targetMode: 'danger-full-access',
      justification: 'The file lives outside the workspace.',
      suggestions: [],
    })
    const path = apiPaths.sessionApproval(sessionId, escalation.requestId)
    expect((await api.post(path, { decision: 'allow', scope: 'session' })).body).toMatchObject({ error: { code: 'bad-request' } })
    expect((await api.post(path, { decision: 'allow' })).status).toBe(204)
    expect((await resultOf(stream, sessionId, 'e1')).isError).toBe(false)
    expect(await readFile(join(outside, 'f'), 'utf8')).toBe('1')

    // 不带参数的同一命令：普通审批（kind=tool），批准后仍在 workspace-write 内被拒，文件不变。
    const plain = await waitApproval(stream, sessionId, 3)
    expect(plain).toMatchObject({ toolCallId: 'p1', kind: 'tool' })
    await api.post(apiPaths.sessionApproval(sessionId, plain.requestId), { decision: 'allow' })
    expect(text(await resultOf(stream, sessionId, 'p1'))).toContain(DENIED('workspace-write'))
    expect(await readFile(join(outside, 'f'), 'utf8')).toBe('1')

    // 拒绝提权（无反馈）：错误文本要求停止并说明，Run 以 aborted 结束，文件不变。
    const second = await waitApproval(stream, sessionId, 4)
    expect(second).toMatchObject({ toolCallId: 'e2', kind: 'escalation' })
    await api.post(apiPaths.sessionApproval(sessionId, second.requestId), { decision: 'deny' })
    await runEnds(stream, sessionId, 1)
    const rejected = await resultOf(stream, sessionId, 'e2')
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('it stays denied, so stop and explain instead of working around it')
    expect(stream.entries(sessionId).at(-1)?.payload).toEqual({ status: 'aborted' })
    expect(await readFile(join(outside, 'f'), 'utf8')).toBe('1')
    // 提权不能保存为规则：Session 规则仍为空。
    expect((await api.get(permissionPaths.sessionPermissionRules(sessionId))).body.rules).toEqual([])
    expect(stream.invalidEntries).toEqual([])
  })
})

describe('提权参数错误', () => {
  it('只给理由、目标档位更窄或不在取值内 → 参数错误且不弹审批，命令不执行', async () => {
    const { root, api, sessionId, stream } = await boot(() => [
      {
        content: [
          bash('j1', 'touch only-reason', { justification: 'because' }),
          bash('n1', 'touch bad-enum', { sandbox_permissions: 'read-only', justification: 'narrower' }),
        ],
      },
      { content: 'first done' },
      { content: [bash('n2', 'touch narrower', { sandbox_permissions: 'workspace-write', justification: 'narrower' })] },
      { content: 'second done' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'one' })
    await runEnds(stream, sessionId, 1)
    expect(text(await resultOf(stream, sessionId, 'j1'))).toContain('justification is only valid together with sandbox_permissions')
    expect((await resultOf(stream, sessionId, 'n1')).isError).toBe(true)

    // full-access 下 workspace-write 更窄。
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'two' })
    await runEnds(stream, sessionId, 2)
    expect(text(await resultOf(stream, sessionId, 'n2'))).toContain('not strictly wider than this call\'s current "danger-full-access" mode')

    expect(approvals(stream, sessionId)).toEqual([])
    for (const name of ['only-reason', 'bad-enum', 'narrower']) expect(await exists(join(root, name))).toBe(false)
  })
})

describe('sandbox-exec 不可用', () => {
  it('COKO_SANDBOX_EXEC 指向不存在的路径 → 受限档位的命令返回 sandbox-unavailable 且未执行；full-access 正常', async () => {
    const { root, sidecar, api, sessionId, stream } = await boot(
      () => [
        { content: [bash('b1', 'touch confined-marker')] },
        { content: 'first done' },
        { content: [bash('b2', 'touch full-marker')] },
        { content: 'second done' },
      ],
      { COKO_SANDBOX_EXEC: '/nonexistent/coko/sandbox-exec' },
    )
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'one' })
    const request = await waitApproval(stream, sessionId)
    await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })
    const confined = await resultOf(stream, sessionId, 'b1')
    expect(confined.isError).toBe(true)
    expect(text(confined)).toMatch(/^sandbox-unavailable: the command was not run because the workspace-write sandbox is not available/)
    expect(await exists(join(root, 'confined-marker'))).toBe(false)
    await runEnds(stream, sessionId, 1)

    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'two' })
    expect((await resultOf(stream, sessionId, 'b2')).isError).toBe(false)
    expect(await exists(join(root, 'full-marker'))).toBe(true)
    expect(sidecar.stderr()).not.toContain('fatal')
  })
})

describe('越出可写根的文件写入', () => {
  it('accept-edits 下 write 到 Workspace 外 → 询问且不能保存为总是允许；批准后写入成功、未生成规则', async () => {
    const { outside, api, sessionId, stream } = await boot(({ outside }) => [
      { content: [{ type: 'toolCall', name: 'write', id: 'w1', arguments: { path: join(outside, 'note.txt'), content: 'outside' } }] },
      { content: [{ type: 'toolCall', name: 'write', id: 'w2', arguments: { path: 'inside.txt', content: 'inside' } }] },
      { content: 'done' },
    ])
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'accept-edits' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write' })
    const request = await waitApproval(stream, sessionId)
    expect(request).toMatchObject({ toolCallId: 'w1', toolName: 'write', kind: 'tool', suggestions: [] })
    expect(await exists(join(outside, 'note.txt'))).toBe(false)
    const path = apiPaths.sessionApproval(sessionId, request.requestId)
    for (const scope of ['session', 'workspace', 'global']) expect((await api.post(path, { decision: 'allow', scope })).status).toBe(400)
    expect((await api.post(path, { decision: 'allow' })).status).toBe(204)
    await runEnds(stream, sessionId, 1)
    expect(await readFile(join(outside, 'note.txt'), 'utf8')).toBe('outside')
    // Workspace 内的写入由 accept-edits 放行，不再询问。
    expect(approvals(stream, sessionId)).toHaveLength(1)
    expect((await api.get(permissionPaths.sessionPermissionRules(sessionId))).body.rules).toEqual([])
    expect(stream.entries(sessionId).filter((e) => e.kind === 'permission_rule')).toEqual([])
  })
})

describe('Secrets 注入', () => {
  it('声明 secrets 的测试宿主工具在其子进程中拿到值；同一 Session 的 bash env 中没有', async () => {
    const secret = `sk-cokosecret${randomBytes(12).toString('hex')}`
    const { api, sessionId, stream } = await boot(
      () => [{ content: [{ type: 'toolCall', name: 'secret_probe', id: 's1', arguments: {} }, bash('b1', 'env')] }, { content: 'done' }],
      { COKO_TEST_TOOLS: '1', COKO_TEST_SECRET: secret },
    )
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'probe' })
    await runEnds(stream, sessionId, 1)
    const probe = await resultOf(stream, sessionId, 's1')
    expect(JSON.parse(text(probe))).toEqual({ sha256: createHash('sha256').update(secret).digest('hex'), length: secret.length })
    const env = text(await resultOf(stream, sessionId, 'b1'))
    expect(env).toContain('PATH=')
    expect(env).not.toContain('COKO_TEST_SECRET')
    expect(env).not.toContain(secret)
    expect(stream.frames.some((frame) => frame.includes(secret))).toBe(false)
  })
})

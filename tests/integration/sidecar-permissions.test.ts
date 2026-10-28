// 权限模式、规则作用域与重新判定：真实 Sidecar（faux 模型）经协议驱动，重启后读回规则与模式。
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  isRunEnd,
  request,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  type Sidecar,
  type SidecarDirs,
  type Stream,
} from './sidecar-harness.ts'

const bash = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })
const write = (id: string, path: string) => ({ type: 'toolCall', name: 'write', id, arguments: { path, content: 'x' } })
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const toolResults = (entries: SessionEntryRecord[]) =>
  entries.filter((e) => kindOf(e) === 'toolResult').map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] })
const text = (result: { content: { text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')

async function boot(root: string, dirs: SidecarDirs, responses: unknown[], name = 'faux.json') {
  const script = await fauxScript(root, { responses }, name)
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  return { sidecar, cookie, api, stream }
}

type Api = ReturnType<typeof client>

async function newSession(api: Api, stream: Stream, workspaceId: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

/** 提交一条消息并等 Run 结束；返回本次 Run 中的审批请求数。 */
async function runToEnd(api: Api, stream: Stream, sessionId: string, text = 'go') {
  const before = stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
  const asked = () => stream.entries(sessionId).filter((e) => e.kind === 'approval_request').length
  const askedBefore = asked()
  await api.post(apiPaths.sessionMessages(sessionId), { text })
  await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length > before)
  return asked() - askedBefore
}

const deleteRule = (sidecar: Sidecar, cookie: string, sessionId: string, rule: unknown) =>
  request(sidecar.port, 'DELETE', permissionPaths.sessionPermissionRules(sessionId), { headers: { cookie }, body: { rule } })

describe('规则作用域与持久化', () => {
  it('"本 Workspace 总是允许"后同类调用不再询问；Session 规则只影响该 Session；重启 Sidecar 后规则与模式仍生效', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const first = await boot(root, dirs, [
      { content: [bash('b1', 'printf a > a.txt')] },
      { content: 'ok' },
      { content: [bash('b2', 'printf a > a.txt')] },
      { content: 'ok' },
      { content: [bash('b3', 'printf s > s.txt')] },
      { content: 'ok' },
    ])
    const workspaceId = (await first.api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const one = await newSession(first.api, first.stream, workspaceId)
    const two = await newSession(first.api, first.stream, workspaceId)

    // Session 一：询问，选"本 Workspace 总是允许"。
    await first.api.post(apiPaths.sessionMessages(one), { text: 'go' })
    const asked = await waitApproval(first.stream, one)
    expect(asked.suggestions).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'printf a > a.txt' }])
    expect((await first.api.post(apiPaths.sessionApproval(one, asked.requestId), { decision: 'allow', scope: 'workspace' })).status).toBe(204)
    await first.stream.waitFor(isRunEnd(one))
    expect(first.stream.entries(one).find((e) => e.kind === 'approval_decision')?.payload).toEqual({
      requestId: asked.requestId,
      outcome: 'allowed',
      scope: 'workspace',
    })
    const saved = (await first.api.get(`${permissionPaths.permissions}?workspaceId=${workspaceId}`)).body
    expect(saved.workspace).toEqual({ workspaceId, rules: [{ behavior: 'allow', tool: 'Bash', content: 'printf a > a.txt' }], revision: 1 })
    expect(saved.global).toEqual({ rules: [], revision: 0 })

    // Session 二（同一 Workspace）：同类调用不再询问。
    expect(await runToEnd(first.api, first.stream, two)).toBe(0)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a')

    // Session 二：Session 规则 + accept-edits。
    const sessionRule = { behavior: 'allow', tool: 'Bash', content: 'printf s *' }
    expect((await first.api.post(permissionPaths.sessionPermissionRules(two), { rule: sessionRule })).body).toEqual({ mode: 'default', rules: [sessionRule] })
    expect((await first.api.put(permissionPaths.sessionPermissionMode(two), { mode: 'accept-edits' })).body).toEqual({
      mode: 'accept-edits',
      rules: [sessionRule],
    })
    expect(await runToEnd(first.api, first.stream, two)).toBe(0)
    expect(await readFile(join(root, 's.txt'), 'utf8')).toBe('s')
    expect(
      first.stream
        .entries(two)
        .filter((e) => e.kind === 'permission_mode' || e.kind === 'permission_rule')
        .map((e) => e.payload),
    ).toEqual([{ mode: 'default' }, { op: 'add', rule: sessionRule }, { mode: 'accept-edits' }])
    await first.sidecar.stop()

    // 重启：Workspace 规则、Session 规则与模式都由库读回。
    const second = await boot(
      root,
      dirs,
      [
        { content: [bash('c1', 'printf s > s2.txt'), write('c2', 'w.txt')] },
        { content: 'ok' },
        { content: [bash('c3', 'printf s > s3.txt')] },
        { content: 'ok' },
        { content: [bash('c4', 'printf a > a.txt')] },
        { content: 'ok' },
      ],
      'faux-2.json',
    )
    for (const id of [one, two]) {
      second.stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
      await second.stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
    }
    expect((await second.api.get(permissionPaths.sessionPermissionRules(two))).body).toEqual({ mode: 'accept-edits', rules: [sessionRule] })
    // Session 二：Session 规则放行命令，accept-edits 放行 Workspace 内写入。
    expect(await runToEnd(second.api, second.stream, two)).toBe(0)
    expect(await readFile(join(root, 's2.txt'), 'utf8')).toBe('s')
    expect(await readFile(join(root, 'w.txt'), 'utf8')).toBe('x')
    // Session 一：没有该 Session 规则，仍询问。
    await second.api.post(apiPaths.sessionMessages(one), { text: 'go' })
    const again = await waitApproval(second.stream, one, 2)
    expect(again.subject).toBe('printf s > s3.txt')
    await second.api.post(apiPaths.sessionApproval(one, again.requestId), { decision: 'deny', feedback: 'no' })
    await second.stream.waitFor(() => second.stream.entries(one).filter((e) => e.kind === 'run_end').length >= 2)
    // Workspace 规则重启后仍生效。
    expect(await runToEnd(second.api, second.stream, one)).toBe(0)
    expect(await exists(join(root, 's3.txt'))).toBe(false)
    expect(second.stream.invalidEntries).toEqual([])
  })

  it('"本 Session 总是允许"保存为 permission_rule 条目；没有建议规则的请求只能允许一次；删除 Session 规则后再次询问', async () => {
    const root = await tempDir()
    const { sidecar, cookie, api, stream } = await boot(root, await sidecarDirs(), [
      { content: [bash('b1', 'printf a > a.txt')] },
      { content: 'ok' },
      { content: [bash('b2', 'printf a > a.txt')] },
      { content: 'ok' },
      { content: [write('b3', '.git/config')] },
      { content: 'ok' },
      { content: [bash('b4', 'printf a > a.txt')] },
      { content: 'ok' },
    ])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = await newSession(api, stream, workspaceId)

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const first = await waitApproval(stream, sessionId)
    await api.post(apiPaths.sessionApproval(sessionId, first.requestId), { decision: 'allow', scope: 'session' })
    await stream.waitFor(isRunEnd(sessionId))
    const order = stream.entries(sessionId).map(kindOf)
    expect(order.indexOf('permission_rule')).toBeLessThan(order.indexOf('approval_decision'))
    expect(await runToEnd(api, stream, sessionId)).toBe(0)

    // 受保护路径：没有建议规则，"总是允许"被拒绝，请求仍在等待。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const guarded = await waitApproval(stream, sessionId, 2)
    expect(guarded).toMatchObject({ toolName: 'write', suggestions: [] })
    expect((await api.post(apiPaths.sessionApproval(sessionId, guarded.requestId), { decision: 'allow', scope: 'global' })).body).toMatchObject({
      error: { code: 'bad-request' },
    })
    expect((await api.post(apiPaths.sessionApproval(sessionId, guarded.requestId), { decision: 'deny', feedback: 'no' })).status).toBe(204)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 3)
    expect((await api.get(permissionPaths.permissions)).body.global.rules).toEqual([])

    const saved = { behavior: 'allow', tool: 'Bash', content: 'printf a > a.txt' }
    expect((await deleteRule(sidecar, cookie, sessionId, saved)).body).toEqual({ mode: 'default', rules: [] })
    expect((await deleteRule(sidecar, cookie, sessionId, saved)).status).toBe(200)
    expect(
      stream
        .entries(sessionId)
        .filter((e) => e.kind === 'permission_rule')
        .map((e) => e.payload),
    ).toEqual([
      { op: 'add', rule: saved },
      { op: 'remove', rule: saved },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    expect((await waitApproval(stream, sessionId, 3)).toolCallId).toBe('b4')
    await api.post(apiPaths.sessionAbort(sessionId))
  })
})

describe('等待审批时的重新判定', () => {
  it('切到 full-access → 请求以 superseded 结束并执行', async () => {
    const root = await tempDir()
    const { api, stream } = await boot(root, await sidecarDirs(), [{ content: [bash('b1', 'printf a > a.txt')] }, { content: 'ok' }])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = await newSession(api, stream, workspaceId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const asked = await waitApproval(stream, sessionId)

    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    await stream.waitFor(isRunEnd(sessionId))
    expect(stream.entries(sessionId).find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: asked.requestId, outcome: 'superseded' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a')
    expect(stream.entries(sessionId).at(-1)?.payload).toEqual({ status: 'completed' })
    expect((await api.post(apiPaths.sessionApproval(sessionId, asked.requestId), { decision: 'allow' })).status).toBe(409)
  })

  it('新增全局拒绝规则 → 请求以 superseded 结束并以规则拒绝，Run 继续', async () => {
    const root = await tempDir()
    const { api, stream } = await boot(root, await sidecarDirs(), [{ content: [bash('b1', 'git status && rm -rf build')] }, { content: 'understood' }])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = await newSession(api, stream, workspaceId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const asked = await waitApproval(stream, sessionId)
    expect(asked.suggestions).toEqual([
      { behavior: 'allow', tool: 'Bash', content: 'git status' },
      { behavior: 'allow', tool: 'Bash', content: 'rm -rf build' },
    ])

    const updated = await api.put(permissionPaths.permissions, {
      target: 'global',
      rules: [{ behavior: 'deny', tool: 'Bash', content: 'rm *' }],
      expectedRevision: 0,
    })
    expect(updated.body.global).toEqual({ rules: [{ behavior: 'deny', tool: 'Bash', content: 'rm *' }], revision: 1 })
    await stream.waitFor(isRunEnd(sessionId))
    const entries = stream.entries(sessionId)
    expect(entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: asked.requestId, outcome: 'superseded' })
    const [result] = toolResults(entries)
    expect(result).toMatchObject({ toolCallId: 'b1', isError: true })
    expect(text(result!)).toBe('Permission denied by rule Bash(rm *).')
    expect(entries.at(-1)?.payload).toEqual({ status: 'completed' })
  })
})

describe('默认模式与设置校验', () => {
  it('新 Session 的初始模式取 permissions.defaultMode；非法值 400；revision 冲突 409；通用设置接口不能写 permissions.*', async () => {
    const root = await tempDir()
    const { api, stream } = await boot(root, await sidecarDirs(), [{ content: [write('w1', 'w.txt')] }, { content: 'ok' }])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string

    const initial = (await api.get(permissionPaths.permissions)).body
    expect(initial).toEqual({ defaultMode: { value: 'default', revision: 0 }, global: { rules: [], revision: 0 } })
    for (const bad of [
      { target: 'defaultMode', value: 'yolo', expectedRevision: 0 },
      { target: 'global', rules: [{ behavior: 'allow', tool: '' }], expectedRevision: 0 },
      { target: 'global', rules: [{ behavior: 'permit', tool: 'Bash' }], expectedRevision: 0 },
      { target: 'global', rules: [{ behavior: 'allow', tool: 'Bash', content: '' }], expectedRevision: 0 },
      { target: 'workspace', rules: [], expectedRevision: 0 },
      { target: 'everything', expectedRevision: 0 },
    ]) {
      expect((await api.put(permissionPaths.permissions, bad)).body).toMatchObject({ error: { code: 'bad-request' } })
    }
    expect((await api.put(permissionPaths.permissions, { target: 'workspace', workspaceId: 'missing', rules: [], expectedRevision: 0 })).status).toBe(404)
    for (const key of ['permissions.defaultMode', 'permissions.rules', `permissions.rules.workspace.${workspaceId}`]) {
      expect((await api.put(apiPaths.setting(key), { value: 'full-access', expectedRevision: 0 })).body).toMatchObject({ error: { code: 'bad-request' } })
    }
    expect((await api.get(API_ROUTES.settings)).body.settings).toEqual([])

    expect((await api.put(permissionPaths.permissions, { target: 'defaultMode', value: 'accept-edits', expectedRevision: 0 })).body.defaultMode).toEqual({
      value: 'accept-edits',
      revision: 1,
    })
    expect((await api.put(permissionPaths.permissions, { target: 'defaultMode', value: 'read-only', expectedRevision: 0 })).body).toMatchObject({
      error: { code: 'revision-conflict' },
    })

    const sessionId = await newSession(api, stream, workspaceId)
    expect(stream.entries(sessionId)[0]).toMatchObject({ kind: 'permission_mode', payload: { mode: 'accept-edits' } })
    expect(await runToEnd(api, stream, sessionId)).toBe(0)
    expect(await readFile(join(root, 'w.txt'), 'utf8')).toBe('x')

    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'yolo' })).status).toBe(400)
    expect((await api.put(permissionPaths.sessionPermissionMode('missing'), { mode: 'default' })).status).toBe(404)
    expect((await api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'allow', tool: 'Bash', content: '' } })).status).toBe(400)
  })
})

describe('规则工具名（大小写与别名）', () => {
  it('写入时归一为规范名，未知工具名 400 unknown-tool；deny bash(rm *) 与 Write(secret.txt) 在 full-access 下生效', async () => {
    const root = await tempDir()
    const { api, stream } = await boot(root, await sidecarDirs(), [{ content: [bash('b1', 'rm -rf victim'), write('w1', 'secret.txt')] }, { content: 'done' }])
    await import('node:fs/promises').then((fs) => fs.mkdir(join(root, 'victim')))
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string

    const unknown = await api.put(permissionPaths.permissions, {
      target: 'global',
      rules: [{ behavior: 'deny', tool: 'deploy' }],
      expectedRevision: 0,
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'bad-request', details: { reason: 'unknown-tool', tool: 'deploy' } } })

    const saved = await api.put(permissionPaths.permissions, {
      target: 'global',
      rules: [
        { behavior: 'deny', tool: 'bash', content: 'rm *' },
        { behavior: 'deny', tool: 'Write', content: 'secret.txt' },
      ],
      expectedRevision: 0,
    })
    expect(saved.status).toBe(200)
    expect(saved.body.global.rules).toEqual([
      { behavior: 'deny', tool: 'Bash', content: 'rm *' },
      { behavior: 'deny', tool: 'Edit', content: 'secret.txt' },
    ])

    const sessionId = await newSession(api, stream, workspaceId)
    const sessionRule = await api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'deny', tool: 'GREP', content: 'x' } })
    expect(sessionRule.body.rules).toEqual([{ behavior: 'deny', tool: 'Read', content: 'x' }])
    expect((await api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'allow', tool: 'nope' } })).status).toBe(400)

    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    expect(await runToEnd(api, stream, sessionId)).toBe(0)
    const results = toolResults(stream.entries(sessionId))
    expect(results.map((r) => [r.toolCallId, r.isError, text(r)])).toEqual([
      ['b1', true, 'Permission denied by rule Bash(rm *).'],
      ['w1', true, 'Permission denied by rule Edit(secret.txt).'],
    ])
    expect(await exists(join(root, 'victim'))).toBe(true)
    expect(await exists(join(root, 'secret.txt'))).toBe(false)
  })
})

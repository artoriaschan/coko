// 分层配置（票 02）：GET / PUT /api/config 与项目 .coko/settings.json（只收紧，ADR 0008），以及项目 deny / ask 规则作为
// project 作用域参与权限判定。真实 Sidecar（faux 模型）经协议驱动；项目文件在两次请求或两个 Run 之间改写。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

const bash = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })
type Api = ReturnType<typeof client>

async function writeProject(workspace: string, value: unknown) {
  await mkdir(join(workspace, '.coko'), { recursive: true })
  await writeFile(join(workspace, '.coko', 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

async function boot(root: string, responses: unknown[]) {
  const script = await fauxScript(root, { responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  return { sidecar, api: client(sidecar, cookie), stream: await connect(sidecar, cookie) }
}

async function newSession(api: Api, stream: Stream, workspaceId: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
const results = (entries: SessionEntryRecord[]) =>
  entries
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] })
const text = (result: { content: { text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')

describe('GET / PUT /api/config', () => {
  it('返回有效值、全局值、revision 与项目诊断；项目只收紧；过期 revision 409；通用设置接口不能写 config；改文件后下一次 GET 读到新值', async () => {
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    const { sidecar, api } = await boot(root, [])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const path = join(workspace, '.coko', 'settings.json')
    const url = `${configPaths.config}?workspaceId=${workspaceId}`

    // 没有项目文件：全部默认，项目路径照常给出。
    const empty = (await api.get(url)).body
    expect(empty).toEqual({
      effective: {
        instructions: { enabled: true },
        skills: { enabled: true, disabled: [] },
        commands: { enabled: true, disabled: [] },
        mcp: { enabled: true },
        memory: { enabled: true },
        context: { autoCompact: true, trimOldToolResults: true },
      },
      global: {},
      globalRevision: 0,
      project: { path, exists: false, values: {}, diagnostics: [] },
    })

    await writeProject(workspace, {
      memory: { enabled: false },
      mcp: { enabled: true },
      skills: { disabled: ['deploy'] },
      permissions: { allow: ['Bash(*)'], deny: ['Bash(rm *)'], defaultMode: 'full-access' },
      theme: 'dark',
      context: { autoCompact: 'no' },
    })
    const first = (await api.get(url)).body
    expect(first.effective).toMatchObject({ memory: { enabled: false }, mcp: { enabled: true }, skills: { enabled: true, disabled: ['deploy'] } })
    expect(first.project.exists).toBe(true)
    expect(first.project.values).toEqual({ memory: { enabled: false }, skills: { disabled: ['deploy'] }, permissions: { deny: ['Bash(rm *)'], ask: [] } })
    expect(first.project.diagnostics.map((d: { code: string; path: string; source: string }) => [d.code, d.path, d.source])).toEqual([
      ['project-cannot-grant', path, 'config'],
      ['project-cannot-grant', path, 'config'],
      ['project-cannot-grant', path, 'config'],
      ['unknown-key', path, 'config'],
      ['invalid-value', path, 'config'],
    ])

    // 全局：关闭 mcp、禁用 a；项目的 true 不能打开全局的 false。
    const saved = await api.put(configPaths.config, { values: { mcp: { enabled: false }, skills: { disabled: ['a'] } }, expectedRevision: 0, workspaceId })
    expect(saved.status).toBe(200)
    expect(saved.body.globalRevision).toBe(1)
    expect(saved.body.global).toEqual({ mcp: { enabled: false }, skills: { disabled: ['a'] } })
    expect(saved.body.effective).toMatchObject({ mcp: { enabled: false }, memory: { enabled: false }, skills: { disabled: ['a', 'deploy'] } })
    expect((await api.get(configPaths.config)).body).toMatchObject({ globalRevision: 1, effective: { memory: { enabled: true }, mcp: { enabled: false } } })
    expect((await api.get(configPaths.config)).body).not.toHaveProperty('project')

    const stale = await api.put(configPaths.config, { values: {}, expectedRevision: 0 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('revision-conflict')
    const invalid = await api.put(configPaths.config, { values: { memory: { enabled: 'no' } }, expectedRevision: 1 })
    expect(invalid.status).toBe(400)
    expect((await api.put(configPaths.config, { values: { theme: {} }, expectedRevision: 1 })).status).toBe(400)
    for (const key of ['config', 'config.extra']) {
      const generic = await api.put(apiPaths.setting(key), { value: {}, expectedRevision: 0 })
      expect(generic.status).toBe(400)
      expect(generic.body.error.code).toBe('bad-request')
    }
    expect((await api.get(`${configPaths.config}?workspaceId=missing`)).status).toBe(404)

    // 改写项目文件：下一次 GET 读到新值；JSON 解析失败时整个文件被忽略。
    await writeProject(workspace, { memory: { enabled: false }, instructions: { enabled: false } })
    expect((await api.get(url)).body.effective).toMatchObject({ instructions: { enabled: false }, memory: { enabled: false }, skills: { disabled: ['a'] } })
    await writeProject(workspace, '{ "memory": { "enabled": false },')
    const broken = (await api.get(url)).body
    expect(broken.effective.memory.enabled).toBe(true)
    expect(broken.project.values).toEqual({})
    expect(broken.project.diagnostics.map((d: { code: string }) => d.code)).toEqual(['invalid-json'])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('项目规则（project 作用域）', () => {
  it('项目 deny 规则在 full-access 下拒绝调用（改文件后下一个 Run 生效），项目 allow 规则不放行；全局、Workspace 与 Session 规则照常', async () => {
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    const { sidecar, api, stream } = await boot(root, [
      { content: [bash('e1', 'echo one')] },
      { content: 'ok' },
      { content: [bash('e2', 'echo two'), bash('p2', 'printf two')] },
      { content: 'ok' },
      { content: [bash('p3', 'printf three')] },
      { content: 'ok' },
      { content: [bash('p4', 'printf three')] },
      { content: 'ok' },
    ])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const sessionId = await newSession(api, stream, workspaceId)
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    // 全局允许 echo：项目的拒绝规则仍然优先（判定顺序：拒绝规则在最前）。
    expect(
      (await api.put(permissionPaths.permissions, { target: 'global', rules: [{ behavior: 'allow', tool: 'Bash', content: 'echo *' }], expectedRevision: 0 }))
        .status,
    ).toBe(200)

    // Run 1：还没有项目文件，echo 执行。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    await stream.waitFor(() => runEnds(stream, sessionId) >= 1)
    expect(results(stream.entries(sessionId)).map((r) => [r.toolCallId, r.isError])).toEqual([['e1', false]])

    // 写入项目文件后的下一个 Run：echo 被拒绝，printf 照常（full-access）。
    await writeProject(workspace, { permissions: { deny: ['bash(echo *)'], allow: ['Bash(printf *)'] } })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    await stream.waitFor(() => runEnds(stream, sessionId) >= 2)
    const second = results(stream.entries(sessionId)).slice(1)
    expect(second.map((r) => [r.toolCallId, r.isError])).toEqual([
      ['e2', true],
      ['p2', false],
    ])
    expect(text(second[0]!)).toBe('Permission denied by rule Bash(echo *).')

    // 读取接口：项目规则只读、按规范名、标出来源路径；allow 不在其中。
    const permissions = (await api.get(`${permissionPaths.permissions}?workspaceId=${workspaceId}`)).body
    expect(permissions.project).toEqual({
      workspaceId,
      path: join(workspace, '.coko', 'settings.json'),
      rules: [{ behavior: 'deny', tool: 'Bash', content: 'echo *' }],
    })
    expect(permissions.global.rules).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'echo *' }])
    expect(permissions.workspace).toEqual({ workspaceId, rules: [], revision: 0 })

    // default 模式：项目 allow 不放行 printf，仍然询问；"本 Workspace 总是允许"照常保存并生效。
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'default' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    const asked = await waitApproval(stream, sessionId)
    expect(asked.subject).toBe('printf three')
    expect((await api.post(apiPaths.sessionApproval(sessionId, asked.requestId), { decision: 'allow', scope: 'workspace' })).status).toBe(204)
    await stream.waitFor(() => runEnds(stream, sessionId) >= 3)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })
    await stream.waitFor(() => runEnds(stream, sessionId) >= 4)
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(results(stream.entries(sessionId)).map((r) => [r.toolCallId, r.isError])).toEqual([
      ['e1', false],
      ['e2', true],
      ['p2', false],
      ['p3', false],
      ['p4', false],
    ])
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

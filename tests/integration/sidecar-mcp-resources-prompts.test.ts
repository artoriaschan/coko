// MCP 资源与提示模板：真实 Sidecar + 仓库内的 stdio 测试 Server（MCP_FIXTURE_FEATURES 打开 resources / prompts）。
// 覆盖：没有 resources 能力时三个资源工具不注册；有时列表分页完整、模板、读取文本 / 超长文本 / 图片 / 二进制；四种模式都不出现审批；
// 项目 .coko/settings.json 的 deny 规则拒绝 read_mcp_resource。/mcp__srv__greet Alice 提交 command { source: mcp } 与 prompts/get 的展开文本；
// 缺必填参数 400 并给出参数名；结果不合 schema 时 400 并记诊断；prompts/list_changed 后 GET /api/commands 出现新提示模板。
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  commandPaths,
  mcpPaths,
  permissionPaths,
  type CommandListResponse,
  type McpResponse,
  type SessionEntryRecord,
} from '@coko/protocol'
import { FIXTURE_PNG } from '../fixtures/mcp/server-core.ts'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>

const readJsonl = async (path: string): Promise<Record<string, any>[]> =>
  existsSync(path)
    ? (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
    : []

async function setup(responses: unknown[]) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { role: string; content: unknown }[])
  return { root, workspaceDir, sidecar, api, stream, workspace, requests }
}

async function newSession(api: Api, stream: Stream, workspaceId: string): Promise<string> {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
const waitRunEnds = (stream: Stream, sessionId: string, n: number) => stream.waitFor(() => runEnds(stream, sessionId).length >= n)
type ToolResult = { toolCallId: string; toolName: string; isError: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] }
const toolResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as ToolResult)
const result = (stream: Stream, sessionId: string, id: string) => toolResults(stream, sessionId).find((r) => r.toolCallId === id)!
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('')
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const contentText = (content: unknown) =>
  typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')

async function waitConnected(api: Api, workspaceId: string, names: string[], timeoutMs = 20_000): Promise<McpResponse> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const body = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspaceId}`)).body as McpResponse
    if (names.every((name) => body.servers.find((s) => s.name === name)?.status === 'connected')) return body
    if (Date.now() > deadline) throw new Error(`servers never connected: ${JSON.stringify(body.servers)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({ type: 'toolCall', name, id, arguments: args })

describe('MCP 资源', () => {
  it('没有 resources 能力时不注册；有时分页完整、读取文本与 blob；四种模式都不审批；deny 规则拒绝 read_mcp_resource', { timeout: 90_000 }, async () => {
    const ctx = await setup([
      // Run 1：只有不声明 resources 的 Server，资源工具不存在。
      { content: [call('list_mcp_resources', 'n1')] },
      { content: 'none' },
      // Run 2（default）：列表、模板与读取。
      {
        content: [
          call('list_mcp_resources', 'all'),
          call('list_mcp_resources', 'page1', { server: 'docs' }),
          call('list_mcp_resources', 'page2', { server: 'docs', cursor: 'p2' }),
          call('list_mcp_resource_templates', 'tpl'),
          call('read_mcp_resource', 'readme', { server: 'docs', uri: 'fixture://notes/readme' }),
          call('read_mcp_resource', 'big', { server: 'docs', uri: 'fixture://notes/big' }),
          call('read_mcp_resource', 'dot', { server: 'docs', uri: 'fixture://images/dot' }),
          call('read_mcp_resource', 'blob', { server: 'docs', uri: 'fixture://bin/blob' }),
          call('read_mcp_resource', 'item', { server: 'docs', uri: 'fixture://items/42' }),
          call('read_mcp_resource', 'plain', { server: 'plain', uri: 'fixture://notes/readme' }),
        ],
      },
      { content: 'read' },
      // Run 3–5：read-only、accept-edits、full-access。
      { content: [call('read_mcp_resource', 'ro', { server: 'docs', uri: 'fixture://notes/readme' })] },
      { content: 'ok' },
      { content: [call('read_mcp_resource', 'ae', { server: 'docs', uri: 'fixture://notes/readme' })] },
      { content: 'ok' },
      { content: [call('read_mcp_resource', 'fa', { server: 'docs', uri: 'fixture://notes/readme' })] },
      { content: 'ok' },
      // Run 6（full-access）：项目 deny 规则拒绝读取，列表照常。
      {
        content: [
          call('read_mcp_resource', 'denied', { server: 'docs', uri: 'fixture://notes/readme' }),
          call('list_mcp_resources', 'listed', { server: 'docs' }),
        ],
      },
      { content: 'ok' },
    ])
    const { api, stream, workspace, workspaceDir, root } = ctx
    const docsLog = join(root, 'docs.jsonl')
    const plain = stdioServerConfig({ MCP_FIXTURE_NAME: 'plain' })
    expect((await api.put(mcpPaths.servers, { servers: { plain }, expectedRevision: 0, workspaceId: workspace.id })).status).toBe(200)
    await waitConnected(api, workspace.id, ['plain'])

    const sessionId = await newSession(api, stream, workspace.id)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'list resources' })
    await waitRunEnds(stream, sessionId, 1)
    const missing = result(stream, sessionId, 'n1')
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toMatch(/list_mcp_resources/)
    expect(textOf(missing)).toMatch(/not found/i)

    // 加入声明 resources 的 Server：下一个 Run 注册三个资源工具。
    const docs = stdioServerConfig({ MCP_FIXTURE_FEATURES: 'resources', MCP_FIXTURE_LOG: docsLog })
    expect((await api.put(mcpPaths.servers, { servers: { plain, docs }, expectedRevision: 1, workspaceId: workspace.id })).status).toBe(200)
    const view = await waitConnected(api, workspace.id, ['plain', 'docs'])
    // 资源工具不是该 Server 的工具，不计入 tools。
    expect(view.servers.find((s) => s.name === 'docs')!.tools.map((t) => t.name)).not.toContain('list_mcp_resources')

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'read resources' })
    await waitRunEnds(stream, sessionId, 2)
    const all = JSON.parse(textOf(result(stream, sessionId, 'all')))
    expect(all.resources.map((r: { server: string; uri: string }) => `${r.server} ${r.uri}`)).toEqual([
      'docs fixture://notes/readme',
      'docs fixture://notes/big',
      'docs fixture://images/dot',
      'docs fixture://bin/blob',
    ])
    expect(all.errors).toBeUndefined()
    // 全部 Server 的列表翻完了 3 页（null → p2 → p3），两次单页请求各一页（null、p2）；同批工具并发执行，按 cursor 排序比较。
    const cursors = (await readJsonl(docsLog)).filter((e) => e.event === 'resources/list').map((e) => String(e.cursor))
    expect(cursors.sort()).toEqual(['null', 'null', 'p2', 'p2', 'p3'])
    expect(JSON.parse(textOf(result(stream, sessionId, 'page1')))).toMatchObject({
      server: 'docs',
      nextCursor: 'p2',
      resources: [{ name: 'readme' }, { name: 'big' }],
    })
    expect(JSON.parse(textOf(result(stream, sessionId, 'page2')))).toMatchObject({ server: 'docs', nextCursor: 'p3', resources: [{ name: 'dot' }] })
    expect(JSON.parse(textOf(result(stream, sessionId, 'tpl'))).resourceTemplates).toEqual([
      { server: 'docs', uriTemplate: 'fixture://items/{id}', name: 'item', description: 'One item by id' },
    ])
    expect(textOf(result(stream, sessionId, 'readme'))).toBe('Fixture readme: hello from resources.')
    const big = textOf(result(stream, sessionId, 'big'))
    expect(big).toContain('note 2000\n')
    expect(big).not.toContain('note 2001')
    expect(big).toContain('[Resource truncated: showing 2000 of 2500 lines]')
    expect(result(stream, sessionId, 'dot').content).toEqual([{ type: 'image', data: FIXTURE_PNG, mimeType: 'image/png' }])
    expect(textOf(result(stream, sessionId, 'blob'))).toBe('[binary resource fixture://bin/blob (application/octet-stream, 2.9KB) omitted]')
    expect(textOf(result(stream, sessionId, 'item'))).toBe('item 42')
    const plainRead = result(stream, sessionId, 'plain')
    expect(plainRead.isError).toBe(true)
    expect(textOf(plainRead)).toContain('MCP server "plain" has no resources. Servers with resources: docs')

    for (const [n, mode, id] of [
      [3, 'read-only', 'ro'],
      [4, 'accept-edits', 'ae'],
      [5, 'full-access', 'fa'],
    ] as const) {
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
      await api.post(apiPaths.sessionMessages(sessionId), { text: `read in ${mode}` })
      await waitRunEnds(stream, sessionId, n)
      expect(result(stream, sessionId, id).isError).toBe(false)
    }
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(0)

    await mkdir(join(workspaceDir, '.coko'), { recursive: true })
    await writeFile(join(workspaceDir, '.coko', 'settings.json'), JSON.stringify({ permissions: { deny: ['read_mcp_resource'] } }))
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'denied' })
    await waitRunEnds(stream, sessionId, 6)
    const denied = result(stream, sessionId, 'denied')
    expect(denied.isError).toBe(true)
    expect(textOf(denied)).toBe('Permission denied by rule read_mcp_resource.')
    expect(result(stream, sessionId, 'listed').isError).toBe(false)
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(0)
    expect(runEnds(stream, sessionId).map((e) => (e.payload as { status: string }).status)).toEqual(Array(6).fill('completed'))
    expect(stream.invalidEntries).toEqual([])
    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('MCP 提示模板', () => {
  it(
    '/mcp__srv__greet Alice 提交 command 与展开文本；缺必填参数 400；结果不合 schema 400 并诊断；list_changed 后目录出现新模板',
    { timeout: 90_000 },
    async () => {
      const ctx = await setup([{ content: 'greeted' }, { content: [call('mcp__srv__add_prompt', 'add', { name: 'fresh' })] }, { content: 'added' }])
      const { api, stream, workspace, root, requests } = ctx
      const log = join(root, 'srv.jsonl')
      const servers = { srv: stdioServerConfig({ MCP_FIXTURE_FEATURES: 'prompts', MCP_FIXTURE_LOG: log }), plain: stdioServerConfig() }
      expect((await api.put(mcpPaths.servers, { servers, expectedRevision: 0 })).status).toBe(200)

      // 目录（按名字排序）：列命令时先连接；只有声明 prompts 的 Server 登记提示模板，参数提示按声明顺序。
      const catalog = async () => (await api.get(`${commandPaths.commands}?workspaceId=${workspace.id}`)).body as CommandListResponse
      const mcp = (await catalog()).commands.filter((c) => c.source === 'mcp')
      expect(mcp.map((c) => [c.name, c.argumentHint ?? '', c.enabled])).toEqual([
        ['mcp__srv__broken', '', true],
        ['mcp__srv__env', '<var>', true],
        ['mcp__srv__greet', '<name> [tone]', true],
      ])
      expect(mcp.find((c) => c.name === 'mcp__srv__greet')!.description).toBe('Greet someone')

      const sessionId = await newSession(api, stream, workspace.id)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/mcp__srv__greet Alice' })).status).toBe(202)
      await waitRunEnds(stream, sessionId, 1)
      const entries = stream.entries(sessionId)
      expect(entries.map(kindOf)).toEqual(['permission_mode', 'run_start', 'command', 'user', 'assistant', 'model_request', 'run_end'])
      expect(entries[2]!.payload).toEqual({ name: 'mcp__srv__greet', args: 'Alice', source: 'mcp' })
      const expanded = 'Say hello to Alice.\n\n<resource uri="fixture://style">\nKeep it to one sentence.\n</resource>'
      expect(contentText((entries[3]!.payload as { content: unknown }).content)).toBe(expanded)
      const sent = (await requests())[0]!.filter((m) => m.role === 'user').map((m) => contentText(m.content))
      expect(sent).toEqual([expanded])
      expect((await readJsonl(log)).filter((e) => e.event === 'prompts/get').map((e) => e.params)).toEqual([{ name: 'greet', arguments: { name: 'Alice' } }])

      // 缺必填参数：400 bad-request 并给出参数名，不开始 Run。
      const missing = await api.post(apiPaths.sessionMessages(sessionId), { text: '/mcp__srv__greet' })
      expect(missing.status).toBe(400)
      expect(missing.body.error).toMatchObject({ code: 'bad-request', message: expect.stringContaining('name'), details: { missing: ['name'] } })
      // 结果不合 schema：400，诊断进入 GET /api/mcp。
      const broken = await api.post(apiPaths.sessionMessages(sessionId), { text: '/mcp__srv__broken' })
      expect(broken.status).toBe(400)
      expect(broken.body.error).toMatchObject({ code: 'bad-request', details: { reason: 'invalid-result' } })
      const diagnostics = ((await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse).diagnostics
      expect(diagnostics).toEqual([expect.objectContaining({ source: 'mcp', code: 'invalid-result', message: expect.stringContaining('prompts/get') })])
      expect(runEnds(stream, sessionId)).toHaveLength(1)

      // list_changed：Server 增加提示模板并通知后，目录重新列出（缓存在通知之前不变）。
      expect((await catalog()).commands.map((c) => c.name)).not.toContain('mcp__srv__fresh')
      const listsBefore = (await readJsonl(log)).filter((e) => e.event === 'prompts/list').length
      await catalog()
      expect((await readJsonl(log)).filter((e) => e.event === 'prompts/list').length).toBe(listsBefore)
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
      await api.post(apiPaths.sessionMessages(sessionId), { text: 'add a prompt' })
      await waitRunEnds(stream, sessionId, 2)
      expect(textOf(result(stream, sessionId, 'add'))).toBe('added fresh')
      const deadline = Date.now() + 10_000
      let names: string[] = []
      while (Date.now() < deadline) {
        names = (await catalog()).commands.map((c) => c.name)
        if (names.includes('mcp__srv__fresh')) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(names).toContain('mcp__srv__fresh')
      expect(stream.invalidEntries).toEqual([])
      expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )
})

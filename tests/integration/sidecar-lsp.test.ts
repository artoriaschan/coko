// 代码智能：真实 Sidecar（faux）与仓库内的 LSP 假服务器。四个操作的结果与假服务器记录的请求（initialize 的 rootUri、didOpen 的内容、didChange 的版本）、
// 诊断超时、扩展名不匹配、没有服务器时不注册工具；配置合并（workspace > global > plugin、duplicate-extension）、项目文件中的 lsp 被忽略、lsp.enabled:
// false；对手用例：file_path 越出 Workspace 询问、受保护路径与 read 相同、Read 拒绝规则对 lsp 生效、结果路径经符号链接逃出时写绝对路径且不附该行文本。
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, lspPaths, permissionPaths, type LspResponse } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  lspFixturePath,
  preparePluginFixture,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
} from './sidecar-harness.ts'

type LoggedMessage = { role: string; toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] }
type ToolResult = { toolCallId: string; toolName: string; isError: boolean; details?: unknown; content: { text?: string }[] }

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const lsp = (id: string, args: Record<string, unknown>) => ({ content: [call(id, 'lsp', args)] })

/** 假服务器的一条配置（node 为当前进程的可执行文件）。 */
const fixtureServer = (args: string[], extensionToLanguage: Record<string, string> = { '.ts': 'typescript' }) => ({
  command: process.execPath,
  args: [lspFixturePath, ...args],
  extensionToLanguage,
})

async function boot(root: string, responses: unknown[], env: Record<string, string> = {}) {
  const dirs = await sidecarDirs()
  const requestLog = join(root, '.requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses }, '.faux.json')
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = async (path: string) => (await api.post(API_ROUTES.workspaces, { path })).body.id as string
  const workspaceId = await workspace(root)
  const open = async (mode = 'full-access', ws = workspaceId) => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: ws })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const runEnds = (sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
  const send = async (sessionId: string, text: string, approve?: () => Promise<void>) => {
    const before = runEnds(sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
    if (approve) await approve()
    await stream.waitFor(() => runEnds(sessionId) > before, 30_000)
  }
  const results = (sessionId: string) =>
    stream
      .entries(sessionId)
      .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
      .map((e) => e.payload as ToolResult)
  const result = (sessionId: string, id: string) => {
    const found = results(sessionId).find((r) => r.toolCallId === id)
    if (!found) throw new Error(`no tool result ${id}`)
    return { ...found, text: found.content.map((c) => c.text ?? '').join('') }
  }
  /** 第 n 次模型请求时可调用的工具名（重放 system 消息的增减）。 */
  const toolsAt = async (n: number) => {
    const requests = (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
    const tools = new Set<string>()
    for (const m of requests[n] ?? []) {
      if (m.role !== 'system') continue
      for (const t of m.toolsAdded ?? []) tools.add(t.name)
      for (const t of m.toolsRemoved ?? []) tools.delete(t.name)
    }
    return tools
  }
  const putServers = async (scope: 'global' | { workspaceId: string }, servers: Record<string, unknown>) => {
    const current = (await api.get(lspPaths.lsp + (scope === 'global' ? '' : `?workspaceId=${scope.workspaceId}`))).body as LspResponse
    const revision = scope === 'global' ? current.global.revision : (current.workspace?.revision ?? 0)
    const saved = await api.put(lspPaths.lsp, { scope, servers, expectedRevision: revision })
    expect(saved.status).toBe(200)
    return saved.body as LspResponse
  }
  return { dirs, sidecar, api, stream, workspaceId, workspace, open, send, result, toolsAt, putServers }
}

const records = async (file: string) =>
  (await readFile(file, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: number; method: string; params: Record<string, any> })

describe('lsp：四个操作与假服务器记录的请求', { timeout: 120_000 }, () => {
  it('diagnostics / definition / references / hover 的结果；rootUri 为 Session cwd、didOpen 为磁盘内容、修改后 didChange 版本递增', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'src'))
    const a = 'const x: number = "s"\nconsole.log(名字😀value)\n'
    await writeFile(join(root, 'src/a.ts'), a)
    await writeFile(join(root, 'src/b.ts'), 'export function value() {}\n')
    const record = join(root, '.lsp.jsonl')
    const uri = (rel: string) => pathToFileURL(join(root, rel)).href
    const range = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 1 } })
    const h = await boot(root, [
      lsp('d1', { operation: 'diagnostics', file_path: 'src/a.ts' }),
      lsp('f1', { operation: 'definition', file_path: 'src/a.ts', line: 2, character: 16 }),
      lsp('r1', { operation: 'references', file_path: 'src/a.ts', line: 2, character: 16 }),
      lsp('h1', { operation: 'hover', file_path: 'src/a.ts', line: 2, character: 16 }),
      { content: 'first done' },
      lsp('d2', { operation: 'diagnostics', file_path: 'src/a.ts' }),
      { content: 'second done' },
    ])
    await h.putServers('global', {
      ts: fixtureServer([
        '--record',
        record,
        '--diagnostics',
        JSON.stringify([{ range: range(0, 6), severity: 1, message: "Type 'string' is not assignable to type 'number'.", source: 'ts' }]),
        '--definition',
        JSON.stringify({ uri: uri('src/b.ts'), range: range(0, 16) }),
        '--references',
        JSON.stringify([
          { uri: uri('src/a.ts'), range: range(1, 15) },
          { uri: uri('src/b.ts'), range: range(0, 16) },
        ]),
        '--hover',
        '```ts\nfunction value(): void\n```',
      ]),
    })
    const sessionId = await h.open()
    await h.send(sessionId, 'query the language server')

    expect(h.result(sessionId, 'd1')).toMatchObject({
      isError: false,
      text: "src/a.ts:1:7 error Type 'string' is not assignable to type 'number'. [ts]",
      details: { operation: 'diagnostics', file: 'src/a.ts', count: 1, total: 1 },
    })
    expect(h.result(sessionId, 'f1').text).toBe('src/b.ts:1:17 export function value() {}')
    // '名字😀' 之后：UTF-16 列 15 为第 15 列（1 基码点：c o n s o l e . l o g ( 名 字 😀 → 14 个码点）。
    expect(h.result(sessionId, 'r1').text).toBe(['src/a.ts:2:15 console.log(名字😀value)', 'src/b.ts:1:17 export function value() {}'].join('\n'))
    expect(h.result(sessionId, 'r1').details).toMatchObject({ operation: 'references', line: 2, character: 16, count: 2 })
    expect(h.result(sessionId, 'h1').text).toBe('```ts\nfunction value(): void\n```')

    // 修改文件后再查诊断：didChange 的内容为新的磁盘内容。
    const changed = a.replace('"s"', '1')
    await writeFile(join(root, 'src/a.ts'), changed)
    await h.send(sessionId, 'again')
    expect(h.result(sessionId, 'd2').isError).toBe(false)

    const messages = await records(record)
    expect(messages[0]).toMatchObject({ method: 'initialize', params: { rootUri: pathToFileURL(root).href } })
    expect(messages.filter((m) => m.method === 'initialize')).toHaveLength(1)
    const sync = messages.filter((m) => m.method === 'textDocument/didOpen' || m.method === 'textDocument/didChange')
    expect(sync[0]).toMatchObject({
      method: 'textDocument/didOpen',
      params: { textDocument: { uri: uri('src/a.ts'), languageId: 'typescript', version: 1, text: a } },
    })
    expect(sync.slice(1).map((m) => [m.method, m.params.textDocument.version])).toEqual([2, 3, 4, 5].map((v) => ['textDocument/didChange', v]))
    expect(sync.at(-1)!.params.contentChanges).toEqual([{ text: changed }])
    // 位置为 0 基 UTF-16：第 2 行第 16 列（码点）→ line 1、character 16（'名字😀' 中的代理对占两个单元）。
    expect(messages.find((m) => m.method === 'textDocument/definition')!.params).toMatchObject({
      textDocument: { uri: uri('src/a.ts') },
      position: { line: 1, character: 16 },
    })
    expect(messages.find((m) => m.method === 'textDocument/references')!.params.context).toEqual({ includeDeclaration: true })

    // 状态：running，带 pid 与 cwd。
    const status = ((await h.api.get(lspPaths.status(sessionId))).body as LspResponse).status
    expect(status).toEqual([
      expect.objectContaining({ name: 'ts', source: 'global', extensions: ['.ts'], state: 'running', cwd: root, pid: expect.any(Number) }),
    ])
  })

  it('诊断超时返回"没有收到诊断"；扩展名不匹配为错误结果并列出扩展名；没有服务器的 Workspace 不注册 lsp', async () => {
    const root = await tempDir()
    const other = await tempDir()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    await writeFile(join(root, 'a.py'), 'a = 1\n')
    const h = await boot(root, [
      { content: [call('d1', 'lsp', { operation: 'diagnostics', file_path: 'a.ts' }), call('p1', 'lsp', { operation: 'diagnostics', file_path: 'a.py' })] },
      { content: 'done' },
      { content: 'no server here' },
    ])
    await h.putServers({ workspaceId: h.workspaceId }, { ts: fixtureServer([], { '.ts': 'typescript', '.tsx': 'typescriptreact' }) })
    const sessionId = await h.open()
    await h.send(sessionId, 'diagnose')
    expect(await h.toolsAt(0)).toContain('lsp')
    expect(h.result(sessionId, 'd1')).toMatchObject({ isError: false, details: { count: 0, received: false } })
    expect(h.result(sessionId, 'd1').text).toMatch(/^No diagnostics received for a\.ts within 5 seconds/)
    expect(h.result(sessionId, 'p1')).toMatchObject({ isError: true, text: 'No language server is configured for .py files. Configured extensions: .ts, .tsx' })

    const otherId = await h.open('full-access', await h.workspace(other))
    await h.send(otherId, 'hello')
    const tools = await h.toolsAt(2)
    expect(tools).toContain('read')
    expect(tools).not.toContain('lsp')
  })
})

describe('lsp：配置合并', { timeout: 120_000 }, () => {
  it('workspace > global > plugin，其余记 duplicate-extension；项目文件中的 lsp 被忽略并诊断；lsp.enabled: false 时不注册', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    const projectRecord = join(root, '.project-lsp.jsonl')
    await mkdir(join(root, '.coko'))
    await writeFile(join(root, '.coko/settings.json'), JSON.stringify({ lsp: { servers: { evil: fixtureServer(['--record', projectRecord]) } } }))
    const plugin = await preparePluginFixture()
    const hover = (id: string) => ({ content: [call(id, 'lsp', { operation: 'hover', file_path: 'a.ts', line: 1, character: 5 })] })
    const h = await boot(root, [hover('w'), { content: '1' }, hover('g'), { content: '2' }, hover('p'), { content: '3' }, { content: 'off' }], {
      COKO_TEST_PLUGINS: plugin.root,
    })
    await h.putServers('global', { ts: fixtureServer(['--hover', 'from global']), dup: fixtureServer(['--hover', 'from dup']) })
    await h.putServers({ workspaceId: h.workspaceId }, { wts: fixtureServer(['--hover', 'from workspace']) })
    const sessionId = await h.open()

    const view = (await h.api.get(lspPaths.status(sessionId))).body as LspResponse
    // 插件的 sample:ts 与全局的 ts、dup 都只剩被 workspace 的 wts 占用之后的扩展名（没有）：不在状态中，诊断说明。
    expect(view.status.map((s) => [s.name, s.source, s.extensions])).toEqual([['wts', 'workspace', ['.ts']]])
    expect(view.workspace!.diagnostics).toEqual([])
    expect(view.global.diagnostics.map((d) => d.code)).toEqual(['duplicate-extension', 'duplicate-extension', 'duplicate-extension'])
    expect(view.global.diagnostics.map((d) => d.message).join('\n')).toContain('plugin server sample:ts is shadowed')

    await h.send(sessionId, 'workspace')
    expect(h.result(sessionId, 'w').text).toBe('from workspace')
    await h.putServers({ workspaceId: h.workspaceId }, {})
    await h.putServers('global', { ts: fixtureServer(['--hover', 'from global']) })
    await h.send(sessionId, 'global')
    expect(h.result(sessionId, 'g').text).toBe('from global')
    await h.putServers('global', {})
    await h.send(sessionId, 'plugin')
    // 插件的语言服务器以 <plugin>:<server> 登记（夹具的 .lsp.json 没有 --hover：空悬停）。
    expect(h.result(sessionId, 'p')).toMatchObject({ isError: false, text: 'No hover information.' })
    expect(((await h.api.get(lspPaths.status(sessionId))).body as LspResponse).status).toEqual([
      expect.objectContaining({ name: 'sample:ts', source: 'plugin', state: 'running' }),
    ])

    // 项目文件中的 lsp 服务器：project-cannot-grant，从未启动。
    const config = (await h.api.get(`${configPaths.config}?workspaceId=${h.workspaceId}`)).body as {
      project: { diagnostics: { code: string; message: string }[] }
    }
    expect(config.project.diagnostics).toEqual([expect.objectContaining({ code: 'project-cannot-grant', message: expect.stringContaining('lsp.servers') })])
    expect(await records(projectRecord)).toEqual([])

    // 项目文件 lsp.enabled: false：下一个 Run 不注册 lsp。
    await writeFile(join(root, '.coko/settings.json'), JSON.stringify({ lsp: { enabled: false } }))
    await h.send(sessionId, 'off')
    expect(await h.toolsAt(5)).toContain('lsp')
    expect(await h.toolsAt(6)).not.toContain('lsp')
  })

  it('PUT：非法服务器 400（diagnostics）、名字带冒号 400、revision 冲突 409、Workspace 不存在 404；重启未配置的服务器 404', async () => {
    const root = await tempDir()
    const h = await boot(root, [])
    const bad = await h.api.put(lspPaths.lsp, {
      scope: 'global',
      servers: { x: { command: 'x', extensionToLanguage: { ts: 'typescript' } } },
      expectedRevision: 0,
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error.details.diagnostics).toEqual([expect.objectContaining({ source: 'lsp', code: 'invalid-lsp-server' })])
    expect((await h.api.put(lspPaths.lsp, { scope: 'global', servers: { x: { extensionToLanguage: { '.ts': 'ts' } } }, expectedRevision: 0 })).status).toBe(400)
    expect((await h.api.put(lspPaths.lsp, { scope: 'global', servers: { 'a:b': fixtureServer([]) }, expectedRevision: 0 })).status).toBe(400)
    expect((await h.api.put(lspPaths.lsp, { scope: 'global', servers: { ok: fixtureServer([]) }, expectedRevision: 0 })).status).toBe(200)
    expect((await h.api.put(lspPaths.lsp, { scope: 'global', servers: {}, expectedRevision: 0 })).body.error.code).toBe('revision-conflict')
    expect((await h.api.put(lspPaths.lsp, { scope: { workspaceId: 'missing' }, servers: {}, expectedRevision: 0 })).status).toBe(404)
    const missing = await h.api.post(lspPaths.restart, { name: 'nope' })
    expect([missing.status, missing.body.error.code]).toEqual([404, 'lsp-server-not-found'])
    expect((await h.api.post(lspPaths.restart, { name: 'ok' })).status).toBe(204)
  })
})

describe('lsp：对手用例（权限）', { timeout: 120_000 }, () => {
  it('Workspace 外的 file_path 询问；受保护路径与 read 相同；Read(secret/**) 拒绝对 lsp 生效；结果经符号链接逃出时写绝对路径且不附该行文本', async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(join(root, 'secret'))
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'secret/k.ts'), 'export const k = "sk-not-for-you"\n')
    await writeFile(join(root, '.git/hook.ts'), 'let g = 1\n')
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    await writeFile(join(outside, 'x.ts'), 'export const outsideLine = 1\n')
    await symlink(outside, join(root, 'linked'))
    const record = join(root, '.lsp.jsonl')
    const defs = [
      { uri: pathToFileURL(join(root, 'linked/x.ts')).href, range: { start: { line: 0, character: 13 }, end: { line: 0, character: 14 } } },
      { uri: pathToFileURL(join(root, 'secret/k.ts')).href, range: { start: { line: 0, character: 13 }, end: { line: 0, character: 14 } } },
    ]
    const h = await boot(root, [
      // 拒绝审批使 Run 以 aborted 结束：之后没有该 Run 的回复。
      lsp('o1', { operation: 'hover', file_path: join(outside, 'x.ts'), line: 1, character: 1 }),
      { content: [call('r1', 'read', { path: '.git/hook.ts' }), call('g1', 'lsp', { operation: 'hover', file_path: '.git/hook.ts', line: 1, character: 1 })] },
      { content: 'protected done' },
      {
        content: [
          call('s1', 'lsp', { operation: 'hover', file_path: 'secret/k.ts', line: 1, character: 1 }),
          call('f1', 'lsp', { operation: 'definition', file_path: 'a.ts', line: 1, character: 5 }),
        ],
      },
      { content: 'deny done' },
    ])
    await h.putServers('global', { ts: fixtureServer(['--record', record, '--hover', 'hovered', '--definition', JSON.stringify(defs)]) })
    const sessionId = await h.open('default')

    // Workspace 外：询问（拒绝后服务器没有收到该文件）。
    await h.send(sessionId, 'outside', async () => {
      const request = await waitApproval(h.stream, sessionId)
      expect(request).toMatchObject({ toolName: 'lsp', subject: join(outside, 'x.ts') })
      await h.api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })
    })
    expect(h.result(sessionId, 'o1').isError).toBe(true)
    expect((await records(record)).some((m) => JSON.stringify(m).includes('outsideLine'))).toBe(false)

    // 受保护路径中的读取：与 read 的判定相同（Workspace 内的读取不询问）。
    await h.send(sessionId, 'protected')
    const approvals = h.stream.entries(sessionId).filter((e) => e.kind === 'approval_request')
    expect(approvals).toHaveLength(1)
    expect([h.result(sessionId, 'r1').isError, h.result(sessionId, 'g1').isError]).toEqual([false, false])

    // Read 拒绝规则：lsp 被拒绝；定义的结果指向被拒绝的文件与经符号链接逃出的文件时只给位置。
    expect(
      (await h.api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'deny', tool: 'Read', content: 'secret/**' } })).status,
    ).toBe(200)
    await h.send(sessionId, 'deny')
    expect(h.result(sessionId, 's1')).toMatchObject({ isError: true })
    expect(h.result(sessionId, 's1').text).toContain('Read(secret/**)')
    // 显示路径按解析前的位置（不改变读取判定）；文本只读真实路径在 Workspace 内且未被拒绝的文件。
    expect(h.result(sessionId, 'f1').text).toBe(['linked/x.ts:1:14', 'secret/k.ts:1:14'].join('\n'))
    const opened = (await records(record)).filter((m) => m.method === 'textDocument/didOpen' || m.method === 'textDocument/didChange')
    expect(opened.map((m) => m.params.textDocument.uri)).not.toContain(pathToFileURL(join(root, 'secret/k.ts')).href)
  })
})

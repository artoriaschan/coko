// M6 的装配接入点：真实 Sidecar（faux）。插件消费 seam（COKO_TEST_PLUGINS 把夹具目录当作已批准的插件）：插件的 Skill、命令、子代理定义、
// PreToolUse Hook 与 MCP Server 接入各自的加载，未设置时都不存在；引用 Secret 的插件 MCP Server 不加载。model_request 的逐请求记录与日志；
// 新路由的空结果与 501 占位；headless 存根；有序关闭（定时器 → Run → Job → 贡献 → LSP → 登记进程 → 存储）。harness 自测：LSP 假服务器与插件夹具。
// 新的读取根（插件目录）与注入点（插件资源、插件 Hook 的 stdin）的符号链接越界与秘密总闸用例由插件核心给出；这里只验证接线。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  commandPaths,
  lspPaths,
  mcpPaths,
  permissionPaths,
  PLUGIN_NAME_PATTERN,
  pluginPaths,
  teamPaths,
  tracePaths,
  type McpResponse,
  type SessionEntryRecord,
} from '@coko/protocol'
import { startLspFixture } from '../fixtures/lsp/index.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  pluginFixturePath,
  pollUntil,
  preparePluginFixture,
  sidecarDirs,
  startSidecar,
  tempDir,
  type SidecarDirs,
} from './sidecar-harness.ts'

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

async function boot(root: string, responses: unknown[], env: Record<string, string> = {}) {
  const dirs = await sidecarDirs()
  const requestLog = join(root, '.requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses }, '.faux.json')
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const open = async (mode = 'full-access') => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const runEnds = (sessionId: string, n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n, 30_000)
  const send = async (sessionId: string, text: string) => expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown[])
  const mcp = async () => (await api.get(mcpPaths.mcp + '?workspaceId=' + workspaceId)).body as McpResponse
  const commands = async () => ((await api.get(commandPaths.commands + '?workspaceId=' + workspaceId)).body as { commands: { name: string }[] }).commands
  return { dirs, sidecar, api, stream, workspaceId, open, runEnds, send, requests, mcp, commands }
}

async function logRecords(dirs: SidecarDirs) {
  return (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

const userText = (entry: SessionEntryRecord) => {
  const content = (entry.payload as { content: unknown }).content
  return typeof content === 'string' ? content : (content as { text?: string }[]).map((b) => b.text ?? '').join('')
}

describe('插件消费 seam（COKO_TEST_PLUGINS）', { timeout: 90_000 }, () => {
  it('插件的 Skill、命令、子代理定义、PreToolUse Hook 与 MCP Server 接入；MCP Server 无需项目批准', async () => {
    const root = await tempDir()
    const plugin = await preparePluginFixture()
    const h = await boot(
      root,
      [
        { content: 'hello done' },
        { content: [call('b1', 'bash', { command: 'echo plugin-hook' }), call('m1', 'mcp__plugin-sample-echo__echo', { text: 'via plugin' })] },
        { content: 'tools done' },
        { content: [call('a1', 'agent', { description: 'review', prompt: 'CHILD-R review it', subagent_type: 'sample:reviewer' })] },
        { match: 'CHILD-R', content: 'reviewed' },
        { content: 'dispatched' },
      ],
      { COKO_TEST_PLUGINS: plugin.root },
    )
    const sessionId = await h.open()

    // 命令：/sample:hello 展开为插件的模板。
    expect((await h.commands()).map((c) => c.name)).toContain('sample:hello')
    await h.send(sessionId, '/sample:hello World')
    await h.runEnds(sessionId, 1)
    const entries = () => h.stream.entries(sessionId)
    expect(entries().find((e) => e.kind === 'command')?.payload).toMatchObject({ name: 'sample:hello', args: 'World' })
    expect(userText(entries().find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')!)).toBe(
      'Hello from the sample plugin, World.',
    )
    // Skill：<available_skills> 中有 sample:greet。
    expect(JSON.stringify((await h.requests())[0])).toContain('sample:greet')

    // Hook 与 MCP：插件 Hook 收到 stdin 并以 source plugin 记录；插件 MCP Server 启动并回答（接收侧：夹具日志）。
    await h.send(sessionId, 'PLUGIN-GO')
    await h.runEnds(sessionId, 2)
    const stdin = (await readFile(plugin.hookRecord, 'utf8')).split('\n').filter(Boolean)
    expect(stdin.map((line) => (JSON.parse(line) as { hook_event_name: string }).hook_event_name)).toEqual(['PreToolUse'])
    expect(
      entries()
        .filter((e) => e.kind === 'hook_run')
        .map((e) => e.payload),
    ).toEqual([
      expect.objectContaining({ event: 'PreToolUse', source: 'plugin', plugin: 'sample', hookId: 'plugin:sample:PreToolUse:0:0', outcome: 'allowed' }),
    ])
    const mcpResult = entries().find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'm1')
    expect(mcpResult?.payload).toMatchObject({ isError: false })
    expect(await readFile(plugin.mcpLog, 'utf8')).toContain('"event":"start"')
    expect((await h.mcp()).servers.find((s) => s.name === 'plugin-sample-echo')).toMatchObject({ scope: 'global', status: 'connected' })

    // 子代理：sample:reviewer 可派发。
    await h.send(sessionId, 'DISPATCH')
    await h.runEnds(sessionId, 3)
    const started = entries().find((e) => e.kind === 'agent_start')?.payload as { agentId: string; agentType: string }
    expect(started.agentType).toBe('sample:reviewer')
    const child = (await h.api.get(apiPaths.session(started.agentId))).body.entries as SessionEntryRecord[]
    expect(child[0]).toMatchObject({ kind: 'subagent_origin', payload: { definition: { name: 'sample:reviewer', source: 'user', maxTurns: 3 } } })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('未设置 COKO_TEST_PLUGINS 时插件资源都不存在；空贡献时请求没有 sections', async () => {
    const root = await tempDir()
    const h = await boot(root, [{ content: [call('b1', 'bash', { command: 'echo x' })] }, { content: 'done' }])
    const sessionId = await h.open()
    expect((await h.commands()).map((c) => c.name)).not.toContain('sample:hello')
    await h.send(sessionId, 'go')
    await h.runEnds(sessionId, 1)
    const [first] = await h.requests()
    expect(JSON.stringify(first)).not.toContain('sample:greet')
    expect((first as { sections?: unknown }[])[0]!.sections).toBeUndefined()
    expect(h.stream.entries(sessionId).some((e) => e.kind === 'hook_run')).toBe(false)
    expect((await h.mcp()).servers).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('对手用例：插件 MCP Server 引用 ${NAME} 时不加载，诊断 plugin-secret-reference', async () => {
    const root = await tempDir()
    const plugin = await preparePluginFixture({ extraMcp: { leaky: { command: process.execPath, args: ['-e', ''], env: { TOKEN: '${GATE_TOKEN}' } } } })
    const h = await boot(root, [], { COKO_TEST_PLUGINS: plugin.root })
    const view = await h.mcp()
    expect(view.servers.map((s) => s.name)).toEqual(['plugin-sample-echo'])
    expect(view.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'plugin', code: 'plugin-secret-reference' })]))
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('M6 装配接入点', { timeout: 60_000 }, () => {
  it('model_request：两轮的 Run 提交两条（各在 assistant 之后，耗时 > 0），日志有 model request finished', async () => {
    const root = await tempDir()
    const h = await boot(root, [{ content: [call('l1', 'ls', { path: '.' })] }, { content: 'listed' }])
    const sessionId = await h.open()
    await h.send(sessionId, 'list')
    await h.runEnds(sessionId, 1)
    const kinds = h.stream.entries(sessionId).map((e) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind))
    expect(kinds.slice(kinds.indexOf('run_start'))).toEqual([
      'run_start',
      'user',
      'assistant',
      'model_request',
      'toolResult',
      'assistant',
      'model_request',
      'run_end',
    ])
    const requests = h.stream.modelRequests(sessionId)
    expect(requests).toHaveLength(2)
    for (const request of requests) expect(request).toMatchObject({ purpose: 'turn', retries: 0, durationMs: expect.any(Number) })
    expect(requests.every((r) => r.durationMs > 0)).toBe(true)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    const logged = (await logRecords(h.dirs)).filter((r) => r.message === 'model request finished')
    expect(logged.map((r) => r.properties)).toEqual(requests.map((r) => expect.objectContaining({ sessionId, runId: r.runId, model: r.model, retries: 0 })))
  })

  it('新路由：插件列表与 LSP 为空、团队与追踪为空、未接入的操作为 501（插件与代码智能的管理接口见 sidecar-plugins、sidecar-lsp）；不存在的 Session 404', async () => {
    const root = await tempDir()
    const h = await boot(root, [])
    const sessionId = await h.open('default')
    expect((await h.api.get(pluginPaths.plugins)).body).toEqual([])
    expect((await h.api.post(pluginPaths.approve('x'), { digest: 'd' })).status).toBe(404)
    for (const response of [await h.api.get(tracePaths.export(sessionId))])
      expect([response.status, (response.body as { error?: { code: string } }).error?.code]).toEqual([501, 'not-implemented'])
    expect((await h.api.get(lspPaths.status(sessionId))).body).toEqual({
      enabled: true,
      global: { servers: {}, revision: 0, diagnostics: [] },
      workspace: { workspaceId: h.workspaceId, servers: {}, revision: 0, diagnostics: [] },
      status: [],
    })
    // 代码智能的管理接口见 sidecar-lsp：重启未配置的服务器为 404。
    expect((await h.api.post(lspPaths.restart, { name: 'x' })).status).toBe(404)
    expect((await h.api.get(teamPaths.team(sessionId))).body).toEqual({ members: [], tasks: [], warnings: [] })
    expect((await h.api.get(tracePaths.trace(sessionId))).body).toEqual({ runs: [], totals: { requests: 0, tokens: 0, cost: 0, durationMs: 0 } })
    expect((await h.api.get(tracePaths.audit(sessionId))).body).toEqual([])
    expect((await h.api.get(teamPaths.team('missing'))).status).toBe(404)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('有序关闭：定时器 → Run → Job → 上下文贡献 → LSP → 登记进程 → 存储', async () => {
    const h = await boot(await tempDir(), [])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    const steps = (await logRecords(h.dirs)).filter((r) => r.message.startsWith('shutdown step')).map((r) => r.properties.step)
    expect(steps).toEqual(['timers', 'runs', 'jobs', 'contributions', 'lsp', 'processes', 'storage'])
  })

  it('headless 存根：打印说明并以 4 退出', async () => {
    const electron = createRequire(import.meta.url)('electron') as string
    const entry = fileURLToPath(new URL('../../apps/server/src/headless/index.ts', import.meta.url))
    const child = spawn(electron, [entry], { env: { PATH: process.env.PATH ?? '', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    const code = await new Promise<number | null>((resolve) => child.once('exit', (c) => resolve(c)))
    expect([code, stderr]).toEqual([4, 'coko headless: not implemented\n'])
  })
})

describe('harness 自测', () => {
  it('LSP 假服务器按参数回答 initialize、diagnostics、definition、references、hover，并记录收到的请求', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-lsp-fixture-'))
    const record = join(dir, 'record.jsonl')
    const uri = pathToFileURL(join(dir, 'a.ts')).href
    const location = { uri, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } }
    const fixture = startLspFixture([
      '--record',
      record,
      '--diagnostics',
      JSON.stringify([{ range: location.range, severity: 1, message: 'boom', source: 'ts' }]),
      '--definition',
      JSON.stringify(location),
      '--references',
      JSON.stringify([location, location]),
      '--hover',
      '**number**',
    ])
    fixture.send({ id: 1, method: 'initialize', params: { rootUri: pathToFileURL(dir).href, capabilities: {} } })
    fixture.send({ method: 'initialized', params: {} })
    fixture.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text: 'x' } } })
    const position = { textDocument: { uri }, position: { line: 1, character: 2 } }
    fixture.send({ id: 2, method: 'textDocument/definition', params: position })
    fixture.send({ id: 3, method: 'textDocument/references', params: { ...position, context: { includeDeclaration: true } } })
    fixture.send({ id: 4, method: 'textDocument/hover', params: position })
    fixture.send({ id: 5, method: 'workspace/unknown', params: {} })
    await pollUntil(() => fixture.received.length >= 6 || undefined, { timeoutMs: 10_000 })
    const byId = (id: number) => fixture.received.find((m) => m.id === id)?.result
    expect(byId(1)).toMatchObject({ capabilities: { definitionProvider: true, referencesProvider: true, hoverProvider: true } })
    expect(fixture.received.find((m) => m.method === 'textDocument/publishDiagnostics')).toMatchObject({
      params: { uri, diagnostics: [{ message: 'boom', severity: 1 }] },
    })
    expect([byId(2), byId(3), byId(4), byId(5)]).toEqual([location, [location, location], { contents: { kind: 'markdown', value: '**number**' } }, null])
    fixture.send({ id: 6, method: 'shutdown' })
    fixture.send({ method: 'exit' })
    expect(await fixture.exited).toBe(0)
    const methods = (await readFile(record, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { method: string }).method)
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'textDocument/didOpen',
      'textDocument/definition',
      'textDocument/references',
      'textDocument/hover',
      'workspace/unknown',
      'shutdown',
      'exit',
    ])
  })

  it('LSP 假服务器的 --crash-after 在回答之后退出', async () => {
    const fixture = startLspFixture(['--crash-after', '1'])
    fixture.send({ id: 1, method: 'initialize', params: {} })
    expect(await fixture.exited).toBe(1)
    expect(fixture.received.map((m) => m.id)).toEqual([1])
  })

  it('插件夹具：清单名合规，资源文件与 JSON 声明的形状正确（完整的清单校验属于插件核心）', async () => {
    const manifest = JSON.parse(await readFile(join(pluginFixturePath, '.coko-plugin', 'plugin.json'), 'utf8')) as { name: string; version: string }
    expect(new RegExp(PLUGIN_NAME_PATTERN).test(manifest.name)).toBe(true)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    for (const file of ['skills/greet/SKILL.md', 'commands/hello.md', 'agents/reviewer.md']) expect(existsSync(join(pluginFixturePath, file))).toBe(true)
    const hooks = JSON.parse(await readFile(join(pluginFixturePath, 'hooks', 'hooks.json'), 'utf8')) as { hooks: Record<string, unknown[]> }
    expect(Object.keys(hooks.hooks)).toEqual(['PreToolUse'])
    const mcp = JSON.parse(await readFile(join(pluginFixturePath, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, { command: string }> }
    expect(Object.keys(mcp.mcpServers)).toEqual(['echo'])
    const lsp = JSON.parse(await readFile(join(pluginFixturePath, '.lsp.json'), 'utf8')) as { lspServers: Record<string, { extensionToLanguage: object }> }
    expect(lsp.lspServers.ts!.extensionToLanguage).toEqual({ '.ts': 'typescript' })
  })
})

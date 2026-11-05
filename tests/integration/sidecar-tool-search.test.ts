import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, contextPaths, mcpPaths, permissionPaths } from '@coko/protocol'
import { baseArgs, lines, runHeadless } from './headless-harness.ts'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import {
  answerDecrypts,
  customProvider,
  saveProvider,
  client,
  connect,
  exchange,
  fauxScript,
  isRunEnd,
  sidecarDirs,
  startSidecar,
  tempDir,
} from './sidecar-harness.ts'

const jsonl = async (path: string): Promise<any[]> =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

async function setup(responses: unknown[], enabled: boolean | null = true) {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  const mcpLog = join(root, 'mcp.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const config =
    enabled === null ? await api.get(configPaths.config) : await api.put(configPaths.config, { values: { mcp: { toolSearch: enabled } }, expectedRevision: 0 })
  expect(config.status).toBe(200)
  expect(
    (await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig({ MCP_FIXTURE_LOG: mcpLog }) }, workspaceId, expectedRevision: 0 })).status,
  ).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return { api, stream, sidecar, sessionId, requestLog, mcpLog, root, dirs, script, workspaceId }
}

describe('on-demand MCP tools', () => {
  it('reports commit_failed when real Sidecar SQLite rejects the durable load following its committed result', async () => {
    const h = await setup([
      { content: [{ type: 'toolCall', id: 'load-fault', name: 'tool_search', arguments: { query: 'select:mcp__demo__echo' } }] },
      { content: 'must not reach this request' },
    ])
    // Genuine SQLite failure, installed while idle: no mocked store and no production fault switch.
    const db = new DatabaseSync(join(h.dirs.dataDir, 'coko.db'))
    try {
      db.exec(
        "CREATE TRIGGER reject_tool_load BEFORE INSERT ON session_entries WHEN NEW.kind = 'tool_load' BEGIN SELECT RAISE(ABORT, 'tool_load fixture rejection'); END",
      )
    } finally {
      db.close()
    }
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'load with a failing durable commit' })).status).toBe(202)
    const ended = await h.stream.waitFor((message) => message.type === 'progress' && message.sessionId === h.sessionId && message.event.type === 'run_end')
    const entries = h.stream.entries(h.sessionId)
    expect(entries.filter((entry) => entry.kind === 'message' && (entry.payload as any).role === 'toolResult').map((entry) => entry.payload)).toMatchObject([
      { toolCallId: 'load-fault', isError: false },
    ])
    expect(entries.some((entry) => entry.kind === 'tool_load')).toBe(false)
    expect(ended).toMatchObject({ type: 'progress', event: { type: 'run_end', status: 'error', error: { code: 'commit_failed' } } })
    expect(await jsonl(h.requestLog)).toHaveLength(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('announces a catalog, durably loads exact selections after their result, and executes the real MCP tool', async () => {
    const h = await setup([
      { content: [{ type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: 'select:mcp__demo__echo' } }] },
      { content: [{ type: 'toolCall', id: 'echo', name: 'mcp__demo__echo', arguments: { text: 'loaded hello' } }] },
      { content: 'done' },
      { content: 'second run' },
    ])
    const started = await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'search and echo' })
    expect(started).toMatchObject({ status: 202 })
    await h.stream.waitFor(isRunEnd(h.sessionId))
    const entries = h.stream.entries(h.sessionId)
    expect(entries.find((e) => e.kind === 'run_end')?.payload).toEqual({ status: 'completed' })
    const load = entries.find((e) => e.kind === 'tool_load')!
    expect(load.payload).toEqual({ names: ['mcp__demo__echo'], source: 'search', toolCallId: 'search' })
    const result = entries.find((e) => e.kind === 'message' && (e.payload as any).toolCallId === 'search')!
    expect(load.seq).toBe(result.seq + 1)
    const expected = JSON.parse(await readFile(new URL('../fixtures/tool-search/exact-result.json', import.meta.url), 'utf8'))
    expect(JSON.parse((result.payload as any).content[0].text)).toEqual(expected)
    expect(entries.filter((e) => e.kind === 'state_update' && (e.payload as any).name === 'on_demand_tools')).toHaveLength(1)
    const calls = await jsonl(h.mcpLog)
    expect(calls.some((call) => JSON.stringify(call).includes('loaded hello'))).toBe(true)
    const requests = await jsonl(h.requestLog)
    const tools = (messages: any[]) => {
      const names = new Set<string>()
      for (const m of messages) {
        for (const tool of m.toolsAdded ?? []) names.add(tool.name)
        for (const tool of m.toolsRemoved ?? []) names.delete(tool.name)
      }
      return names
    }
    expect(tools(requests[0]).has('tool_search')).toBe(true)
    expect([...tools(requests[0])].some((name) => name.startsWith('mcp__'))).toBe(false)
    expect(tools(requests[1]).has('mcp__demo__echo')).toBe(true)
    expect(tools(requests[1]).has('mcp__demo__sum')).toBe(false)
    const count = entries.filter((e) => e.kind === 'run_end').length
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'again' })
    await h.stream.waitFor(() => h.stream.entries(h.sessionId).filter((e) => e.kind === 'run_end').length > count)
    expect(h.stream.entries(h.sessionId).filter((e) => e.kind === 'state_update' && (e.payload as any).name === 'on_demand_tools')).toHaveLength(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each([undefined, 'teammate'])('children receive the full permitted MCP tools without search (%s)', async (name) => {
    const h = await setup([
      {
        match: 'ROOT-DELEGATE',
        content: [
          {
            type: 'toolCall',
            id: 'delegate',
            name: 'agent',
            arguments: { description: 'echo', prompt: 'CHILD-ECHO now', subagent_type: 'general', ...(name ? { name } : {}) },
          },
        ],
      },
      { match: 'CHILD-ECHO', content: [{ type: 'toolCall', id: 'child-echo', name: 'mcp__demo__echo', arguments: { text: 'child received MCP' } }] },
      { match: 'CHILD-ECHO', content: 'child done' },
      { content: 'parent done' },
    ])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'ROOT-DELEGATE' })).status).toBe(202)
    await h.stream.waitFor(() => h.stream.entries(h.sessionId).some((e) => e.kind === 'agent_end'), 30_000)
    const start = h.stream.entries(h.sessionId).find((e) => e.kind === 'agent_start')!
    const childId = (start.payload as { agentId: string }).agentId
    const entries = (await h.api.get(apiPaths.session(childId))).body.entries
    expect(entries.filter((e: any) => e.kind === 'state_update' && e.payload.name === 'on_demand_tools')).toEqual([])
    const requests = await jsonl(h.requestLog)
    const childRequest = requests.find((messages: any[]) => messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('CHILD-ECHO')))!
    const baseline = childRequest[0].toolsAdded.map((tool: any) => tool.name)
    expect(baseline).toContain('mcp__demo__echo')
    expect(baseline).not.toContain('tool_search')
    expect((await jsonl(h.mcpLog)).some((call) => JSON.stringify(call).includes('child received MCP'))).toBe(true)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each([false, true])('the first actual HTTP model request uses default on-demand tools, matching usage (legacy config: %s)', async (legacy) => {
    const requests: any[] = []
    const server = createServer((req, res) => {
      let body = ''
      req
        .setEncoding('utf8')
        .on('data', (chunk) => {
          body += chunk
        })
        .on('end', () => {
          requests.push(JSON.parse(body))
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          for (const choice of [
            { delta: { role: 'assistant', content: 'done' }, finish_reason: null },
            { delta: {}, finish_reason: 'stop' },
          ]) {
            res.write(
              `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 0, model: 'search', choices: [{ index: 0, ...choice }] })}\n\n`,
            )
          }
          res.end('data: [DONE]\n\n')
        })
    })
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no model address')
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    answerDecrypts(sidecar)
    expect(
      await saveProvider(sidecar, customProvider('local', `http://127.0.0.1:${address.port}/v1`, ['search']), { secret: 'sk-local-search' }),
    ).toMatchObject({ ok: true })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id as string
    // 新用户与已保存旧版部分配置的用户都未设置 toolSearch。
    const config = legacy ? await api.put(configPaths.config, { values: { mcp: { enabled: true } }, expectedRevision: 0 }) : await api.get(configPaths.config)
    expect(config.status).toBe(200)
    expect(config.body.effective.mcp.toolSearch).toBe(true)
    await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig() }, workspaceId, expectedRevision: 0 })
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'first request' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    expect(requests).toHaveLength(1)
    const names = requests[0].tools.map((tool: any) => tool.function.name)
    expect(names).toContain('tool_search')
    expect(names.some((name: string) => name.startsWith('mcp__'))).toBe(false)
    expect(JSON.stringify(requests[0].messages)).toContain('On-demand tool catalog')
    expect(JSON.stringify(requests[0].messages)).toContain('mcp__demo__echo')
    const usage = (await api.get(contextPaths.session(sessionId))).body
    const toolChars = requests[0].tools.reduce(
      (sum: number, { function: tool }: any) => sum + JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length,
      0,
    )
    expect(usage.breakdown.tools).toBe(Math.ceil(toolChars / 4))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Headless Run uses the same durable search and MCP execution path', async () => {
    const h = await setup(
      [
        { content: [{ type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: 'select:mcp__demo__echo' } }] },
        { content: [{ type: 'toolCall', id: 'echo', name: 'mcp__demo__echo', arguments: { text: 'headless hello' } }] },
        { content: 'headless done' },
      ],
      null,
    )
    await h.sidecar.stop()
    const out = await runHeadless(
      h.dirs,
      baseArgs(h.dirs, '--workspace', h.root, '--prompt', 'load and echo', '--permission-mode', 'full-access', '--output', 'stream-json'),
      { COKO_FAUX_SCRIPT: h.script },
    )
    expect(out).toMatchObject({ code: 0 })
    const messages = lines(out.stdout)
    expect(messages.at(-1)).toMatchObject({ type: 'result', status: 'completed', text: 'headless done' })
    expect(messages.some((message) => message.type === 'entry' && (message.entry as any).kind === 'tool_load')).toBe(true)
    expect((await jsonl(h.mcpLog)).some((call) => JSON.stringify(call).includes('headless hello'))).toBe(true)
  })

  it('an empty catalog registers no search tool or announcement', async () => {
    const h = await setup([{ content: 'no MCP' }], null)
    await h.api.put(mcpPaths.servers, { servers: {}, workspaceId: h.workspaceId, expectedRevision: 1 })
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'no MCP' })
    await h.stream.waitFor(isRunEnd(h.sessionId))
    const requests = await jsonl(h.requestLog)
    expect(requests[0][0].toolsAdded.some((tool: any) => tool.name === 'tool_search')).toBe(false)
    expect(h.stream.entries(h.sessionId).some((e) => e.kind === 'state_update' && (e.payload as any).name === 'on_demand_tools')).toBe(false)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

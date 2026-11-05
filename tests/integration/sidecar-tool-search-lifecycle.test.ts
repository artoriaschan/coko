import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, runPaths } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, killAndRestart, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

const names = ['mcp__demo__echo', 'mcp__demo__env_sha']
const call = (name: string, id: string, args: Record<string, unknown>) => ({
  content: [{ type: 'toolCall', name, id, arguments: args }],
  usage: { input: 10, output: 1 },
})
const load = call('tool_search', 'load-both', { query: `select:${names.join(',')}` })
const echo = call(names[0]!, 'business-once', { text: 'one actual execution' })
const reply = (content: string) => ({ content, usage: { input: 10, output: 1 } })
const jsonl = async (path: string): Promise<any[]> =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

function toolsOf(messages: any[]) {
  const tools = new Map<string, any>()
  for (const message of messages) {
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool)
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name)
  }
  return tools
}

async function attach(sidecar: Awaited<ReturnType<typeof startSidecar>>, sessionId?: string) {
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  if (sessionId) await subscribe(stream, sessionId)
  return { api, stream }
}
async function subscribe(stream: Stream, sessionId: string) {
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
}
async function setup(responses: unknown[], contextWindow = 300_000) {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  const mcpLog = join(root, 'mcp.jsonl')
  const script = await fauxScript(root, { requestLog, contextWindow, maxTokens: 4_000, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const { api, stream } = await attach(sidecar)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  expect(
    (await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig({ MCP_FIXTURE_LOG: mcpLog }) }, workspaceId, expectedRevision: 0 })).status,
  ).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  await subscribe(stream, sessionId)
  return { root, dirs, requestLog, mcpLog, sidecar, api, stream, sessionId, workspaceId }
}
async function run(h: Pick<Awaited<ReturnType<typeof setup>>, 'api' | 'stream' | 'sessionId'>, text: string) {
  const before = h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length
  const started = await h.api.post(apiPaths.sessionMessages(h.sessionId), { text })
  expect(started.status).toBe(202)
  await h.stream.waitFor(() => h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length > before)
  return h.stream.entries(h.sessionId).filter((entry) => entry.runId === started.body.runId)
}
const calls = async (path: string) => (await jsonl(path)).filter((event) => event.event === 'call')
const expectBoth = (messages: any[]) => {
  const tools = toolsOf(messages)
  expect([...tools.keys()]).toEqual(expect.arrayContaining(names))
  expect(tools.has('mcp__demo__big')).toBe(false)
}

describe('durable on-demand tool lifecycle', () => {
  it('retains two loads through failed-request retry and Sidecar restart/continue without replaying a business call', async () => {
    const h = await setup([
      load,
      echo,
      { content: '', stopReason: 'error', errorMessage: 'model fixture failure' },
      reply('retry complete'),
      call('bash', 'pause-before-restart', { command: 'printf pause' }),
    ])
    expect((await run(h, 'load two tools')).at(-1)!.payload).toMatchObject({ status: 'error' })
    const before = h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length
    expect((await h.api.post(apiPaths.sessionRetry(h.sessionId), {})).status).toBe(202)
    await h.stream.waitFor(() => h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length > before)
    expectBoth((await jsonl(h.requestLog)).at(-1))
    expect(await calls(h.mcpLog)).toHaveLength(1)
    await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })
    const paused = await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'pause before restart' })
    expect(paused.status).toBe(202)
    await waitApproval(h.stream, h.sessionId)
    expect((await h.api.post(runPaths.sessionPause(h.sessionId))).status).toBe(204)
    await h.stream.waitFor(() => h.stream.entries(h.sessionId).some((entry) => entry.kind === 'run_end' && entry.runId === paused.body.runId))
    const resumed = await fauxScript(h.root, { requestLog: h.requestLog, responses: [reply('continued after restart')] }, 'resumed.json')
    const sidecar = await killAndRestart(h.sidecar, { dirs: h.dirs, env: { COKO_FAUX_SCRIPT: resumed } })
    const resumedApi = await attach(sidecar, h.sessionId)
    expect((await resumedApi.api.get(apiPaths.session(h.sessionId))).body.entries.filter((entry: any) => entry.kind === 'tool_load')).toHaveLength(1)
    const count = resumedApi.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length
    expect((await resumedApi.api.post(runPaths.sessionContinue(h.sessionId))).status).toBe(202)
    await resumedApi.stream.waitFor(() => resumedApi.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length > count)
    const messages = (await jsonl(h.requestLog)).at(-1)
    expectBoth(messages)
    expect(messages[0]).toMatchObject({ role: 'system', sections: { 'coko.base': expect.stringContaining('You are Coko, a coding agent') } })
    expect(await calls(h.mcpLog)).toHaveLength(1)
    expect(resumedApi.stream.entries(h.sessionId).filter((entry) => entry.kind === 'tool_load')).toHaveLength(1)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
  it.each(['manual', 'auto', 'overflow'] as const)('retains both loaded definitions beyond the %s compaction cut without replay', async (trigger) => {
    const h = await setup(
      [
        load,
        echo,
        reply('loaded'),
        reply('middle one'),
        reply('middle two'),
        ...(trigger === 'overflow' ? [{ content: '', stopReason: 'error', errorMessage: 'prompt is too long: 500000 tokens > 300000 maximum' }] : []),
        reply('LIFECYCLE SUMMARY'),
        reply('after compaction'),
      ],
      trigger === 'auto' ? 64_000 : 300_000,
    )
    await run(h, 'x'.repeat(4_000))
    await run(h, 'y'.repeat(48_000))
    await run(h, 'w'.repeat(40_000))
    const entries = await run(h, trigger === 'manual' ? '/compact' : trigger === 'auto' ? 'z'.repeat(260_000) : 'overflow now')
    const compact = entries.find((entry) => entry.kind === 'compaction')!
    expect(compact?.payload).toMatchObject({ trigger, summary: 'LIFECYCLE SUMMARY' })
    const loaded = h.stream.entries(h.sessionId).find((entry) => entry.kind === 'tool_load')!
    expect(loaded.seq).toBeLessThan((compact.payload as { firstKeptSeq: number }).firstKeptSeq)
    if (trigger === 'manual') await run(h, 'after manual compaction')
    expectBoth((await jsonl(h.requestLog)).at(-1))
    expect(h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'tool_load')).toHaveLength(1)
    expect(await calls(h.mcpLog)).toHaveLength(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('temporarily omits disconnected loaded tools and reconnects with their current descriptions and schema without a new search', async () => {
    const h = await setup([load, echo, reply('loaded'), reply('server disconnected'), reply('server restored')])
    const catalog = join(h.root, 'catalog.json')
    const fail = join(h.root, 'fail.flag')
    const definitions = [
      { name: 'echo', description: 'Original echo definition', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      {
        name: 'env_sha',
        description: 'Original environment digest',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    ]
    await writeFile(catalog, JSON.stringify(definitions))
    const fixture = fileURLToPath(new URL('../fixtures/tool-search/stdio-server.ts', import.meta.url))
    expect(
      (
        await h.api.put(mcpPaths.servers, {
          servers: {
            demo: {
              command: process.execPath,
              args: [fixture],
              env: {
                MCP_FIXTURE_LOG: h.mcpLog,
                TOOL_SEARCH_FIXTURE_CATALOG: catalog,
                MCP_FIXTURE_FAIL_IF: fail,
              },
            },
          },
          workspaceId: h.workspaceId,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(200)
    await run(h, 'load before disconnect')
    expectBoth((await jsonl(h.requestLog)).at(-1))
    const pid = (await jsonl(h.mcpLog)).filter((event) => event.event === 'start').at(-1).pid
    await writeFile(fail, '')
    process.kill(pid, 'SIGKILL')
    await expect
      .poll(async () => (await h.api.get(`${mcpPaths.mcp}?workspaceId=${h.workspaceId}`)).body.servers.find((server: any) => server.name === 'demo')?.status)
      .toBe('failed')
    await run(h, 'disconnected snapshot')
    const absent = toolsOf((await jsonl(h.requestLog)).at(-1))
    for (const name of names) expect(absent.has(name)).toBe(false)
    expect(absent.has('tool_search')).toBe(false)
    await writeFile(
      catalog,
      JSON.stringify([
        {
          ...definitions[0],
          description: 'Updated echo definition',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' }, locale: { type: 'string' } },
            required: ['text'],
          },
        },
        definitions[1],
      ]),
    )
    await rm(fail)
    expect((await h.api.post(mcpPaths.reconnect, { workspaceId: h.workspaceId, name: 'demo' })).status).toBe(200)
    await run(h, 'new definitions')
    const restored = toolsOf((await jsonl(h.requestLog)).at(-1))
    expectBoth((await jsonl(h.requestLog)).at(-1))
    expect(restored.get(names[0]!)).toMatchObject({ description: 'Updated echo definition', parameters: { properties: { locale: { type: 'string' } } } })
    expect(h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'tool_load')).toHaveLength(1)
    expect(await calls(h.mcpLog)).toHaveLength(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

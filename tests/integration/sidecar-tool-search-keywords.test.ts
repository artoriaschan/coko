import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, hookPaths, mcpPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, hookCommand, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const fixture = fileURLToPath(new URL('../fixtures/tool-search/stdio-server.ts', import.meta.url))
const call = (id: string, query: string, limit?: number) => ({ content: [{ type: 'toolCall', id, name: 'tool_search', arguments: { query, limit } }] })

async function setup(responses: unknown[], options: { mode?: string; disabled?: boolean; project?: boolean; englishServer?: boolean } = {}) {
  const root = await tempDir()
  const catalog = join(root, 'catalog.json')
  const log = join(root, 'calls.jsonl')
  const projectLog = join(root, 'project.jsonl')
  await writeFile(
    catalog,
    JSON.stringify([
      { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'query_cn', description: '查询应用日志', inputSchema: { type: 'object', properties: { requestId: { type: 'string' } } } },
      { name: 'schema_a', description: 'First large schema', inputSchema: { type: 'object', description: 'a'.repeat(7400), properties: {} } },
      { name: 'schema_b', description: 'Second large schema', inputSchema: { type: 'object', description: 'b'.repeat(1000), properties: {} } },
      { name: 'hidden', description: 'Hidden capability', inputSchema: { type: 'object', properties: {} } },
    ]),
  )
  const config = {
    command: process.execPath,
    args: [fixture],
    env: { TOOL_SEARCH_FIXTURE_CATALOG: catalog, MCP_FIXTURE_LOG: log },
    ...(options.disabled ? { disabledTools: ['hidden'] } : {}),
  }
  const servers: Record<string, unknown> = { demo: config }
  if (options.englishServer) {
    const englishCatalog = join(root, 'english.json')
    await writeFile(
      englishCatalog,
      JSON.stringify([{ name: 'inspect', description: 'Inspect HTTP requests', inputSchema: { type: 'object', properties: {} } }]),
    )
    servers.english = { ...config, env: { TOOL_SEARCH_FIXTURE_CATALOG: englishCatalog } }
  }
  if (options.project)
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { unapproved: { ...config, env: { ...config.env, MCP_FIXTURE_LOG: projectLog } } } }))
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, { responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  expect((await api.put(configPaths.config, { values: { mcp: { toolSearch: true } }, expectedRevision: 0 })).status).toBe(200)
  expect((await api.put(mcpPaths.servers, { servers, workspaceId, expectedRevision: 0 })).status).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: options.mode ?? 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  const run = async () => {
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'search tools' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    return stream.entries(sessionId)
  }
  return { api, stream, sidecar, sessionId, log, projectLog, run }
}

function result(entries: SessionEntryRecord[], id: string) {
  const entry = entries.find((entry) => entry.kind === 'message' && (entry.payload as { toolCallId?: string }).toolCallId === id)!
  return entry.payload as { isError: boolean; content: { type: string; text: string }[] }
}
const payload = (entries: SessionEntryRecord[], id: string) => JSON.parse(result(entries, id).content[0]!.text)

describe('tool search keywords and visibility through Sidecar', () => {
  it('loads keyword, CJK, substring and exact results with the documented output and schema budget', async () => {
    const h = await setup(
      [
        call('chinese', '+应用 日志'),
        call('select', 'select:mcp__demo__echo,mcp__demo__query_cn', 1),
        call('substring', 'uery_c'),
        call('no-match', '数据库'),
        call('regular', 'select:read,missing'),
        call('large', 'select:mcp__demo__schema_a,mcp__demo__schema_b', 1),
        { content: 'done' },
      ],
      { englishServer: true },
    )
    const entries = await h.run()
    const expected = JSON.parse(await readFile(new URL('../fixtures/tool-search/keyword-result.json', import.meta.url), 'utf8'))
    expect(payload(entries, 'chinese')).toEqual(expected)
    expect(payload(entries, 'select').matches.map((match: { name: string }) => match.name)).toEqual(['mcp__demo__echo', 'mcp__demo__query_cn'])
    expect(payload(entries, 'substring').matches.map((match: { name: string }) => match.name)).toEqual(['mcp__demo__query_cn'])
    expect(payload(entries, 'no-match')).toEqual({
      query: '数据库',
      totalOnDemand: 6,
      matches: [],
      availableServers: [
        { name: 'demo', toolCount: 5 },
        { name: 'english', toolCount: 1 },
      ],
      hint: 'No lexical match. The tool groups above are available in this session — retry with the group name plus a concrete action or object before concluding the capability is unavailable.',
    })
    expect(payload(entries, 'regular')).toMatchObject({ alreadyAvailable: ['read'], unknownNames: ['missing'] })
    const large = payload(entries, 'large')
    expect(large.loaded).toEqual(['mcp__demo__schema_a', 'mcp__demo__schema_b'])
    expect(large.matches[0].parameters).toHaveProperty('description')
    expect(large.matches[1]).not.toHaveProperty('parameters')
    expect(large.matches[1].parametersOmitted).toBe(
      'Parameter schema omitted to stay within the result budget. The tool is loaded — its schema is in your tools list from the next turn on.',
    )
    expect(entries.filter((entry) => entry.kind === 'tool_load').flatMap((entry) => (entry.payload as { names: string[] }).names)).toEqual([
      'mcp__demo__query_cn',
      'mcp__demo__echo',
      'mcp__demo__schema_a',
      'mcp__demo__schema_b',
    ])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('loading a denied business tool does not authorize or execute it', async () => {
    const h = await setup([
      call('search', 'text'),
      { content: [{ type: 'toolCall', id: 'denied', name: 'mcp__demo__echo', arguments: { text: 'must not execute' } }] },
      { content: 'done' },
    ])
    expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule: { behavior: 'deny', tool: 'mcp__demo__echo' } })).status).toBe(200)
    const entries = await h.run()
    expect(entries.find((entry) => entry.kind === 'tool_load')?.payload).toMatchObject({ names: ['mcp__demo__echo'] })
    expect(result(entries, 'denied').isError).toBe(true)
    expect(result(entries, 'denied').content[0]!.text).toContain('denied')
    expect((await readFile(h.log, 'utf8')).includes('"event":"call"')).toBe(false)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Plan Mode can search while disabled and unapproved tools are unknown', async () => {
    const h = await setup([call('search', 'select:mcp__demo__query_cn,mcp__demo__hidden,mcp__unapproved__echo'), { content: 'done' }], {
      mode: 'plan',
      disabled: true,
      project: true,
    })
    const entries = await h.run()
    expect(result(entries, 'search').isError).toBe(false)
    expect(payload(entries, 'search')).toMatchObject({
      matches: [{ name: 'mcp__demo__query_cn' }],
      unknownNames: ['mcp__demo__hidden', 'mcp__unapproved__echo'],
    })
    expect(entries.some((entry) => entry.kind === 'approval_request')).toBe(false)
    await expect(readFile(h.projectLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each(['rule', 'hook'])('search can be blocked by a %s', async (source) => {
    const h = await setup([call('search', 'text'), { content: 'done' }])
    const saved =
      source === 'rule'
        ? await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule: { behavior: 'deny', tool: 'tool_search' } })
        : await h.api.put(hookPaths.hooks, {
            hooks: {
              PreToolUse: [{ matcher: 'tool_search', hooks: [{ type: 'command', command: hookCommand('--exit', '2', '--stderr', 'search blocked') }] }],
            },
            expectedRevision: 0,
          })
    expect(saved.status).toBe(200)
    const entries = await h.run()
    expect(result(entries, 'search').isError).toBe(true)
    expect(entries.some((entry) => entry.kind === 'tool_load')).toBe(false)
    expect(entries.some((entry) => entry.kind === 'hook_run' && (entry.payload as { event?: string }).event === 'PreToolUse')).toBe(source === 'hook')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

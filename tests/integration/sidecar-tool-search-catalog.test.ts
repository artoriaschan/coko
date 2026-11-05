import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, configPaths, mcpPaths, permissionPaths } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, { contextWindow: 300_000, requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  await api.put(configPaths.config, { values: { mcp: { toolSearch: true } }, expectedRevision: 0 })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  const send = async (text: string) => {
    const count = stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length
    const started = await api.post(apiPaths.sessionMessages(sessionId), { text })
    expect(started.status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length > count)
    const entries = stream.entries(sessionId).filter((entry) => entry.runId === started.body.runId)
    expect(entries.at(-1)!.payload).toMatchObject({ status: 'completed' })
    return entries
  }
  return { root, sidecar, api, stream, workspaceId, sessionId, requestLog, send }
}

const catalogText = (entries: { kind: string; payload: unknown }[]) =>
  entries.flatMap((entry) => {
    if (entry.kind !== 'message') return []
    const message = entry.payload as { role: string; content: unknown }
    return message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((block) => (block.type === 'text' && block.text.startsWith('<state_update name="on_demand_tools">') ? [block.text] : []))
      : []
  })

it('sends catalog deltas, deduplicates unchanged runs, and resends full after compaction and rewind', async () => {
  const h = await boot(['first', 'second', 'third', 'summary', 'after compact', 'after rewind'].map((content) => ({ content })))
  await h.api.put(mcpPaths.servers, { servers: { old: stdioServerConfig() }, workspaceId: h.workspaceId, expectedRevision: 0 })
  const first = await h.send('x'.repeat(4_000))
  expect(catalogText(first)[0]).toContain('On-demand tool catalog.')
  await h.api.put(mcpPaths.servers, { servers: { next: stdioServerConfig() }, workspaceId: h.workspaceId, expectedRevision: 1 })
  const second = await h.send('y'.repeat(48_000))
  expect(catalogText(second)).toHaveLength(1)
  expect(catalogText(second)[0]).toBe((await readFile(new URL('../fixtures/tool-search/catalog-delta.txt', import.meta.url), 'utf8')).trimEnd())
  expect(catalogText(second)[0]).toContain('Removed:\n- mcp__old__big')
  const third = await h.send('w'.repeat(40_000))
  expect(catalogText(third)).toEqual([])
  const target = third.find((entry) => entry.kind === 'message' && (entry.payload as { role?: string }).role === 'user')!
  const compact = await h.send('/compact')
  expect(compact.some((entry) => entry.kind === 'compaction')).toBe(true)
  expect(catalogText(await h.send('after compact'))[0]).toContain('On-demand tool catalog.')
  expect((await h.api.post(checkpointPaths.sessionRewind(h.sessionId), { targetSeq: target.seq, mode: 'conversation' })).status).toBe(200)
  const rewound = catalogText(await h.send('after rewind'))
  expect(rewound).toHaveLength(1)
  expect(rewound[0]).toContain('On-demand tool catalog.')
  expect(rewound[0]).not.toContain('Added:')
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('keeps the Run catalog frozen when a failed server reconnects during approval', async () => {
  const h = await boot([
    { content: [{ type: 'toolCall', id: 'pause', name: 'write', arguments: { path: 'pause.txt', content: 'resume' } }] },
    { content: [{ type: 'toolCall', id: 'absent', name: 'tool_search', arguments: { query: 'select:mcp__late__echo' } }] },
    { content: 'first done' },
    { content: [{ type: 'toolCall', id: 'present', name: 'tool_search', arguments: { query: 'select:mcp__late__echo' } }] },
    { content: [{ type: 'toolCall', id: 'echo', name: 'mcp__late__echo', arguments: { text: 'reconnected' } }] },
    { content: 'second done' },
  ])
  const failFlag = join(h.root, 'fail.flag')
  const mcpLog = join(h.root, 'mcp.jsonl')
  await writeFile(failFlag, '')
  await h.api.put(mcpPaths.servers, {
    servers: { ready: stdioServerConfig(), late: stdioServerConfig({ MCP_FIXTURE_FAIL_IF: failFlag, MCP_FIXTURE_LOG: mcpLog }) },
    workspaceId: h.workspaceId,
    expectedRevision: 0,
  })
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })
  const running = h.send('pause before searching late server')
  const approval = await waitApproval(h.stream, h.sessionId)
  await rm(failFlag)
  const connected = await h.api.post(mcpPaths.reconnect, { workspaceId: h.workspaceId, name: 'late' })
  expect(connected.status).toBe(200)
  expect(connected.body.servers.find((server: { name: string }) => server.name === 'late').status).toBe('connected')
  await h.api.post(apiPaths.sessionApproval(h.sessionId, approval.requestId), { decision: 'allow' })
  const first = await running
  const result = (entries: typeof first, id: string) =>
    JSON.parse(
      (
        entries.find((entry) => entry.kind === 'message' && (entry.payload as { toolCallId?: string }).toolCallId === id)!.payload as {
          content: { text: string }[]
        }
      ).content[0]!.text,
    )
  expect(result(first, 'absent').unknownNames).toEqual(['mcp__late__echo'])
  expect(catalogText(first)[0]).not.toContain('mcp__late__')
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'full-access' })
  const second = await h.send('search late server in next run')
  expect(result(second, 'present').loaded).toEqual(['mcp__late__echo'])
  expect(catalogText(second)[0]).toContain('Added:\nlate (7 tools):')
  expect(await readFile(mcpLog, 'utf8')).toContain('reconnected')
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('budgets the model-visible CJK catalog without exposing schemas', async () => {
  const h = await boot([{ content: 'large catalog received' }])
  const catalog = join(h.root, 'catalog.json')
  await writeFile(
    catalog,
    JSON.stringify(
      Array.from({ length: 100 }, (_, index) => ({
        name: `tool_${index}`,
        description: '中'.repeat(80),
        inputSchema: { type: 'object', description: 'secretSchemaMarker', properties: {} },
      })),
    ),
  )
  await h.api.put(mcpPaths.servers, {
    servers: {
      demo: {
        command: process.execPath,
        args: [fileURLToPath(new URL('../fixtures/tool-search/stdio-server.ts', import.meta.url))],
        env: { TOOL_SEARCH_FIXTURE_CATALOG: catalog },
      },
    },
    workspaceId: h.workspaceId,
    expectedRevision: 0,
  })
  const entries = await h.send('observe the large catalog')
  const text = catalogText(entries)[0]!
  expect(text.match(/中/g)!.length).toBeGreaterThanOrEqual(2_400)
  expect(text.match(/中/g)!.length).toBeLessThan(6_000)
  expect(text).toContain('mcp__demo__tool_99: ')
  expect(text).not.toContain('secretSchemaMarker')
  expect(await readFile(h.requestLog, 'utf8')).not.toContain('secretSchemaMarker')
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, mcpPaths, permissionPaths, pluginPaths, type McpResponse } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { writePlugin } from '../fixtures/plugins/index.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('always-load global, approved project and plugin tools stay resident and exact search reports already available', async () => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      {
        content: [
          {
            type: 'toolCall',
            id: 'search',
            name: 'tool_search',
            arguments: { query: 'select:mcp__global__echo,mcp__project__echo,mcp__plugin-sample-echo__echo' },
          },
        ],
      },
      { content: [{ type: 'toolCall', id: 'echo', name: 'mcp__project__echo', arguments: { text: 'resident project' } }] },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  await api.put(configPaths.config, { values: { mcp: { toolSearch: true } }, expectedRevision: 0 })
  const project = stdioServerConfig()
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { project } }))
  const view = async () => (await api.get(mcpPaths.mcp + '?workspaceId=' + workspaceId)).body as McpResponse
  const pending = (await view()).servers.find((s) => s.name === 'project')!
  expect(pending.status).toBe('pending-approval')
  expect((await api.post(mcpPaths.approvals, { workspaceId, name: 'project', digest: pending.approval!.digest, approve: true })).status).toBe(200)
  // Loading policy changes no launch field and must preserve the existing approval.
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { project: { ...project, alwaysLoad: true } } }))
  expect((await view()).servers.find((s) => s.name === 'project')?.approval).toMatchObject({ digest: pending.approval!.digest, approved: true })
  const plugin = await writePlugin(await tempDir(), {
    name: 'sample',
    files: { '.mcp.json': { mcpServers: { echo: stdioServerConfig({}, { alwaysLoad: true }) } } },
  })
  const installed = await api.post(pluginPaths.plugins, { source: { kind: 'dir', path: plugin } })
  expect(installed.status).toBe(201)
  expect((await api.post(pluginPaths.approve('sample'), { digest: installed.body.digest })).status).toBe(200)
  expect(
    (
      await api.put(mcpPaths.servers, {
        servers: { global: stdioServerConfig({}, { alwaysLoad: true }), deferred: stdioServerConfig() },
        workspaceId,
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'find resident tools' })).status).toBe(202)
  await stream.waitFor(isRunEnd(sessionId))
  const requests: any[][] = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const firstTools = requests[0]![0].toolsAdded.map((tool: any) => tool.name)
  expect(firstTools).toEqual(expect.arrayContaining(['mcp__global__echo', 'mcp__project__echo', 'mcp__plugin-sample-echo__echo', 'tool_search']))
  expect(firstTools).not.toContain('mcp__deferred__echo')
  const entries = stream.entries(sessionId)
  const catalog = entries.find((entry) => entry.kind === 'state_update' && (entry.payload as any).name === 'on_demand_tools')!
  expect((catalog.payload as any).value.every((name: string) => name.startsWith('mcp__deferred__'))).toBe(true)
  const result = entries.find((entry) => entry.kind === 'message' && (entry.payload as any).toolCallId === 'search')!
  expect(JSON.parse((result.payload as any).content[0].text).alreadyAvailable).toEqual([
    'mcp__global__echo',
    'mcp__project__echo',
    'mcp__plugin-sample-echo__echo',
  ])
  expect(entries.filter((entry) => entry.kind === 'tool_load')).toEqual([])
  const echo = entries.find((entry) => entry.kind === 'message' && (entry.payload as any).toolCallId === 'echo')!
  expect(echo.payload).toMatchObject({ isError: false })
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})

it.each([
  { toolSearch: false, alwaysLoad: false },
  { toolSearch: false, alwaysLoad: true },
  { toolSearch: true, alwaysLoad: true },
])('resident-only tool configuration %j sends the ordinary complete tool list', async ({ toolSearch, alwaysLoad }) => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, { requestLog, responses: [{ content: 'done' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  await api.put(configPaths.config, { values: { mcp: { toolSearch } }, expectedRevision: 0 })
  expect((await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig({}, { alwaysLoad }) }, workspaceId, expectedRevision: 0 })).status).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'complete tool list' })
  await stream.waitFor(isRunEnd(sessionId))
  const requests: any[][] = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const tools = requests[0]![0].toolsAdded.map((tool: any) => tool.name)
  expect(tools).toContain('mcp__demo__echo')
  expect(tools).not.toContain('tool_search')
  expect(stream.entries(sessionId).filter((entry) => entry.kind === 'state_update' && (entry.payload as any).name === 'on_demand_tools')).toEqual([])
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})

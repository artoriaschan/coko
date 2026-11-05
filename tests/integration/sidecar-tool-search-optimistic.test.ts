import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const readJsonl = async (path: string): Promise<any[]> =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

async function setup(responses: unknown[]) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const mcpLog = join(root, 'mcp.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  expect(
    (await api.put(mcpPaths.servers, { workspaceId, expectedRevision: 0, servers: { demo: stdioServerConfig({ MCP_FIXTURE_LOG: mcpLog }) } })).status,
  ).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return { api, stream, sidecar, sessionId, requestLog, mcpLog }
}

it('optimistically loads only catalog tools, changes the next model request, and executes once on retry', async () => {
  const h = await setup([
    {
      content: [
        { type: 'toolCall', id: 'cold', name: 'mcp__demo__echo', arguments: { text: 'must not execute' } },
        { type: 'toolCall', id: 'unknown', name: 'mcp__missing__tool', arguments: {} },
      ],
    },
    { content: [{ type: 'toolCall', id: 'retry', name: 'mcp__demo__echo', arguments: { text: 'retry actually executes' } }] },
    { content: 'done' },
  ])
  expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'call directly then retry' })).status).toBe(202)
  await h.stream.waitFor(isRunEnd(h.sessionId))
  const entries = h.stream.entries(h.sessionId)
  const expected = (await readFile(new URL('../fixtures/tool-search/optimistic-result.txt', import.meta.url), 'utf8')).trim()
  const cold = entries.find((entry) => entry.kind === 'message' && (entry.payload as any).toolCallId === 'cold')!
  expect(cold.payload).toMatchObject({ role: 'toolResult', isError: true, content: [{ type: 'text', text: expected }] })
  const loads = entries.filter((entry) => entry.kind === 'tool_load')
  expect(loads.map((entry) => entry.payload)).toEqual([{ names: ['mcp__demo__echo'], source: 'optimistic', toolCallId: 'cold' }])
  expect(loads[0]!.seq).toBe(cold.seq + 1)
  const unknown = entries.find((entry) => entry.kind === 'message' && (entry.payload as any).toolCallId === 'unknown')!
  expect(unknown.payload).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Tool mcp__missing__tool not found' }] })
  const requests = await readJsonl(h.requestLog)
  expect(requests[1].find((message: any) => message.toolCallId === 'cold')?.content).toEqual([{ type: 'text', text: expected }])
  expect(requests[1].flatMap((message: any) => message.toolsAdded ?? []).map((tool: any) => tool.name)).toContain('mcp__demo__echo')
  const calls = await readJsonl(h.mcpLog)
  expect(JSON.stringify(calls)).not.toContain('must not execute')
  expect(JSON.stringify(calls)).toContain('retry actually executes')
  expect(entries.find((entry) => entry.kind === 'run_end')?.payload).toEqual({ status: 'completed' })
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('an optimistically loaded tool still follows permissions and a denied retry creates no second load', async () => {
  const h = await setup([
    { content: [{ type: 'toolCall', id: 'cold', name: 'mcp__demo__echo', arguments: { text: 'cold denied' } }] },
    { content: [{ type: 'toolCall', id: 'denied', name: 'mcp__demo__echo', arguments: { text: 'denied retry' } }] },
    { content: 'done' },
  ])
  expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule: { behavior: 'deny', tool: 'mcp__demo__echo' } })).status).toBe(200)
  expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'try denied tool' })).status).toBe(202)
  await h.stream.waitFor(isRunEnd(h.sessionId))
  const entries = h.stream.entries(h.sessionId)
  expect(entries.filter((entry) => entry.kind === 'tool_load')).toHaveLength(1)
  const denied = entries.find((entry) => entry.kind === 'message' && (entry.payload as any).toolCallId === 'denied')!
  expect(denied.payload).toMatchObject({ isError: true })
  expect(JSON.stringify(denied.payload)).not.toContain('已加载')
  expect(JSON.stringify(await readJsonl(h.mcpLog))).not.toContain('denied retry')
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

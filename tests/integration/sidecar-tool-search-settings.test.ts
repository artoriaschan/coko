import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, contextPaths, mcpPaths, permissionPaths, runPaths } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

const echo = (id: string, text: string) => ({ type: 'toolCall', id, name: 'mcp__demo__echo', arguments: { text } })
const selectEcho = { type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: 'select:mcp__demo__echo' } }

async function setup(responses: unknown[], options: { off?: boolean; project?: boolean; fullAccess?: boolean } = {}) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const mcpLog = join(root, 'mcp.jsonl')
  await writeFile(requestLog, '')
  if (options.project !== undefined) {
    await mkdir(join(root, '.coko'))
    await writeFile(join(root, '.coko/settings.json'), JSON.stringify({ mcp: { toolSearch: options.project } }))
  }
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const switchTo = async (toolSearch: boolean) => {
    const current = (await api.get(configPaths.config)).body
    expect(
      (
        await api.put(configPaths.config, {
          values: { ...current.global, mcp: { ...current.global.mcp, toolSearch } },
          expectedRevision: current.globalRevision,
        })
      ).status,
    ).toBe(200)
  }
  if (options.off) await switchTo(false)
  expect(
    (await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig({ MCP_FIXTURE_LOG: mcpLog }) }, expectedRevision: 0, workspaceId })).status,
  ).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  if (options.fullAccess) await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const entries = () => stream.entries(sessionId)
  const waitRuns = (count: number) => stream.waitFor(() => entries().filter((entry) => entry.kind === 'run_end').length >= count)
  const requests = async (): Promise<any[][]> =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  return { api, stream, sidecar, sessionId, workspaceId, mcpLog, switchTo, entries, waitRuns, requests }
}

/** The faux network boundary records the pi transcript, including its real tool declarations. */
function toolNames(messages: any[]) {
  const names = new Set<string>()
  for (const message of messages) {
    for (const tool of message.toolsAdded ?? []) names.add(tool.name)
    for (const tool of message.toolsRemoved ?? []) names.delete(tool.name)
  }
  return names
}

it('calls while disabled stay resident, create no load record, and become on demand when re-enabled', async () => {
  const h = await setup([{ content: [echo('off-echo', 'while off')] }, { content: 'off done' }, { content: 'on done' }], { off: true, fullAccess: true })
  expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'call directly' })).status).toBe(202)
  await h.waitRuns(1)
  expect(h.entries().some((entry) => entry.kind === 'tool_load')).toBe(false)
  expect(h.entries().some((entry) => entry.kind === 'state_update' && (entry.payload as any).name === 'on_demand_tools')).toBe(false)
  const initial = toolNames((await h.requests())[0]!)
  expect(initial.has('mcp__demo__echo')).toBe(true)
  expect(initial.has('mcp__demo__env_sha')).toBe(true)
  expect(initial.has('tool_search')).toBe(false)
  expect(await readFile(h.mcpLog, 'utf8')).toContain('while off')
  await h.switchTo(true)
  expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 're-enabled' })).status).toBe(202)
  await h.waitRuns(2)
  const next = toolNames((await h.requests())[2]!)
  expect(next.has('tool_search')).toBe(true)
  expect([...next].some((name) => name.startsWith('mcp__'))).toBe(false)
  expect(h.entries().some((entry) => entry.kind === 'tool_load')).toBe(false)
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it.each([false, true])('project toolSearch=%s only tightens and reports attempted grants', async (project) => {
  const h = await setup([{ content: 'project request' }], { project })
  const config = (await h.api.get(`${configPaths.config}?workspaceId=${h.workspaceId}`)).body
  expect(config.effective.mcp.toolSearch).toBe(project)
  expect(config.project.values).toEqual(project ? {} : { mcp: { toolSearch: false } })
  expect(config.project.diagnostics.map((d: any) => [d.code, d.message])).toEqual(
    project ? [['project-cannot-grant', 'mcp.toolSearch: true is ignored: project settings can only turn capabilities off']] : [],
  )
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'project' })
  await h.waitRuns(1)
  const names = toolNames((await h.requests())[0]!)
  expect(names.has('tool_search')).toBe(project)
  expect(names.has('mcp__demo__echo')).toBe(!project)
  await h.switchTo(false)
  const disabled = (await h.api.get(`${configPaths.config}?workspaceId=${h.workspaceId}`)).body
  expect(disabled.effective.mcp.toolSearch).toBe(false)
  expect(disabled.project.diagnostics.map((d: any) => d.code)).toEqual(project ? ['project-cannot-grant'] : [])
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

it.each(['retry', 'continue'] as const)('snapshots the switch during approval and reads the new value for %s without losing loaded tools', async (resume) => {
  const third =
    resume === 'retry'
      ? { content: '', stopReason: 'error', errorMessage: 'settings retry fixture' }
      : { content: [{ type: 'toolCall', id: 'pause-gate', name: 'bash', arguments: { command: 'printf ready' } }] }
  const h = await setup([{ content: [selectEcho] }, { content: [echo('loaded-echo', 'approved')] }, third, { content: 'resumed' }, { content: 'on again' }])
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'search then call' })
  const approval = await waitApproval(h.stream, h.sessionId)
  expect(approval.toolName).toBe('mcp__demo__echo')
  const usageBeforeSwitch = (await h.api.get(contextPaths.session(h.sessionId))).body
  await h.switchTo(false)
  const usageAfterSwitch = (await h.api.get(contextPaths.session(h.sessionId))).body
  expect(usageAfterSwitch.breakdown.tools).toBe(usageBeforeSwitch.breakdown.tools)
  expect((await h.api.post(apiPaths.sessionApproval(h.sessionId, approval.requestId), { decision: 'allow' })).status).toBe(204)
  let pause: { toolName: string; status: number } | undefined
  if (resume === 'continue') {
    const gate = await waitApproval(h.stream, h.sessionId, 2)
    pause = { toolName: gate.toolName, status: (await h.api.post(runPaths.sessionPause(h.sessionId))).status }
  }
  expect(pause).toEqual(resume === 'continue' ? { toolName: 'bash', status: 204 } : undefined)
  await h.waitRuns(1)
  const current = toolNames((await h.requests())[2]!)
  expect(current.has('tool_search')).toBe(true)
  expect(current.has('mcp__demo__echo')).toBe(true)
  expect(current.has('mcp__demo__env_sha')).toBe(false)
  expect(
    h
      .entries()
      .filter((entry) => entry.kind === 'tool_load')
      .map((entry) => entry.payload),
  ).toEqual([{ names: ['mcp__demo__echo'], source: 'search', toolCallId: 'search' }])
  const path = resume === 'retry' ? apiPaths.sessionRetry(h.sessionId) : runPaths.sessionContinue(h.sessionId)
  expect((await h.api.post(path, {})).status).toBe(202)
  await h.waitRuns(2)
  const resumed = toolNames((await h.requests())[3]!)
  expect(resumed.has('tool_search')).toBe(false)
  expect(resumed.has('mcp__demo__echo')).toBe(true)
  expect(resumed.has('mcp__demo__env_sha')).toBe(true)
  await h.switchTo(true)
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'on again' })
  await h.waitRuns(3)
  const reopened = toolNames((await h.requests())[4]!)
  expect(reopened.has('tool_search')).toBe(true)
  expect(reopened.has('mcp__demo__echo')).toBe(true)
  expect(reopened.has('mcp__demo__env_sha')).toBe(false)
  expect(h.entries().filter((entry) => entry.kind === 'tool_load')).toHaveLength(1)
  expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
})

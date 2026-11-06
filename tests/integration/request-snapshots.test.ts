import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCurrentSystemPrompt, getCurrentTools, type Context } from '@earendil-works/pi-ai'
import { API_ROUTES, apiPaths, tracePaths, type TraceResponse } from '@coko/protocol'
import { expect, it } from 'vitest'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it(
  'persists the exact sent system, messages and tools for each request; keeps earlier snapshots immutable across turns and process restarts',
  { timeout: 60_000 },
  async () => {
    const root = await tempDir('coko-request-snapshot-')
    await writeFile(join(root, 'AGENTS.md'), '# Workspace rule\nSNAPSHOT-WORKSPACE-RULE\n')
    const requestDetailsLog = join(root, 'requests.jsonl')
    const script = await fauxScript(root, {
      requestDetailsLog,
      responses: [
        { content: [{ type: 'toolCall', name: 'ls', id: 'snapshot-ls', arguments: { path: '.' } }] },
        { content: 'First response.' },
        { content: 'Second response.' },
      ],
    })
    const dirs = await sidecarDirs()
    const env = { COKO_FAUX_SCRIPT: script }
    const sidecar = await startSidecar({ dirs, env })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'First input.' })
    await stream.waitFor(() => stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length === 1)
    const first = (await api.get(tracePaths.trace(sessionId))).body as TraceResponse
    expect(first.runs[0]?.requests).toHaveLength(2)
    const frozen = JSON.stringify(first.runs[0]!.requests[0]!.snapshot)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'Second input.' })
    await stream.waitFor(() => stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length === 2)
    const trace = (await api.get(tracePaths.trace(sessionId))).body as TraceResponse
    const recorded = trace.runs.flatMap((run) => run.requests)
    const sent = (await readFile(requestDetailsLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Context)
    expect(recorded).toHaveLength(3)
    expect(sent).toHaveLength(recorded.length)
    for (const [index, context] of sent.entries()) {
      expect(recorded[index]!.snapshot).toEqual({
        system: getCurrentSystemPrompt(context.messages),
        messages: context.messages,
        tools: getCurrentTools(context.messages),
      })
    }
    expect(recorded[0]!.snapshot!.system).toContain('SNAPSHOT-WORKSPACE-RULE')
    expect(recorded[0]!.snapshot!.system).toContain('<environment>')
    expect(recorded[0]!.snapshot!.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'write' })]))
    expect(JSON.stringify(recorded[0]!.snapshot)).toBe(frozen)
    expect(JSON.stringify(recorded[0]!.snapshot)).not.toContain('Second input.')
    expect(JSON.stringify(recorded[1]!.snapshot!.messages)).toContain('snapshot-ls')
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const restarted = await startSidecar({ dirs, env })
    const restored = await client(restarted, await exchange(restarted)).get(tracePaths.trace(sessionId))
    expect(restored.body).toEqual(trace)
  },
)

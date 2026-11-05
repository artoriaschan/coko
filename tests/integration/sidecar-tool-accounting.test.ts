// Compare the public usage response with actual OpenAI-compatible request bodies.
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, contextPaths, type ContextUsageResponse } from '@coko/protocol'
import { answerDecrypts, client, connect, customProvider, exchange, isRunEnd, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

type WireTool = { function: { name: string; description: string; parameters: unknown } }
type WireRequest = { tools: WireTool[]; messages: { role: string; content?: string | unknown[] }[] }

async function boot(delegate = false) {
  const requests: WireRequest[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const request = JSON.parse(body) as WireRequest
      requests.push(request)
      const calls = delegate && requests.length === 1
      const delta = calls
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'delegate',
                type: 'function',
                function: { name: 'agent', arguments: JSON.stringify({ description: 'read only', prompt: 'CHILD account tools', subagent_type: 'reader' }) },
              },
            ],
          }
        : { role: 'assistant', content: 'done' }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const choice of [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' },
      ]) {
        res.write(
          `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 0, model: 'accounting', choices: [{ index: 0, ...choice }] })}\n\n`,
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
  if (!address || typeof address === 'string') throw new Error('missing model server address')
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs })
  answerDecrypts(sidecar)
  expect(
    await saveProvider(sidecar, customProvider('local', `http://127.0.0.1:${address.port}/v1`, ['accounting']), { secret: 'sk-local-accounting' }),
  ).toMatchObject({ ok: true })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = await tempDir()
  await mkdir(join(workspace, '.coko', 'agents'), { recursive: true })
  await writeFile(join(workspace, '.coko', 'agents', 'reader.md'), '---\nname: reader\ndescription: Reads only\ntools: read\n---\nRead the workspace.\n')
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return { api, stream, sidecar, dirs, requests, sessionId }
}

// The estimate uses Coko's public tool format, reconstructed from the wire schema.
const wireToolTokens = (request: WireRequest) =>
  Math.ceil(
    request.tools.reduce(
      (chars, { function: tool }) => chars + JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length,
      0,
    ) / 4,
  )

describe('actual model tool accounting', () => {
  it('root usage counts the request tool definitions once after committed tool changes', async () => {
    const { api, stream, sidecar, requests, sessionId } = await boot()
    for (const enabled of [false, true]) {
      const config = (await api.get(configPaths.config)).body
      expect((await api.put(configPaths.config, { values: { memory: { enabled } }, expectedRevision: config.globalRevision })).status).toBe(200)
      const count = stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'account root tools' })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length > count)
      expect(
        stream
          .entries(sessionId)
          .filter((e) => e.kind === 'run_end')
          .at(-1)?.payload,
      ).toEqual({ status: 'completed' })
      const result = (await api.get(contextPaths.session(sessionId))).body as ContextUsageResponse
      expect(result.breakdown.tools).toBe(wireToolTokens(requests.at(-1)!))
    }
    const declarations = stream.entries(sessionId).filter((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'system')
    expect(declarations.length).toBeGreaterThan(0)
    expect(requests).toHaveLength(2)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('a tool-limited child counts only the tools actually sent in its own request', async () => {
    const { api, stream, sidecar, requests, sessionId } = await boot(true)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'PARENT delegate' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    const start = stream.entries(sessionId).find((e) => e.kind === 'agent_start')
    expect(start).toBeDefined()
    const childId = (start!.payload as { agentId: string }).agentId
    const childRequest = requests.find((r) => r.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('CHILD account tools')))!
    expect(childRequest.tools.map((t) => t.function.name)).toEqual(['read'])
    const result = (await api.get(contextPaths.session(childId))).body as ContextUsageResponse
    expect(result.breakdown.tools).toBe(wireToolTokens(childRequest))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

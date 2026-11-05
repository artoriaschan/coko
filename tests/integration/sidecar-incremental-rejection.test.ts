import { createServer } from 'node:http'
import { Value } from 'typebox/value'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, RunEndPayload, type ModelProtocol } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { answerDecrypts, catalogModel, client, connect, customProvider, exchange, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

async function rejectedRun(protocol: ModelProtocol, status: number, incrementalTools = true) {
  const requests: any[] = []
  const server = createServer((request, response) => {
    let body = ''
    request
      .setEncoding('utf8')
      .on('data', (chunk) => {
        body += chunk
      })
      .on('end', () => {
        requests.push(JSON.parse(body))
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'fixture rejection' } }))
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
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  const sidecar = await startSidecar({ dirs: await sidecarDirs() })
  answerDecrypts(sidecar)
  expect(
    await saveProvider(
      sidecar,
      {
        ...customProvider('local', 'http://127.0.0.1:' + address.port, [catalogModel('search')], protocol),
        incrementalTools,
      },
      { secret: 'sk-local-rejection' },
    ),
  ).toMatchObject({ ok: true })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id as string
  await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig() }, workspaceId, expectedRevision: 0 })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'use tools' })).status).toBe(202)
  await stream.waitFor(() => stream.entries(sessionId).some((entry) => entry.kind === 'run_end'))
  const end = stream.entries(sessionId).findLast((entry) => entry.kind === 'run_end')
  const payload = Value.Parse(RunEndPayload, end?.payload)
  expect(payload.status).toBe('error')
  return { error: payload.error, requests }
}

describe('native tool transport rejection', () => {
  it('marks an actual Messages400 with the actionable language-independent reason and does not retry', async () => {
    const { error, requests } = await rejectedRun('anthropic-messages', 400)
    expect(requests).toHaveLength(1)
    expect(requests[0].tools.some((tool: any) => tool.defer_loading === true)).toBe(true)
    expect(error).toMatchObject({ code: 'incremental_tools_rejected' })
    expect(error?.message).toContain('fixture rejection')
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)('%s keeps rejection status and retry policy', async (protocol) => {
    for (const status of [422, 401, 429]) {
      const { error, requests } = await rejectedRun(protocol, status)
      expect(requests).toHaveLength(status === 429 ? 4 : 1)
      expect(error?.code).toBe(status === 422 ? 'incremental_tools_rejected' : 'model_error')
      expect(error?.message).toContain('fixture rejection')
    }
    const disabled = await rejectedRun(protocol, 400, false)
    expect(disabled.requests).toHaveLength(1)
    expect(disabled.error?.code).toBe('model_error')
    const native = await rejectedRun(protocol, 400)
    expect(native.requests).toHaveLength(1)
    expect(native.error?.code).toBe('incremental_tools_rejected')
  })
  it('an enabled unmarked Completions model still uses ordinary tools and has no hint', async () => {
    const { error, requests } = await rejectedRun('openai-completions', 400)
    expect(requests).toHaveLength(1)
    expect(requests[0].messages.some((message: any) => message.tools)).toBe(false)
    expect(error?.code).toBe('model_error')
  })
})

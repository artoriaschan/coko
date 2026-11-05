import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { answerDecrypts, catalogModel, client, connect, customProvider, exchange, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

type WireTool = { type: string; function: { name: string } }
type WireMessage = { role: string; tools?: WireTool[]; content?: unknown; tool_call_id?: string }
type WireRequest = { tools?: WireTool[]; messages: WireMessage[] }

async function setup(baseUrl: string, modelId: string, incrementalTools: boolean) {
  const requests: WireRequest[] = []
  const server = createServer((req, res) => {
    let text = ''
    req
      .setEncoding('utf8')
      .on('data', (chunk) => {
        text += chunk
      })
      .on('end', () => {
        const index = requests.push(JSON.parse(text)) - 1
        const call = index < 2
        const delta = call
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_' + index,
                  type: 'function',
                  function: {
                    name: index === 0 ? 'tool_search' : 'mcp__demo__echo',
                    arguments: JSON.stringify(index === 0 ? { query: 'select:mcp__demo__echo' } : { text: 'completions native loaded' }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: 'done' }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const choice of [
          { delta, finish_reason: null },
          { delta: {}, finish_reason: call ? 'tool_calls' : 'stop' },
        ]) {
          res.write(
            'data: ' +
              JSON.stringify({ id: 'reply_' + index, object: 'chat.completion.chunk', created: 0, model: modelId, choices: [{ index: 0, ...choice }] }) +
              '\n\n',
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
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const sidecar = await startSidecar({
    dirs: await sidecarDirs(),
    env: {
      NODE_OPTIONS: '--import=' + fileURLToPath(new URL('../fixtures/tool-search/model-fetch-redirect.mjs', import.meta.url)),
      COKO_FIXTURE_MODEL_ORIGIN: new URL(baseUrl).origin,
      COKO_FIXTURE_MODEL_TARGET: 'http://127.0.0.1:' + address.port,
    },
  })
  answerDecrypts(sidecar)
  expect(
    await saveProvider(
      sidecar,
      {
        ...customProvider('local', baseUrl, [catalogModel(modelId)], 'openai-completions'),
        incrementalTools,
      },
      { secret: 'sk-completions-fixture' },
    ),
  ).toMatchObject({ ok: true })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id as string
  await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig() }, workspaceId, expectedRevision: 0 })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'search and call echo' })).status).toBe(202)
  await stream.waitFor(() => stream.entries(sessionId).some((entry) => entry.kind === 'run_end'))
  expect(stream.entries(sessionId).find((entry) => entry.kind === 'run_end')?.payload).toMatchObject({ status: 'completed' })
  expect(requests).toHaveLength(3)
  const echo = stream.entries(sessionId).find((entry) => entry.kind === 'message' && (entry.payload as { toolName?: string }).toolName === 'mcp__demo__echo')
  expect(echo?.payload).toMatchObject({ isError: false, content: [{ type: 'text', text: 'echo:completions native loaded' }] })
  return { sidecar, requests }
}

const names = (tools: WireTool[] | undefined) => (tools ?? []).map((tool) => tool.function.name)

describe('Completions uses pi catalog capabilities through the real Sidecar', () => {
  it('appends loaded definitions in a tools-bearing system message for a matching URL/ID', async () => {
    const { sidecar, requests } = await setup('https://API.MOONSHOT.AI/v1/', 'kimi-k3', true)
    expect(names(requests[0]!.tools)).toContain('tool_search')
    expect(names(requests[0]!.tools)).not.toContain('mcp__demo__echo')
    expect(names(requests[1]!.tools)).not.toContain('mcp__demo__echo')
    expect(requests[1]!.messages.filter((message) => message.role === 'system' && message.tools).map((message) => names(message.tools))).toContainEqual([
      'mcp__demo__echo',
    ])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each([
    ['https://api.moonshot.ai/v1', 'kimi-k3', false],
    ['https://api.moonshot.ai/v2', 'kimi-k3', true],
    ['https://api.moonshot.ai/v1', 'kimi-k2.5', true],
    ['https://other.example/v1', 'kimi-k3', true],
  ] as const)('uses full request-level tools without error for %s %s switch=%s', async (baseUrl, modelId, enabled) => {
    const { sidecar, requests } = await setup(baseUrl, modelId, enabled)
    expect(names(requests[0]!.tools)).not.toContain('mcp__demo__echo')
    expect(names(requests[1]!.tools)).toContain('mcp__demo__echo')
    expect(requests[1]!.messages.filter((message) => message.tools)).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

import { createServer, type IncomingHttpHeaders } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, mcpPaths, permissionPaths, type ModelProtocol } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { baseArgs, runHeadless } from './headless-harness.ts'
import {
  answerDecrypts,
  catalogModel,
  client,
  connect,
  customProvider,
  exchange,
  isRunEnd,
  saveProvider,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
} from './sidecar-harness.ts'

type Reply = { name: string; args: Record<string, unknown> } | { error: number } | string
async function modelServer(protocol: ModelProtocol, replies: Reply[]) {
  const requests: { body: any; headers: IncomingHttpHeaders }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req
      .setEncoding('utf8')
      .on('data', (chunk) => {
        body += chunk
      })
      .on('end', () => {
        const index = requests.push({ body: JSON.parse(body), headers: req.headers }) - 1
        const reply = replies[index] ?? 'done'
        if (typeof reply !== 'string' && 'error' in reply) {
          res.writeHead(reply.error, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'fixture failure', type: 'invalid_request_error' } }))
          return
        }
        const call = typeof reply !== 'string'
        const id = 'call_' + index
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const event = (type: string, data: unknown) => res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n')
        if (protocol === 'anthropic-messages') {
          event('message_start', {
            type: 'message_start',
            message: { id: 'msg_' + index, model: 'search', role: 'assistant', type: 'message', content: [], usage: { input_tokens: 40, output_tokens: 0 } },
          })
          event('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: call ? { type: 'tool_use', id, name: reply.name, input: {} } : { type: 'text', text: '' },
          })
          event('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(reply.args) } : { type: 'text_delta', text: reply },
          })
          event('content_block_stop', { type: 'content_block_stop', index: 0 })
          event('message_delta', { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } })
          event('message_stop', { type: 'message_stop' })
        } else {
          const item = call
            ? { type: 'function_call', id: 'fc_' + index, call_id: id, name: reply.name, arguments: JSON.stringify(reply.args), status: 'completed' }
            : { type: 'message', id: 'msg_' + index, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] }
          event('response.created', { type: 'response.created', response: { id: 'resp_' + index } })
          event('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item })
          event('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item })
          event('response.completed', {
            type: 'response.completed',
            response: { id: 'resp_' + index, status: 'completed', output: [item], usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 } },
          })
        }
        res.end()
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
  if (!address || typeof address === 'string') throw new Error('No model address')
  return { requests, baseUrl: 'http://127.0.0.1:' + address.port }
}

async function setup(
  protocol: ModelProtocol,
  incrementalTools?: boolean,
  options: { search?: boolean; mcp?: boolean; replies?: Reply[]; contextWindow?: number } = {},
) {
  const fake = await modelServer(
    protocol,
    options.replies ?? [
      { name: 'tool_search', args: { query: 'select:mcp__demo__echo' } },
      { name: 'mcp__demo__echo', args: { text: 'native loaded' } },
      'done',
    ],
  )
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs })
  answerDecrypts(sidecar)
  const provider = {
    ...customProvider('local', fake.baseUrl, [catalogModel('search', options.contextWindow ? { contextWindow: options.contextWindow } : {})], protocol),
    ...(incrementalTools === undefined ? {} : { incrementalTools }),
  }
  expect(await saveProvider(sidecar, provider, { secret: 'sk-local-native' })).toMatchObject({ ok: true })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body.id as string
  await api.put(configPaths.config, { values: { mcp: { toolSearch: options.search ?? true } }, expectedRevision: 0 })
  if (options.mcp !== false) await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig() }, workspaceId, expectedRevision: 0 })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
  const run = async (text = 'load and execute') => {
    const count = stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((entry) => entry.kind === 'run_end').length > count)
    expect(
      stream
        .entries(sessionId)
        .filter((entry) => entry.kind === 'run_end')
        .at(-1)?.payload,
    ).toMatchObject({ status: 'completed' })
  }
  return { ...fake, api, stream, sidecar, dirs, sessionId, provider, run }
}

function wireTools(body: any): string[] {
  return (body.tools ?? []).map((tool: any) => tool.name)
}

describe('Provider native incremental tools', () => {
  it('Headless accepts incrementalTools in its Provider startup configuration and uses the same native transport', async () => {
    const h = await setup('openai-responses', true)
    await h.sidecar.stop()
    const config = join(await tempDir(), 'providers.json')
    await writeFile(config, JSON.stringify({ providers: [h.provider] }))
    const result = await runHeadless(
      h.dirs,
      baseArgs(
        h.dirs,
        '--session',
        h.sessionId,
        '--prompt',
        'headless load',
        '--provider-config',
        config,
        '--permission-mode',
        'full-access',
        '--output',
        'json',
      ),
      { COKO_CREDENTIAL_LOCAL: 'sk-headless-native' },
    )
    expect({ code: result.code, stderr: result.stderr }).toMatchObject({ code: 0 })
    expect(h.requests).toHaveLength(3)
    expect(h.requests[0]!.body.input.filter((item: any) => item.type === 'additional_tools')).toHaveLength(1)
    expect(h.requests[1]!.body.input.filter((item: any) => item.type === 'additional_tools')[1].tools.map((tool: any) => tool.name)).toEqual([
      'mcp__demo__echo',
    ])
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)(
    'provider changes during approval apply only to the next Run and retry (%s)',
    async (protocol) => {
      const h = await setup(protocol, true, {
        replies: [
          { name: 'tool_search', args: { query: 'select:mcp__demo__echo' } },
          { name: 'mcp__demo__echo', args: { text: 'approved' } },
          'done',
          'next run',
          { error: 400 },
          'retry done',
        ],
      })
      await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })
      await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'load then ask' })
      const asked = await waitApproval(h.stream, h.sessionId)
      expect(await saveProvider(h.sidecar, { ...h.provider, incrementalTools: false }, { mode: 'update' })).toMatchObject({ ok: true })
      await h.api.post(apiPaths.sessionApproval(h.sessionId, asked.requestId), { decision: 'allow', scope: 'once' })
      await h.stream.waitFor(isRunEnd(h.sessionId))
      expect(JSON.stringify(h.requests[2]!.body)).toContain(protocol === 'anthropic-messages' ? 'tool_addition' : 'additional_tools')
      await h.run('next run uses updated Provider')
      expect(wireTools(h.requests[3]!.body)).toContain('mcp__demo__echo')
      const count = h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length
      await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'fail then retry' })
      await h.stream.waitFor(() => h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length > count)
      expect((await h.api.post(apiPaths.sessionRetry(h.sessionId), {})).status).toBe(202)
      await h.stream.waitFor(() => h.stream.entries(h.sessionId).filter((entry) => entry.kind === 'run_end').length > count + 1)
      expect(wireTools(h.requests[5]!.body)).toContain('mcp__demo__echo')
      expect(JSON.stringify(h.requests[5]!.body)).not.toContain('additional_tools')
      expect(JSON.stringify(h.requests[5]!.body)).not.toContain('tool_addition')
      expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )
  it.each(['anthropic-messages', 'openai-responses'] as const)('requires an enabled, nonempty root catalog (%s)', async (protocol) => {
    const disabled = await setup(protocol, true, { search: false, replies: ['done'] })
    await disabled.run()
    expect(wireTools(disabled.requests[0]!.body)).toContain('mcp__demo__echo')
    expect(JSON.stringify(disabled.requests[0]!.body)).not.toContain('additional_tools')
    expect(JSON.stringify(disabled.requests[0]!.body)).not.toContain('tool_addition')
    await disabled.sidecar.stop()
    const empty = await setup(protocol, true, { mcp: false, replies: ['done'] })
    await empty.run()
    expect(wireTools(empty.requests[0]!.body)).not.toContain('tool_search')
    expect(JSON.stringify(empty.requests[0]!.body)).not.toContain('additional_tools')
    expect(JSON.stringify(empty.requests[0]!.body)).not.toContain('tool_addition')
    await empty.sidecar.stop()
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)('child requests provide all allowed schemas without native additions (%s)', async (protocol) => {
    const h = await setup(protocol, true, {
      replies: [
        { name: 'agent', args: { description: 'echo', prompt: 'CHILD native', subagent_type: 'general' } },
        { name: 'mcp__demo__echo', args: { text: 'child full tools' } },
        'child done',
        'root done',
      ],
    })
    await h.run()
    const child = h.requests.find((request) => JSON.stringify(request.body).includes('CHILD native') && wireTools(request.body).includes('mcp__demo__echo'))!
    expect(child).toBeDefined()
    expect(wireTools(child.body)).not.toContain('tool_search')
    expect(JSON.stringify(child.body)).not.toContain('additional_tools')
    expect(JSON.stringify(child.body)).not.toContain('tool_addition')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
  it('restarting preserves the Anthropic request-level tool prefix; loaded tools remain in historical additions', async () => {
    const h = await setup('anthropic-messages')
    await h.run()
    await h.sidecar.stop()
    const restarted = await startSidecar({ dirs: h.dirs })
    answerDecrypts(restarted)
    const cookie = await exchange(restarted)
    const stream = await connect(restarted, cookie)
    stream.send({ type: 'subscribe', sessionId: h.sessionId, afterSeq: 0 })
    await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === h.sessionId)
    await client(restarted, cookie).post(apiPaths.sessionMessages(h.sessionId), { text: 'after restart' })
    await stream.waitFor(
      (message) =>
        message.type === 'entry' &&
        message.sessionId === h.sessionId &&
        message.entry.kind === 'run_end' &&
        message.entry.seq > h.stream.entries(h.sessionId).at(-1)!.seq,
    )
    expect(h.requests[3]!.body.tools).toEqual(h.requests[0]!.body.tools)
    expect(JSON.stringify(h.requests[3]!.body.messages)).toContain('tool_addition')
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)(
    'automatic compaction retains loaded declarations in that same HTTP request (%s)',
    async (protocol) => {
      const h = await setup(protocol, true, {
        contextWindow: 64_000,
        replies: [
          { name: 'tool_search', args: { query: 'select:mcp__demo__echo' } },
          { name: 'mcp__demo__echo', args: { text: 'native loaded' } },
          'done',
          'summary',
          'after compaction',
        ],
      })
      await h.run()
      await h.run('x'.repeat(260_000))
      expect(h.stream.entries(h.sessionId).some((entry) => entry.kind === 'compaction' && (entry.payload as any).trigger === 'auto')).toBe(true)
      expect(h.requests).toHaveLength(5)
      const after = h.requests[4]!.body
      const names =
        protocol === 'anthropic-messages'
          ? wireTools(after).concat(
              after.messages
                .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
                .filter((block: any) => block.type === 'tool_addition')
                .map((block: any) => block.tool.definition.name),
            )
          : after.input.filter((item: any) => item.type === 'additional_tools').flatMap((item: any) => item.tools.map((tool: any) => tool.name))
      expect(names).toContain('mcp__demo__echo')
      expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )
  it.each(['anthropic-messages', 'openai-responses'] as const)('loads schemas at their declaration point over real HTTP (%s)', async (protocol) => {
    const h = await setup(protocol)
    await h.run()
    expect(h.requests).toHaveLength(3)
    const [first, second] = h.requests.map((request) => request.body)
    expect(wireTools(first)).not.toContain('mcp__demo__echo')
    const facts =
      protocol === 'anthropic-messages'
        ? {
            placeholder: first.tools.some((tool: any) => tool.defer_loading === true),
            beta: String(h.requests[0]!.headers['anthropic-beta']).includes('inline-tools-2026-09-15'),
            stablePrefix: JSON.stringify(second.tools) === JSON.stringify(first.tools),
            loadedNames: second.messages
              .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
              .filter((block: any) => block.type === 'tool_addition')
              .map((block: any) => block.tool.definition.name),
          }
        : {
            firstBatches: first.input.filter((item: any) => item.type === 'additional_tools').length,
            secondBatches: second.input.filter((item: any) => item.type === 'additional_tools').length,
            loadedNames: second.input.filter((item: any) => item.type === 'additional_tools')[1]?.tools.map((tool: any) => tool.name),
          }
    expect(facts).toEqual(
      protocol === 'anthropic-messages'
        ? { placeholder: true, beta: true, stablePrefix: true, loadedNames: ['mcp__demo__echo'] }
        : { firstBatches: 1, secondBatches: 2, loadedNames: ['mcp__demo__echo'] },
    )
    expect(h.stream.entries(h.sessionId).some((entry) => entry.kind === 'tool_load')).toBe(true)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)('the disabled provider switch sends the full current list (%s)', async (protocol) => {
    const h = await setup(protocol, false)
    await h.run()
    expect(wireTools(h.requests[1]!.body)).toContain('mcp__demo__echo')
    expect(JSON.stringify(h.requests[1]!.body)).not.toContain('additional_tools')
    expect(JSON.stringify(h.requests[1]!.body)).not.toContain('tool_addition')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

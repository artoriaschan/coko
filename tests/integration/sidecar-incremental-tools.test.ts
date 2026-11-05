import { createServer, type IncomingHttpHeaders } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, mcpPaths, permissionPaths, contextPaths, type ModelProtocol } from '@coko/protocol'
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
async function modelServer(protocol: ModelProtocol, replies: Reply[], zeroUsage = false, inputTokens: readonly number[] = []) {
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
        const usedInput = zeroUsage ? 0 : (inputTokens[index] ?? 40)
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
            message: {
              id: 'msg_' + index,
              model: 'search',
              role: 'assistant',
              type: 'message',
              content: [],
              usage: { input_tokens: usedInput, output_tokens: 0 },
            },
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
          event('message_delta', { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: zeroUsage ? 0 : 5 } })
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
            response: {
              id: 'resp_' + index,
              status: 'completed',
              output: [item],
              usage: { input_tokens: usedInput, output_tokens: zeroUsage ? 0 : 5, total_tokens: usedInput + (zeroUsage ? 0 : 5) },
            },
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
  options: { search?: boolean; mcp?: boolean; replies?: Reply[]; contextWindow?: number; zeroUsage?: boolean; inputTokens?: readonly number[] } = {},
) {
  const fake = await modelServer(
    protocol,
    options.replies ?? [
      { name: 'tool_search', args: { query: 'select:mcp__demo__echo' } },
      { name: 'mcp__demo__echo', args: { text: 'native loaded' } },
      'done',
    ],
    options.zeroUsage,
    options.inputTokens,
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
  return { ...fake, api, stream, sidecar, dirs, sessionId, workspaceId, provider, run }
}

function wireTools(body: any): string[] {
  return (body.tools ?? []).map((tool: any) => tool.name)
}

describe('Provider native incremental tools', () => {
  it.each([
    ['anthropic-messages', false],
    ['anthropic-messages', true],
    ['openai-responses', false],
    ['openai-responses', true],
  ] as const)('auto-compacts a newly loaded schema after positive usage (%s, native=%s)', async (protocol, native) => {
    const h = await setup(protocol, native, {
      contextWindow: 40_000,
      inputTokens: [5_000, 25_000, 100, 25_000],
      replies: ['old conversation', { name: 'tool_search', args: { query: 'select:mcp__demo__echo' } }, 'summary', 'after loading'],
    })
    const schema = 's'.repeat(80_000)
    const catalog = join(await tempDir(), 'positive-usage-tools.json')
    await writeFile(
      catalog,
      JSON.stringify([
        { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string', description: schema } } } },
      ]),
    )
    expect(
      (
        await h.api.put(mcpPaths.servers, {
          servers: {
            demo: {
              command: process.execPath,
              args: [fileURLToPath(new URL('../fixtures/tool-search/stdio-server.ts', import.meta.url))],
              env: { TOOL_SEARCH_FIXTURE_CATALOG: catalog },
            },
          },
          workspaceId: h.workspaceId,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(200)
    await h.run('a'.repeat(100_000))
    expect(h.stream.entries(h.sessionId).some((entry) => entry.kind === 'compaction')).toBe(false)
    await h.run('b'.repeat(80_000))
    const entries = h.stream.entries(h.sessionId)
    const loaded = entries.find((entry) => entry.kind === 'tool_load')!
    const compacted = entries.filter((entry) => entry.kind === 'compaction')
    expect(compacted).toHaveLength(1)
    expect(compacted[0]!.seq).toBeGreaterThan(loaded.seq)
    expect(compacted[0]!.payload).toMatchObject({ trigger: 'auto' })
    expect((compacted[0]!.payload as any).tokensBefore).toBeGreaterThan(32_000)
    expect(h.requests).toHaveLength(4)
    expect(JSON.stringify(h.requests[3]!.body)).toContain(schema)
    expect(JSON.stringify(h.requests[2]!.body)).not.toContain(schema)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each([
    ['anthropic-messages', true],
    ['anthropic-messages', false],
    ['openai-responses', true],
    ['openai-responses', false],
  ] as const)('auto-compacts retained native definitions after a tool is removed (%s, zero usage=%s)', async (protocol, zeroUsage) => {
    const h = await setup(protocol, true, {
      contextWindow: 40_000,
      zeroUsage,
      inputTokens: [40, 55_000, 100, 40],
      replies: [{ name: 'tool_search', args: { query: 'select:mcp__demo__echo' } }, 'loaded', 'summary of old tools', 'after compaction'],
    })
    const catalog = join(await tempDir(), 'tools.json')
    await writeFile(
      catalog,
      JSON.stringify([
        {
          name: 'echo',
          description: 'Echo text',
          inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'x'.repeat(200_000) } }, required: ['text'] },
        },
        { name: 'other', description: 'Another on-demand tool', inputSchema: { type: 'object', properties: {} } },
      ]),
    )
    const server = {
      command: process.execPath,
      args: [fileURLToPath(new URL('../fixtures/tool-search/stdio-server.ts', import.meta.url))],
      env: { TOOL_SEARCH_FIXTURE_CATALOG: catalog },
    }
    expect((await h.api.put(mcpPaths.servers, { servers: { demo: server }, workspaceId: h.workspaceId, expectedRevision: 1 })).status).toBe(200)
    const configure = async (autoCompact: boolean) => {
      const current = (await h.api.get(configPaths.config)).body
      expect(
        (
          await h.api.put(configPaths.config, {
            values: { ...current.global, context: { ...current.global.context, autoCompact } },
            expectedRevision: current.globalRevision,
          })
        ).status,
      ).toBe(200)
    }
    await configure(false)
    await h.run('load old definition')
    expect(h.stream.entries(h.sessionId).some((entry) => entry.kind === 'compaction')).toBe(false)
    expect(
      (await h.api.put(mcpPaths.servers, { servers: { demo: { ...server, disabledTools: ['echo'] } }, workspaceId: h.workspaceId, expectedRevision: 2 }))
        .status,
    ).toBe(200)
    await configure(true)
    await h.run('continue without echo ' + 'y'.repeat(80_000))
    const compact = h.stream.entries(h.sessionId).find((entry) => entry.kind === 'compaction')
    expect(compact?.payload).toMatchObject({ trigger: 'auto' })
    expect((compact!.payload as any).tokensBefore).toBeGreaterThan(32_000)
    expect((compact!.payload as any).tokensAfter).toBeLessThan(32_000)
    expect(h.requests).toHaveLength(4)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('counts historical native tool declarations after removal (%s)', async (protocol) => {
    const h = await setup(protocol, true, {
      zeroUsage: true,
      replies: [{ name: 'tool_search', args: { query: 'select:mcp__demo__echo' } }, 'loaded', 'removed'],
    })
    await h.run()
    expect(
      (
        await h.api.put(mcpPaths.servers, {
          servers: { demo: { ...stdioServerConfig(), disabledTools: ['echo'] } },
          workspaceId: h.workspaceId,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(200)
    await h.run('remove echo')
    const body = h.requests.at(-1)!.body
    const definitions =
      protocol === 'anthropic-messages'
        ? [
            ...body.tools.filter((tool: any) => !tool.defer_loading),
            ...body.messages.flatMap((message: any) =>
              Array.isArray(message.content)
                ? message.content.filter((block: any) => block.type === 'tool_addition').map((block: any) => block.tool.definition)
                : [],
            ),
          ]
        : body.input.filter((item: any) => item.type === 'additional_tools').flatMap((item: any) => item.tools)
    expect(definitions.some((tool: any) => tool.name === 'mcp__demo__echo')).toBe(true)
    const old = definitions.find((tool: any) => tool.name === 'mcp__demo__echo')
    const retainedChars = JSON.stringify({ name: old.name, description: old.description, parameters: old.input_schema ?? old.parameters }).length
    const nativeUsage = (await h.api.get(contextPaths.session(h.sessionId))).body
    expect(nativeUsage.estimated).toBe(true)
    expect(await saveProvider(h.sidecar, { ...h.provider, incrementalTools: false }, { mode: 'update' })).toMatchObject({ ok: true })
    const ordinaryUsage = (await h.api.get(contextPaths.session(h.sessionId))).body
    // Both views use the same transcript/results and canonical Coko schema measure; native retains the old definition.
    const difference = nativeUsage.breakdown.tools - ordinaryUsage.breakdown.tools
    expect(difference).toBeGreaterThanOrEqual(Math.floor(retainedChars / 4))
    expect(difference).toBeLessThanOrEqual(Math.ceil(retainedChars / 4))
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

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

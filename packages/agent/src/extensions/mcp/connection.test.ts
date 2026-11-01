import { describe, expect, it } from 'vitest'
import { StreamableHttpTransport, type JsonRpcMessage } from '@earendil-works/pi-mcp'
import { createInMemoryTransportPair, type InMemoryTransport } from '@earendil-works/pi-mcp/testing'
import { McpConnection, type McpTransportHandle } from './connection.ts'
import { createMcpTools } from './tool.ts'

interface FakeServer {
  transport: InMemoryTransport
  calls: Record<string, unknown>[]
  /** Simulate a crash: the transport closes. */
  crash(): Promise<void>
  notify(method: string): Promise<void>
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
}

/** A minimal MCP server on the other end of an in-memory pair. */
function fakeServer(options: { silent?: boolean; tools?: FakeServer['tools'] } = {}): { client: InMemoryTransport; server: FakeServer } {
  const { client, server } = createInMemoryTransportPair()
  const state: FakeServer = {
    transport: server,
    calls: [],
    tools: options.tools ?? [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    ],
    crash: () => server.close(),
    notify: (method) => server.send({ jsonrpc: '2.0', method }),
  }
  server.onMessage((message: JsonRpcMessage) => {
    if (options.silent || !('id' in message) || !('method' in message)) return
    const reply = (result: unknown) => void server.send({ jsonrpc: '2.0', id: message.id, result } as JsonRpcMessage)
    const params = (message.params ?? {}) as Record<string, unknown>
    if (message.method === 'initialize')
      reply({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake', version: '1' } })
    else if (message.method === 'tools/list') reply({ tools: state.tools })
    else if (message.method === 'tools/call') {
      state.calls.push(params)
      const args = params.arguments as { text?: string }
      reply({ content: [{ type: 'text', text: `echo:${args?.text ?? ''}` }] })
    }
  })
  void server.start()
  return { client, server: state }
}

const handleOf = (transport: InMemoryTransport, stderr = ''): McpTransportHandle => ({ transport, stderr: () => stderr })

/** 401 响应体与 WWW-Authenticate 中的令牌：不得出现在连接的错误中。 */
const LEAKED = 'srv-issued-token-9d1f2c'

/**
 * streamable HTTP 的假 fetch：authorized(method, request) 为 false 时 401（响应体与 WWW-Authenticate 带令牌）；
 * 其余 JSON-RPC 请求回 application/json，通知 202，GET 405。requests 记录每次 POST 的方法。
 */
function httpServer(authorized: (method: string, headers: Headers) => boolean) {
  const requests: string[] = []
  const fetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET') !== 'POST') return new Response(null, { status: 405 })
    const message = JSON.parse(String(init!.body)) as { id?: number; method: string }
    requests.push(message.method)
    if (!authorized(message.method, new Headers(init!.headers)))
      return new Response(`invalid token; expected ${LEAKED}`, {
        status: 401,
        headers: { 'www-authenticate': `Bearer realm="mcp", error="invalid_token", error_description="${LEAKED}"` },
      })
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: 'ok' }] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, requests }
}

const waitStatus = async (connection: McpConnection, status: string, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs
  while (connection.status !== status) {
    if (Date.now() > deadline) throw new Error(`status stayed ${connection.status}, wanted ${status}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('MCP 连接状态机', () => {
  it('idle → connecting → connected，列出工具；工具调用带 _meta.idempotencyKey', async () => {
    const { client, server } = fakeServer()
    const connection = new McpConnection({ name: 'srv', root: '/w', createTransport: () => handleOf(client) })
    expect(connection.status).toBe('idle')
    const seen: string[] = []
    connection.onChange(() => seen.push(connection.status))
    await connection.connect()
    expect(connection.status).toBe('connected')
    expect(seen).toEqual(['connecting', 'connected'])
    expect(connection.tools.map((t) => t.name)).toEqual(['echo'])

    const [tool] = createMcpTools(connection, { config: { command: 'x', timeout: 5 } })
    expect(tool).toMatchObject({ name: 'mcp__srv__echo', effect: 'side-effect', description: 'Echo text' })
    const result = await tool!.execute('call1', { text: 'hi' }, undefined, undefined, { idempotencyKey: 's1:call1' })
    expect(result.content).toEqual([{ type: 'text', text: 'echo:hi' }])
    expect(server.calls[0]).toMatchObject({ name: 'echo', arguments: { text: 'hi' }, _meta: { idempotencyKey: 's1:call1' } })
    await connection.close()
  })

  it('disabledTools 不注册；inputSchema 缺 type / properties 时补上', async () => {
    const { client } = fakeServer({
      tools: [
        { name: 'keep', inputSchema: {} },
        { name: 'drop', inputSchema: { type: 'object' } },
      ],
    })
    const connection = new McpConnection({ name: 'srv', root: '/w', createTransport: () => handleOf(client) })
    await connection.connect()
    const registered = createMcpTools(connection, { config: { command: 'x', disabledTools: ['drop'] } })
    expect(registered.map((t) => t.name)).toEqual(['mcp__srv__keep'])
    expect(registered[0]!.parameters).toMatchObject({ type: 'object', properties: {} })
    await connection.close()
  })

  it('连接超时：状态 failed，错误写明超时', async () => {
    const { client } = fakeServer({ silent: true })
    const connection = new McpConnection({ name: 'srv', root: '/w', connectTimeoutMs: 50, createTransport: () => handleOf(client) })
    await connection.connect()
    expect(connection.status).toBe('failed')
    expect(connection.error).toMatch(/timed out after 50 ms/)
  })

  it('传输创建失败（例如缺少 Secret）：failed，不重试；stderr 尾部经脱敏', async () => {
    const failing = new McpConnection({
      name: 'srv',
      root: '/w',
      createTransport: () => {
        throw new Error('Missing secret MY_DSN')
      },
    })
    await failing.connect()
    expect(failing).toMatchObject({ status: 'failed', error: 'Missing secret MY_DSN' })

    const { client } = fakeServer({ silent: true })
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i} token=topsecret`).join('\n')
    const noisy = new McpConnection({
      name: 'srv',
      root: '/w',
      connectTimeoutMs: 20,
      redact: (text) => text.replaceAll('topsecret', '[REDACTED]'),
      createTransport: () => handleOf(client, lines),
    })
    await noisy.connect()
    expect(noisy.stderrTail?.split('\n')).toHaveLength(20)
    expect(noisy.stderrTail).toContain('line 29 token=[REDACTED]')
    expect(noisy.stderrTail).not.toContain('topsecret')
  })

  it('连接后崩溃：failed 带原因，按退避自动重连；用尽后停在 failed，reconnect() 可恢复', async () => {
    let fail = false
    let current: FakeServer | undefined
    const connection = new McpConnection({
      name: 'srv',
      root: '/w',
      connectTimeoutMs: 30,
      reconnectDelaysMs: [10, 10, 10],
      createTransport: () => {
        const { client, server } = fakeServer({ silent: fail })
        current = server
        return handleOf(client, 'crashed hard')
      },
    })
    await connection.connect()
    await current!.crash()
    expect(connection.status).toBe('failed')
    expect(connection.stderrTail).toBe('crashed hard')
    await waitStatus(connection, 'connected')

    fail = true
    await current!.crash()
    await waitStatus(connection, 'connecting')
    // 三次重连都超时后停在 failed，不再自动重连。
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(connection.status).toBe('failed')
    expect(connection.reconnectAttempts).toBe(3)

    fail = false
    await connection.reconnect()
    expect(connection.status).toBe('connected')
    await connection.close()
    expect(connection.status).toBe('idle')
  })

  it('tools/list_changed 时刷新工具', async () => {
    const { client, server } = fakeServer()
    const connection = new McpConnection({ name: 'srv', root: '/w', createTransport: () => handleOf(client) })
    await connection.connect()
    server.tools.push({ name: 'second', inputSchema: { type: 'object' } })
    await server.notify('notifications/tools/list_changed')
    const deadline = Date.now() + 1000
    while (connection.tools.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(connection.tools.map((t) => t.name)).toEqual(['echo', 'second'])
    await connection.close()
  })
})

describe('MCP 认证：auth-required', () => {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('initialize 得到 401（经宿主装配的 authProvider）：auth-required，不自动重连；错误不含响应中的令牌；reconnect() 重试', async () => {
    const server = httpServer(() => false)
    const connection = new McpConnection({
      name: 'remote',
      root: '/w',
      reconnectDelaysMs: [5, 5, 5],
      createTransport: ({ authProvider }) => ({ transport: new StreamableHttpTransport({ url: 'http://mcp.test/mcp', fetch: server.fetch, authProvider }) }),
    })
    await connection.connect()
    expect(connection.status).toBe('auth-required')
    expect(connection.error).toBe('MCP server "remote" requires authentication (HTTP 401)')
    expect(connection.tools).toEqual([])
    // onUnauthorized 立即结束本次连接：只发出一次 initialize，之后不按退避重试。
    expect(server.requests).toEqual(['initialize'])
    await pause(60)
    expect(server.requests).toEqual(['initialize'])
    expect(connection.status).toBe('auth-required')

    await connection.reconnect()
    expect(server.requests).toEqual(['initialize', 'initialize'])
    expect(connection.status).toBe('auth-required')
  })

  it('传输没有 authProvider 时连接错误中的 HTTP 401 同样进入 auth-required', async () => {
    const server = httpServer(() => false)
    const connection = new McpConnection({
      name: 'remote',
      root: '/w',
      reconnectDelaysMs: [5, 5, 5],
      createTransport: () => ({ transport: new StreamableHttpTransport({ url: 'http://mcp.test/mcp', fetch: server.fetch }) }),
    })
    await connection.connect()
    expect(connection.status).toBe('auth-required')
    expect(connection.error).not.toContain(LEAKED)
    await pause(60)
    expect(server.requests).toEqual(['initialize'])
  })

  it('401 只发生在 tools/call：调用失败（不含令牌），连接进入 auth-required、工具清空，不自动重连', async () => {
    const server = httpServer((method) => method !== 'tools/call')
    const connection = new McpConnection({
      name: 'remote',
      root: '/w',
      reconnectDelaysMs: [5, 5, 5],
      createTransport: ({ authProvider }) => ({ transport: new StreamableHttpTransport({ url: 'http://mcp.test/mcp', fetch: server.fetch, authProvider }) }),
    })
    await connection.connect()
    expect(connection.status).toBe('connected')
    const error = await connection.callTool('echo', {}).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('MCP server "remote" requires authentication (HTTP 401)')
    expect(connection.status).toBe('auth-required')
    expect(connection.tools).toEqual([])
    const before = server.requests.filter((m) => m === 'initialize').length
    await pause(60)
    expect(server.requests.filter((m) => m === 'initialize').length).toBe(before)
    await expect(connection.callTool('echo', {})).rejects.toThrow(/not connected \(auth-required\)/)
  })

  it('403 insufficient_scope 同样是 auth-required；其他 HTTP 错误仍为 failed', async () => {
    const scoped = async (_input: string | URL, init?: RequestInit): Promise<Response> =>
      (init?.method ?? 'GET') !== 'POST'
        ? new Response(null, { status: 405 })
        : new Response(LEAKED, { status: 403, headers: { 'www-authenticate': `Bearer error="insufficient_scope", scope="${LEAKED}"` } })
    const connection = new McpConnection({
      name: 'remote',
      root: '/w',
      createTransport: ({ authProvider }) => ({ transport: new StreamableHttpTransport({ url: 'http://mcp.test/mcp', fetch: scoped, authProvider }) }),
    })
    await connection.connect()
    expect(connection.status).toBe('auth-required')
    expect(connection.error).not.toContain(LEAKED)

    const broken = async (_input: string | URL, init?: RequestInit): Promise<Response> =>
      (init?.method ?? 'GET') !== 'POST' ? new Response(null, { status: 405 }) : new Response('boom', { status: 500 })
    const failing = new McpConnection({
      name: 'remote',
      root: '/w',
      reconnectDelaysMs: [],
      createTransport: ({ authProvider }) => ({ transport: new StreamableHttpTransport({ url: 'http://mcp.test/mcp', fetch: broken, authProvider }) }),
    })
    await failing.connect()
    expect(failing.status).toBe('failed')
  })
})

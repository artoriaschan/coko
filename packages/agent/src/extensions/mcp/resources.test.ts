import { describe, expect, it } from 'vitest'
import type { JsonRpcMessage } from '@earendil-works/pi-mcp'
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing'
import { McpConnection } from './connection.ts'
import { createMcpResourceTools, LIST_MCP_RESOURCE_TEMPLATES_TOOL, LIST_MCP_RESOURCES_TOOL, READ_MCP_RESOURCE_TOOL } from './resources.ts'

type Handler = (method: string, params: Record<string, unknown>) => unknown

async function connected(name: string, handler: Handler, capabilities: Record<string, unknown> = { resources: {} }) {
  const { client, server } = createInMemoryTransportPair()
  server.onMessage((message: JsonRpcMessage) => {
    if (!('id' in message) || !('method' in message)) return
    const params = (message.params ?? {}) as Record<string, unknown>
    const result =
      message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities, serverInfo: { name, version: '1' } } : handler(message.method, params)
    void server.send({ jsonrpc: '2.0', id: message.id, result } as JsonRpcMessage)
  })
  void server.start()
  const connection = new McpConnection({ name, root: '/w', createTransport: () => ({ transport: client }) })
  await connection.connect()
  return connection
}

const json = (result: { content: { type: string; text?: string }[] }) => JSON.parse(result.content[0]!.text!) as Record<string, any>
const pages: Record<string, unknown> = {
  '': { resources: [{ uri: 'mem://a', name: 'a', mimeType: 'text/plain' }], nextCursor: 'p2' },
  p2: { resources: [{ uri: 'mem://b' }] },
}
const docs: Handler = (method, params) => {
  if (method === 'resources/list') return pages[String(params.cursor ?? '')]
  if (method === 'resources/templates/list') return { resourceTemplates: [{ uriTemplate: 'mem://items/{id}', name: 'item' }] }
  if (method === 'resources/read') {
    if (params.uri === 'mem://big') return { contents: [{ uri: 'mem://big', text: Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n') }] }
    if (params.uri === 'mem://zip') return { contents: [{ uri: 'mem://zip', mimeType: 'application/zip', blob: Buffer.alloc(2048).toString('base64') }] }
    if (params.uri === 'mem://pic') return { contents: [{ uri: 'mem://pic', mimeType: 'image/png', blob: 'iVBORw0KGgo=' }] }
    if (params.uri === 'mem://bad') return { contents: [{ uri: 'mem://bad' }] }
    return { contents: [{ uri: String(params.uri), mimeType: 'text/plain', text: `content of ${String(params.uri)}` }] }
  }
  return undefined
}

async function setup() {
  const a = await connected('docs', docs)
  const b = await connected('other', (method) => (method === 'resources/list' ? { resources: [{ uri: 'mem://z', name: 'z' }] } : { resourceTemplates: [] }))
  const tools = createMcpResourceTools({ servers: () => [{ connection: a }, { connection: b }] })
  const byName = (name: string) => tools.find((t) => t.name === name)!
  return { a, b, tools, byName }
}

describe('MCP 资源工具', () => {
  it('三个工具，effect read', async () => {
    const { tools, a, b } = await setup()
    expect(tools.map((t) => [t.name, t.effect])).toEqual([
      [LIST_MCP_RESOURCES_TOOL, 'read'],
      [LIST_MCP_RESOURCE_TEMPLATES_TOOL, 'read'],
      [READ_MCP_RESOURCE_TOOL, 'read'],
    ])
    await Promise.all([a.close(), b.close()])
  })

  it('不给 server 时列出全部 Server 的全部分页；给 server 时一页，cursor 接着翻', async () => {
    const { byName, a, b } = await setup()
    const all = json(await byName(LIST_MCP_RESOURCES_TOOL).execute('t1', {}))
    expect(all.resources).toEqual([
      { server: 'docs', uri: 'mem://a', name: 'a', mimeType: 'text/plain' },
      { server: 'docs', uri: 'mem://b', name: 'mem://b' },
      { server: 'other', uri: 'mem://z', name: 'z' },
    ])
    const first = json(await byName(LIST_MCP_RESOURCES_TOOL).execute('t2', { server: 'docs' }))
    expect(first).toEqual({ server: 'docs', resources: [{ server: 'docs', uri: 'mem://a', name: 'a', mimeType: 'text/plain' }], nextCursor: 'p2' })
    const second = json(await byName(LIST_MCP_RESOURCES_TOOL).execute('t3', { server: 'docs', cursor: 'p2' }))
    expect(second).toEqual({ server: 'docs', resources: [{ server: 'docs', uri: 'mem://b', name: 'mem://b' }] })
    const templates = json(await byName(LIST_MCP_RESOURCE_TEMPLATES_TOOL).execute('t4', {}))
    expect(templates.resourceTemplates).toEqual([{ server: 'docs', uriTemplate: 'mem://items/{id}', name: 'item' }])
    await expect(byName(LIST_MCP_RESOURCES_TOOL).execute('t5', { cursor: 'p2' })).rejects.toThrow(/cursor/)
    await expect(byName(LIST_MCP_RESOURCES_TOOL).execute('t6', { server: 'nope' })).rejects.toThrow(/Servers with resources: docs, other/)
    await Promise.all([a.close(), b.close()])
  })

  it('读取：文本按 2000 行 / 50KB 截断，blob 注明类型与大小，图片按内容块透传；不合 schema 的结果是错误', async () => {
    const { byName, a, b } = await setup()
    const read = (uri: string) => byName(READ_MCP_RESOURCE_TOOL).execute('r', { server: 'docs', uri })
    expect((await read('mem://a')).content).toEqual([{ type: 'text', text: 'content of mem://a' }])
    const big = (await read('mem://big')).content[0] as { text: string }
    expect(big.text).toContain('line 2000\n')
    expect(big.text).not.toContain('line 2001')
    expect(big.text).toContain('[Resource truncated: showing 2000 of 2500 lines]')
    expect((await read('mem://zip')).content).toEqual([{ type: 'text', text: '[binary resource mem://zip (application/zip, 2.0KB) omitted]' }])
    expect((await read('mem://pic')).content).toEqual([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }])
    await expect(read('mem://bad')).rejects.toThrow(/invalid resources\/read result/)
    await expect(byName(READ_MCP_RESOURCE_TOOL).execute('r', { server: 'docs' })).rejects.toThrow(/uri/)
    await Promise.all([a.close(), b.close()])
  })

  it('单个文本超过 50KB 时按字节截断', async () => {
    const a = await connected('docs', (method) => (method === 'resources/read' ? { contents: [{ uri: 'mem://one', text: 'x'.repeat(80 * 1024) }] } : undefined))
    const [, , read] = createMcpResourceTools({ servers: () => [{ connection: a }] })
    const text = ((await read!.execute('r', { server: 'docs', uri: 'mem://one' })).content[0] as { text: string }).text
    expect(Buffer.byteLength(text)).toBeLessThan(51 * 1024)
    expect(text.endsWith('[Resource truncated: showing first 50.0KB of 80.0KB (50.0KB limit)]')).toBe(true)
    await a.close()
  })
})

import { describe, expect, it } from 'vitest'
import type { JsonRpcMessage } from '@earendil-works/pi-mcp'
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing'
import { McpConnection } from './connection.ts'
import { getMcpPrompt, listMcpPrompts, mapPromptArguments, McpResultError, promptMessagesToText, type McpPrompt } from './prompts.ts'

type Handler = (method: string, params: Record<string, unknown>) => unknown

/** An MCP server on the other end of an in-memory pair; `handler` answers every request except initialize. */
async function connected(handler: Handler, capabilities: Record<string, unknown> = { prompts: { listChanged: true } }) {
  const { client, server } = createInMemoryTransportPair()
  const seen: { method: string; params: Record<string, unknown> }[] = []
  server.onMessage((message: JsonRpcMessage) => {
    if (!('id' in message) || !('method' in message)) return
    const params = (message.params ?? {}) as Record<string, unknown>
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities, serverInfo: { name: 'fake', version: '1' } }
        : handler(message.method, params)
    if (message.method !== 'initialize') seen.push({ method: message.method, params })
    void server.send({ jsonrpc: '2.0', id: message.id, result } as JsonRpcMessage)
  })
  void server.start()
  const connection = new McpConnection({ name: 'srv', root: '/w', createTransport: () => ({ transport: client }) })
  await connection.connect()
  return { connection, seen, notify: (method: string) => server.send({ jsonrpc: '2.0', method }) }
}

const prompt = (name: string, extra: Partial<McpPrompt> = {}): McpPrompt => ({ name, ...extra })

describe('MCP 提示模板：prompts/list', () => {
  it('按 cursor 合并全部分页', async () => {
    const pages: Record<string, unknown> = {
      '': { prompts: [prompt('a'), prompt('b')], nextCursor: 'p2' },
      p2: { prompts: [prompt('c')], nextCursor: 'p3' },
      p3: { prompts: [prompt('d', { description: 'last' })], nextCursor: '' },
    }
    const { connection, seen } = await connected((_, params) => pages[String(params.cursor ?? '')])
    const listed = await listMcpPrompts(connection)
    expect(listed.items.map((p) => p.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(listed.items[3]).toEqual({ name: 'd', description: 'last' })
    expect(listed.diagnostics).toEqual([])
    expect(seen.map((r) => r.params.cursor)).toEqual([undefined, 'p2', 'p3'])
    await connection.close()
  })

  it('重复的 cursor：停止翻页、保留已取得的项并记诊断', async () => {
    let calls = 0
    const { connection } = await connected((_, params) => {
      calls++
      return params.cursor === undefined ? { prompts: [prompt('a')], nextCursor: 'loop' } : { prompts: [prompt('b')], nextCursor: 'loop' }
    })
    const listed = await listMcpPrompts(connection)
    expect(calls).toBe(2)
    expect(listed.items.map((p) => p.name)).toEqual(['a', 'b'])
    expect(listed.diagnostics).toEqual([expect.objectContaining({ source: 'mcp', code: 'duplicate-cursor', message: expect.stringContaining('srv') })])
    await connection.close()
  })

  it('超过 1000 页时停止并记诊断', async () => {
    let calls = 0
    const { connection } = await connected(() => ({ prompts: [], nextCursor: `c${++calls}` }))
    const listed = await listMcpPrompts(connection)
    expect(calls).toBe(1000)
    expect(listed.diagnostics.map((d) => d.code)).toEqual(['page-limit'])
    await connection.close()
  })

  it('不合 schema 的项被跳过并记诊断；整页不合格时停止', async () => {
    const { connection } = await connected((_, params) =>
      params.cursor === undefined
        ? { prompts: [prompt('ok'), { title: 'no name' }, { name: 'bad-args', arguments: [{ required: true }] }], nextCursor: 'next' }
        : { prompts: 'nope' },
    )
    const listed = await listMcpPrompts(connection)
    expect(listed.items.map((p) => p.name)).toEqual(['ok'])
    expect(listed.diagnostics.map((d) => d.code)).toEqual(['invalid-result', 'invalid-result', 'invalid-result'])
    await connection.close()
  })

  it('Server 没有 prompts 能力时不发请求', async () => {
    const { connection, seen } = await connected(() => ({ prompts: [prompt('a')] }), { tools: {} })
    expect(await listMcpPrompts(connection)).toEqual({ items: [], diagnostics: [] })
    expect(seen.filter((r) => r.method === 'prompts/list')).toEqual([])
    await connection.close()
  })

  it('prompts/list_changed 使列表版本前进', async () => {
    const { connection, notify } = await connected(() => ({ prompts: [] }))
    const before = connection.listRevision('prompts')
    await notify('notifications/prompts/list_changed')
    const deadline = Date.now() + 1000
    while (connection.listRevision('prompts') === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(connection.listRevision('prompts')).toBeGreaterThan(before)
    await connection.close()
  })
})

describe('MCP 提示模板：prompts/get', () => {
  it('位置参数按声明顺序映射，多出的并入最后一个；缺必填参数时给出名字', () => {
    const greet = prompt('greet', { arguments: [{ name: 'name', required: true }, { name: 'tone' }] })
    expect(mapPromptArguments(greet, 'Alice')).toEqual({ arguments: { name: 'Alice' }, missing: [] })
    expect(mapPromptArguments(greet, '"Ada Lovelace" very warm')).toEqual({ arguments: { name: 'Ada Lovelace', tone: 'very warm' }, missing: [] })
    expect(mapPromptArguments(greet, '')).toEqual({ arguments: {}, missing: ['name'] })
    expect(mapPromptArguments(prompt('plain'), 'ignored words')).toEqual({ arguments: {}, missing: [] })
  })

  it('请求带名字与参数；结果中的消息转为文本', async () => {
    const { connection, seen } = await connected(() => ({
      description: 'Greeting',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Say hello to Alice.' } },
        { role: 'assistant', content: { type: 'resource', resource: { uri: 'file:///style.md', mimeType: 'text/markdown', text: 'Be brief.' } } },
      ],
    }))
    const result = await getMcpPrompt(connection, 'greet', { name: 'Alice' })
    expect(seen.at(-1)).toEqual({ method: 'prompts/get', params: { name: 'greet', arguments: { name: 'Alice' } } })
    expect(promptMessagesToText(result.messages)).toBe('Say hello to Alice.\n\n<resource uri="file:///style.md">\nBe brief.\n</resource>')
    await connection.close()
  })

  it('不合 schema 的结果被拒绝（McpResultError 带诊断）', async () => {
    for (const bad of [
      { messages: 'x' },
      { messages: [{ role: 'user' }] },
      { messages: [{ role: 'system', content: { type: 'text', text: 'x' } }] },
      { messages: [{ role: 'user', content: { type: 'text', text: 42 } }] },
      { messages: [{ role: 'user', content: { type: 'resource', resource: { uri: 'u' } } }] },
    ]) {
      const { connection } = await connected(() => bad)
      const error = await getMcpPrompt(connection, 'greet', {}).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(McpResultError)
      expect((error as McpResultError).diagnostic).toMatchObject({ source: 'mcp', code: 'invalid-result', message: expect.stringContaining('prompts/get') })
      await connection.close()
    }
  })

  it('消息转文本：文本拼接、嵌入的文本资源内联、图片与二进制注明省略', () => {
    const text = promptMessagesToText([
      { role: 'user', content: { type: 'text', text: 'one' } },
      { role: 'user', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
      { role: 'user', content: { type: 'resource', resource: { uri: 'mem://bin', mimeType: 'application/zip', blob: 'AAAA' } } },
      { role: 'user', content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' } },
      { role: 'user', content: { type: 'resource_link', uri: 'mem://doc', name: 'doc' } },
      { role: 'assistant', content: { type: 'text', text: 'two' } },
    ])
    expect(text).toBe(
      [
        'one',
        '[image image/png omitted]',
        '[binary resource mem://bin (application/zip, 3B) omitted]',
        '[audio audio/wav omitted]',
        '[resource link mem://doc "doc"]',
        'two',
      ].join('\n\n'),
    )
  })
})

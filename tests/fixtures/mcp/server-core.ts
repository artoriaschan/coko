// MCP 测试 Server 的协议核心（stdio 与 HTTP 共用）：最小 JSON-RPC，工具 echo、env_sha、env_raw、fail、big、sleep、hidden。
// 每个 tools/call 的 params（含 _meta）追加到 options.log（JSONL），测试据此断言幂等键；env_sha 只回报环境变量的 SHA-256，证明收到而不回显值。
// features 含 resources / prompts 时声明对应能力（缺省都不声明，只用工具的用例不受影响）。resources：分 3 页的 resources/list、
// 一个模板、文本 / 超长文本 / PNG / 二进制资源。prompts：greet（必填 name、可选 tone，结果含嵌入的文本资源）、broken（结果不合 schema）、
// env（把环境变量的值放进提示，秘密总闸用）；工具 add_prompt 增加一个提示模板并发出 notifications/prompts/list_changed。
// screenshot：工具 screenshot 返回文本与一张 PNG（FIXTURE_SCREENSHOT_PNG，浏览器预设与图像结果用；不声明时工具数不变）。
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

export interface CoreOptions {
  /** JSONL 事件文件：{ event: 'call', params } 等。 */
  log?: string | undefined
  /** 服务名（serverInfo.name）。 */
  name: string
  /** 声明的额外能力（screenshot 为额外的工具）。 */
  features?: readonly FixtureFeature[]
  /** 向客户端发通知（list_changed）；HTTP 夹具没有服务端流时省略。 */
  notify?: (method: string) => void
  /** add_prompt 增加的提示模板（每个 Server 进程一份）。 */
  addedPrompts?: string[]
}

export type FixtureFeature = 'resources' | 'prompts' | 'screenshot'

/** MCP_FIXTURE_FEATURES（逗号分隔）→ features。 */
export const featuresFrom = (value: string | undefined): CoreOptions['features'] =>
  (value ?? '').split(',').filter((f): f is FixtureFeature => f === 'resources' || f === 'prompts' || f === 'screenshot')

type Json = Record<string, unknown>

export const FIXTURE_TOOLS = [
  { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  {
    name: 'env_sha',
    description: 'SHA-256 of an environment variable',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'env_raw',
    description: 'Value of an environment variable (secrets gate only)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  { name: 'fail', description: 'Always returns an error result', inputSchema: { type: 'object', properties: {} } },
  { name: 'big', description: 'Returns many lines', inputSchema: { type: 'object', properties: { lines: { type: 'integer' } } } },
  { name: 'sleep', description: 'Waits before answering', inputSchema: { type: 'object', properties: { ms: { type: 'integer' } } } },
  { name: 'hidden', description: 'Disabled in tests', inputSchema: { type: 'object' } },
]

const ADD_PROMPT_TOOL = {
  name: 'add_prompt',
  description: 'Adds a prompt and notifies prompts/list_changed',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
}

const SCREENSHOT_TOOL = {
  name: 'screenshot',
  description: 'Take a screenshot of the fixture page',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
/** 一张 width × height 的 RGB 渐变 PNG（base64），作为 screenshot 的结果。 */
function gradientPng(width: number, height: number): string {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    rows.push(0)
    for (let x = 0; x < width; x++) rows.push(Math.round((x / width) * 255), Math.round((y / height) * 255), 160)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png.toString('base64')
}
/** screenshot 工具返回的 PNG（160 × 100）。 */
export const FIXTURE_SCREENSHOT_PNG = gradientPng(160, 100)

/** resources/list 的三页（cursor 缺省 → "p2" → "p3"）。 */
const RESOURCE_PAGES: Record<string, { resources: Json[]; nextCursor?: string }> = {
  '': {
    resources: [
      { uri: 'fixture://notes/readme', name: 'readme', mimeType: 'text/plain' },
      { uri: 'fixture://notes/big', name: 'big', mimeType: 'text/plain' },
    ],
    nextCursor: 'p2',
  },
  p2: { resources: [{ uri: 'fixture://images/dot', name: 'dot', mimeType: 'image/png' }], nextCursor: 'p3' },
  p3: { resources: [{ uri: 'fixture://bin/blob', name: 'blob', mimeType: 'application/octet-stream' }] },
}
/** 1×1 PNG。 */
export const FIXTURE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function readResource(uri: string): unknown {
  switch (uri) {
    case 'fixture://notes/readme':
      return { contents: [{ uri, mimeType: 'text/plain', text: 'Fixture readme: hello from resources.' }] }
    case 'fixture://notes/big':
      return { contents: [{ uri, mimeType: 'text/plain', text: Array.from({ length: 2500 }, (_, i) => `note ${i + 1}`).join('\n') }] }
    case 'fixture://images/dot':
      return { contents: [{ uri, mimeType: 'image/png', blob: FIXTURE_PNG }] }
    case 'fixture://bin/blob':
      return { contents: [{ uri, mimeType: 'application/octet-stream', blob: Buffer.alloc(3000, 7).toString('base64') }] }
    default:
      if (uri.startsWith('fixture://items/')) return { contents: [{ uri, mimeType: 'text/plain', text: `item ${uri.slice('fixture://items/'.length)}` }] }
      return undefined
  }
}

function prompts(options: CoreOptions): Json[] {
  return [
    {
      name: 'greet',
      description: 'Greet someone',
      arguments: [
        { name: 'name', description: 'Who to greet', required: true },
        { name: 'tone', description: 'How to sound' },
      ],
    },
    { name: 'broken', description: 'Returns an invalid result' },
    { name: 'env', arguments: [{ name: 'var', required: true }] },
    ...(options.addedPrompts ?? []).map((name) => ({ name, description: `Added at runtime: ${name}` })),
  ]
}

function getPrompt(params: Json, options: CoreOptions, env: NodeJS.ProcessEnv): unknown {
  const args = (params.arguments ?? {}) as Record<string, string>
  switch (params.name) {
    case 'greet':
      return {
        description: 'Greeting',
        messages: [
          { role: 'user', content: { type: 'text', text: `Say hello to ${args.name}${args.tone ? ` in a ${args.tone} tone` : ''}.` } },
          { role: 'user', content: { type: 'resource', resource: { uri: 'fixture://style', mimeType: 'text/plain', text: 'Keep it to one sentence.' } } },
        ],
      }
    case 'broken':
      return { messages: [{ role: 'user', content: { type: 'text' } }] }
    case 'env':
      return { messages: [{ role: 'user', content: { type: 'text', text: `The value is ${env[args.var ?? ''] ?? ''}` } }] }
    default:
      if ((options.addedPrompts ?? []).includes(String(params.name)))
        return { messages: [{ role: 'user', content: { type: 'text', text: `Added prompt ${String(params.name)}` } }] }
      return undefined
  }
}

export function record(log: string | undefined, event: Json): void {
  if (log) appendFileSync(log, `${JSON.stringify({ ...event, pid: process.pid })}\n`)
}

const text = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) })

async function call(params: Json, env: NodeJS.ProcessEnv, options: CoreOptions): Promise<unknown> {
  const args = (params.arguments ?? {}) as Json
  switch (params.name) {
    case 'add_prompt':
      if (!options.features?.includes('prompts')) return text('unknown tool add_prompt', true)
      ;(options.addedPrompts ??= []).push(String(args.name))
      options.notify?.('notifications/prompts/list_changed')
      return text(`added ${String(args.name)}`)
    case 'screenshot':
      if (!options.features?.includes('screenshot')) return text('unknown tool screenshot', true)
      return {
        content: [
          { type: 'text', text: `Screenshot of ${String(args.url ?? 'the fixture page')}` },
          { type: 'image', data: FIXTURE_SCREENSHOT_PNG, mimeType: 'image/png' },
        ],
      }
    case 'echo':
      return text(`echo:${String(args.text ?? '')}`)
    case 'env_sha': {
      const value = env[String(args.name)]
      return text(JSON.stringify({ name: args.name, sha256: value === undefined ? null : createHash('sha256').update(value).digest('hex') }))
    }
    case 'env_raw':
      return text(`${String(args.name)}=${env[String(args.name)] ?? ''}`)
    case 'fail':
      return text('fixture failure', true)
    case 'big':
      return text(Array.from({ length: Number(args.lines ?? 3000) }, (_, i) => `row ${i + 1}`).join('\n'))
    case 'sleep':
      await new Promise((resolve) => setTimeout(resolve, Number(args.ms ?? 5000)))
      return text('slept')
    default:
      return text(`unknown tool ${String(params.name)}`, true)
  }
}

/** 处理一条 JSON-RPC 消息；通知返回 undefined。 */
export async function handle(message: Json, options: CoreOptions, env: NodeJS.ProcessEnv = process.env): Promise<Json | undefined> {
  if (message.id === undefined) return undefined
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result })
  const params = (message.params ?? {}) as Json
  const features = options.features ?? []
  const notFound = () => ({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${String(message.method)}` } })
  const invalid = (what: string) => ({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown ${what}` } })
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: {
          tools: {},
          ...(features.includes('resources') ? { resources: { listChanged: true } } : {}),
          ...(features.includes('prompts') ? { prompts: { listChanged: true } } : {}),
        },
        serverInfo: { name: options.name, version: '1.0.0' },
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: [...FIXTURE_TOOLS, ...(features.includes('prompts') ? [ADD_PROMPT_TOOL] : []), ...(features.includes('screenshot') ? [SCREENSHOT_TOOL] : [])],
      })
    case 'tools/call':
      record(options.log, { event: 'call', params })
      return reply(await call(params, env, options))
    case 'resources/list':
      if (!features.includes('resources')) return notFound()
      record(options.log, { event: 'resources/list', cursor: params.cursor ?? null })
      return RESOURCE_PAGES[String(params.cursor ?? '')] ? reply(RESOURCE_PAGES[String(params.cursor ?? '')]) : invalid('cursor')
    case 'resources/templates/list':
      if (!features.includes('resources')) return notFound()
      return reply({ resourceTemplates: [{ uriTemplate: 'fixture://items/{id}', name: 'item', description: 'One item by id' }] })
    case 'resources/read': {
      if (!features.includes('resources')) return notFound()
      const result = readResource(String(params.uri))
      return result === undefined ? invalid(`resource ${String(params.uri)}`) : reply(result)
    }
    case 'prompts/list':
      if (!features.includes('prompts')) return notFound()
      record(options.log, { event: 'prompts/list' })
      return reply({ prompts: prompts(options) })
    case 'prompts/get': {
      if (!features.includes('prompts')) return notFound()
      record(options.log, { event: 'prompts/get', params })
      const result = getPrompt(params, options, env)
      return result === undefined ? invalid(`prompt ${String(params.name)}`) : reply(result)
    }
    default:
      return notFound()
  }
}

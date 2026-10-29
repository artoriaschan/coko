// MCP 测试 Server 的协议核心（stdio 与 HTTP 共用）：最小 JSON-RPC，工具 echo、env_sha、fail、big、sleep。
// 每个 tools/call 的 params（含 _meta）追加到 options.log（JSONL），测试据此断言幂等键；env_sha 只回报环境变量的 SHA-256，证明收到而不回显值。
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

export interface CoreOptions {
  /** JSONL 事件文件：{ event: 'call', params } 等。 */
  log?: string | undefined
  /** 服务名（serverInfo.name）。 */
  name: string
}

type Json = Record<string, unknown>

export const FIXTURE_TOOLS = [
  { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  {
    name: 'env_sha',
    description: 'SHA-256 of an environment variable',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  { name: 'fail', description: 'Always returns an error result', inputSchema: { type: 'object', properties: {} } },
  { name: 'big', description: 'Returns many lines', inputSchema: { type: 'object', properties: { lines: { type: 'integer' } } } },
  { name: 'sleep', description: 'Waits before answering', inputSchema: { type: 'object', properties: { ms: { type: 'integer' } } } },
  { name: 'hidden', description: 'Disabled in tests', inputSchema: { type: 'object' } },
]

export function record(log: string | undefined, event: Json): void {
  if (log) appendFileSync(log, `${JSON.stringify({ ...event, pid: process.pid })}\n`)
}

const text = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) })

async function call(params: Json, env: NodeJS.ProcessEnv): Promise<unknown> {
  const args = (params.arguments ?? {}) as Json
  switch (params.name) {
    case 'echo':
      return text(`echo:${String(args.text ?? '')}`)
    case 'env_sha': {
      const value = env[String(args.name)]
      return text(JSON.stringify({ name: args.name, sha256: value === undefined ? null : createHash('sha256').update(value).digest('hex') }))
    }
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
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: options.name, version: '1.0.0' } })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: FIXTURE_TOOLS })
    case 'tools/call':
      record(options.log, { event: 'call', params })
      return reply(await call(params, env))
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${String(message.method)}` } }
  }
}

#!/usr/bin/env node
// 语言服务器测试夹具：stdio JSON-RPC 2.0（Content-Length 分帧）。仓库内脚本，测试不从网络安装。
//   --record <file>        把收到的每条消息（JSON）追加到 file（每条一行）
//   --diagnostics <json>   didOpen / didChange 之后对该文件发 textDocument/publishDiagnostics（Diagnostic[]）
//   --definition <json>    textDocument/definition 的结果（Location 或 Location[]）
//   --references <json>    textDocument/references 的结果（Location[]）
//   --hover <text>         textDocument/hover 的结果（markdown）
//   --crash-after <n>      回答第 n 个请求之后以 1 退出（不回答之后的请求）
//   --slow-start <ms>      initialize 的回答延迟
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const json = (name) => (option(name) === undefined ? undefined : JSON.parse(option(name)))
const record = option('--record')
const crashAfter = option('--crash-after') === undefined ? undefined : Number(option('--crash-after'))
const slowStart = Number(option('--slow-start') ?? 0)
let answered = 0

const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message })
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body)
}
const reply = (id, result) => {
  send({ id, result })
  answered++
  if (crashAfter !== undefined && answered >= crashAfter) process.exit(1)
}

async function handle(message) {
  if (record) appendFileSync(record, JSON.stringify(message) + '\n')
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      if (slowStart > 0) await new Promise((resolve) => setTimeout(resolve, slowStart))
      return reply(id, {
        capabilities: { textDocumentSync: 1, definitionProvider: true, referencesProvider: true, hoverProvider: true },
        serverInfo: { name: 'coko-lsp-fixture', version: '0.0.0' },
      })
    case 'textDocument/didOpen':
    case 'textDocument/didChange': {
      const diagnostics = json('--diagnostics')
      if (diagnostics) send({ method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics } })
      return
    }
    case 'textDocument/definition':
      return reply(id, json('--definition') ?? null)
    case 'textDocument/references':
      return reply(id, json('--references') ?? [])
    case 'textDocument/hover': {
      const text = option('--hover')
      return reply(id, text === undefined ? null : { contents: { kind: 'markdown', value: text } })
    }
    case 'shutdown':
      return reply(id, null)
    case 'exit':
      return process.exit(0)
    default:
      // 未知请求回空结果；通知（没有 id）忽略。
      if (id !== undefined) reply(id, null)
  }
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1])
    if (!Number.isFinite(length) || buffer.length < end + 4 + length) return
    const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8')
    buffer = buffer.subarray(end + 4 + length)
    void handle(JSON.parse(body))
  }
})
process.stdin.on('end', () => process.exit(0))

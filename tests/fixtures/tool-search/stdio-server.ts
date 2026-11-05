// Real stdio MCP fixture with a per-test catalog file; calls use the shared MCP fixture implementation.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { handle, record } from '../mcp/server-core.ts'

const tools = JSON.parse(readFileSync(process.env.TOOL_SEARCH_FIXTURE_CATALOG!, 'utf8'))
const options = { name: 'tool-search-fixture', log: process.env.MCP_FIXTURE_LOG }
record(options.log, { event: 'start' })
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  const response = message.method === 'tools/list' ? Promise.resolve({ jsonrpc: '2.0', id: message.id, result: { tools } }) : handle(message, options)
  void response.then((value) => {
    if (value) process.stdout.write(`${JSON.stringify(value)}\n`)
  })
})
input.on('close', () => process.exit(0))

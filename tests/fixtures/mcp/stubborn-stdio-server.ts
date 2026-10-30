// 忽略 stdin 关闭的 stdio MCP 测试 Server（孤儿清理用例，ADR 0012）：协议与 stdio-server.ts 相同，但 stdin 关闭后继续运行，
// 只能被信号终止。MCP_FIXTURE_LOG 的 start 事件带 pid。为免测试失败时长期残留，运行 MCP_FIXTURE_MAX_LIFETIME_MS（默认 120 000）后自行退出。
import { createInterface } from 'node:readline'
import { handle, record, type CoreOptions } from './server-core.ts'

const log = process.env.MCP_FIXTURE_LOG
record(log, { event: 'start', cwd: process.cwd(), argv: process.argv.slice(2) })

const options: CoreOptions = { log, name: process.env.MCP_FIXTURE_NAME ?? 'stubborn-fixture' }
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (!line.trim()) return
  void handle(JSON.parse(line) as Record<string, unknown>, options).then((response) => {
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  })
})
// stdin 关闭时不退出；stdout 断开（父进程已不在）时写入失败也不退出。
lines.on('close', () => record(log, { event: 'stdin-closed' }))
process.stdout.on('error', () => undefined)
setTimeout(() => process.exit(0), Number(process.env.MCP_FIXTURE_MAX_LIFETIME_MS ?? 120_000))

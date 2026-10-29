// stdio MCP 测试 Server：node tests/fixtures/mcp/stdio-server.ts。由测试经 MCP 配置启动（仓库内脚本，不从网络安装）。
// 环境变量：MCP_FIXTURE_LOG（JSONL：start 带 pid 与 cwd、call 带 params）、MCP_FIXTURE_NAME、MCP_FIXTURE_STDERR（启动时写到 stderr）、
// MCP_FIXTURE_FAIL_IF（该文件存在时写 stderr 后以 1 退出，用于崩溃后重连失败）、MCP_FIXTURE_STDERR_ENV（把该环境变量的值写到 stderr 后退出，
// 用于验证 stderr 诊断经 Secret 脱敏）、MCP_FIXTURE_FEATURES（逗号分隔的 resources、prompts）。
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { featuresFrom, handle, record, type CoreOptions } from './server-core.ts'

const log = process.env.MCP_FIXTURE_LOG
const name = process.env.MCP_FIXTURE_NAME ?? 'stdio-fixture'

record(log, { event: 'start', cwd: process.cwd(), argv: process.argv.slice(2) })
if (process.env.MCP_FIXTURE_STDERR) process.stderr.write(`${process.env.MCP_FIXTURE_STDERR}\n`)
const failIf = process.env.MCP_FIXTURE_FAIL_IF
if (failIf && existsSync(failIf)) {
  process.stderr.write('fixture refused to start: fail flag present\n')
  process.exit(1)
}
const leak = process.env.MCP_FIXTURE_STDERR_ENV
if (leak) {
  process.stderr.write(`fixture diagnostic: ${leak}=${process.env[leak] ?? ''}\n`)
  process.exit(1)
}

const options: CoreOptions = {
  log,
  name,
  features: featuresFrom(process.env.MCP_FIXTURE_FEATURES),
  notify: (method) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`),
}
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (!line.trim()) return
  void handle(JSON.parse(line) as Record<string, unknown>, options).then((response) => {
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  })
})
// stdin 关闭（Sidecar 有序关闭）时退出。
lines.on('close', () => {
  record(log, { event: 'exit' })
  process.exit(0)
})

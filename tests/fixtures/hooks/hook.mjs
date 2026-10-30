#!/usr/bin/env node
// Hook 测试夹具：读取 stdin（一行 JSON），按参数记录、输出与退出。仓库内脚本，测试不从网络安装。
//   --record <file>   把 stdin 原文追加到 file（每次一行）
//   --exit <n>        退出码（缺省 0）
//   --stdout <text>   写到 stdout（例如一段 JSON）
//   --stderr <text>   写到 stderr
//   --sleep <ms>      退出前等待
//   --ignore-term     忽略 SIGTERM（超时用例断言之后的 SIGKILL）
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
if (args.includes('--ignore-term')) process.on('SIGTERM', () => {})

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', async () => {
  const record = option('--record')
  if (record) appendFileSync(record, input.replace(/\n$/, '') + '\n')
  const stdout = option('--stdout')
  if (stdout !== undefined) process.stdout.write(stdout)
  const stderr = option('--stderr')
  if (stderr !== undefined) process.stderr.write(stderr)
  const sleep = Number(option('--sleep') ?? 0)
  if (sleep > 0) await new Promise((resolve) => setTimeout(resolve, sleep))
  process.exit(Number(option('--exit') ?? 0))
})

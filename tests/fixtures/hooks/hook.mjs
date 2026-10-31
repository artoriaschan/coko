#!/usr/bin/env node
// Hook 测试夹具：读取 stdin（一行 JSON），按参数记录、输出与退出。仓库内脚本，测试不从网络安装。
//   --record <file>   把 stdin 原文追加到 file（每次一行）
//   --exit <n>        退出码（缺省 0）
//   --stdout <text>   写到 stdout（例如一段 JSON）
//   --stderr <text>   写到 stderr
//   --sleep <ms>      退出前等待
//   --ignore-term     忽略 SIGTERM（超时用例断言之后的 SIGKILL）
//   --start <file>    读完 stdin 后先创建 file（barrier：表示本 Hook 已开始）
//   --await <file>    创建 --start 之后、输出之前等待 file 出现（barrier：两个 Hook 互相等待对方的 start 文件，
//                     只有并行运行时都能继续；串行时第一个一直等待）
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'

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
  const start = option('--start')
  if (start) writeFileSync(start, String(process.pid))
  const awaited = option('--await')
  while (awaited && !existsSync(awaited)) await new Promise((resolve) => setTimeout(resolve, 10))
  const stdout = option('--stdout')
  if (stdout !== undefined) process.stdout.write(stdout)
  const stderr = option('--stderr')
  if (stderr !== undefined) process.stderr.write(stderr)
  const sleep = Number(option('--sleep') ?? 0)
  if (sleep > 0) await new Promise((resolve) => setTimeout(resolve, sleep))
  process.exit(Number(option('--exit') ?? 0))
})

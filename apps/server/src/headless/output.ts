// 无界面运行的输出：stream-json 逐行写与 WebSocket 相同的 ServerMessage（entry / progress），最后一行为 result；json 只写 result；
// text 只写最终的 assistant 文本。stdout 只有这些内容（日志写文件）。
import type { ServerMessage, SessionEntryRecord } from '@coko/protocol'
import type { OutputFormat } from './args.ts'

/** 结果状态：Run 的结束状态，或 failed（Run 没能开始，例如缺凭据）。 */
export type HeadlessStatus = 'completed' | 'error' | 'paused' | 'aborted' | 'interrupted' | 'failed'

export interface HeadlessUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  /** 各请求费用之和；都未定价时省略。 */
  cost?: number
}

export interface HeadlessResult {
  type: 'result'
  status: HeadlessStatus
  sessionId: string | null
  runId: string | null
  text: string
  usage: HeadlessUsage
  durationMs: number
  error?: { code: string; message: string }
  /** 有调用被无界面运行拒绝时为 true（--on-approval fail 时进程以 3 退出）。 */
  approvalDenied?: boolean
}

export const EMPTY_USAGE: HeadlessUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

/** 进程退出码：0 completed、1 失败、2 暂停或被停止、3 审批被拒且 --on-approval fail、4 参数或启动错误（由入口给出）。 */
export function exitCodeOf(result: HeadlessResult, failOnApproval: boolean): number {
  if (failOnApproval && result.approvalDenied) return 3
  switch (result.status) {
    case 'completed':
      return 0
    case 'paused':
    case 'aborted':
    case 'interrupted':
      return 2
    default:
      return 1
  }
}

/** 该 Run 的 model_request 用量之和。 */
export function runUsage(entries: readonly SessionEntryRecord[], runId: string): HeadlessUsage {
  const usage = { ...EMPTY_USAGE }
  let cost: number | undefined
  for (const entry of entries) {
    if (entry.kind !== 'model_request' || entry.runId !== runId) continue
    const payload = entry.payload as { usage: Omit<HeadlessUsage, 'cost'>; cost?: number }
    usage.input += payload.usage.input
    usage.output += payload.usage.output
    usage.cacheRead += payload.usage.cacheRead
    usage.cacheWrite += payload.usage.cacheWrite
    usage.total += payload.usage.total
    if (payload.cost !== undefined) cost = (cost ?? 0) + payload.cost
  }
  return cost === undefined ? usage : { ...usage, cost }
}

/** 该 Run 最后一条 assistant 消息的文本块。 */
export function finalText(entries: readonly SessionEntryRecord[], runId: string): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.runId !== runId || entry.kind !== 'message') continue
    const payload = entry.payload as { role: string; content: { type: string; text?: string }[] }
    if (payload.role !== 'assistant') continue
    return payload.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
  }
  return ''
}

export interface Output {
  message(message: ServerMessage): void
  result(result: HeadlessResult): void
  /** 等待 stdout 写完。 */
  flush(): Promise<void>
}

export function createOutput(format: OutputFormat, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Output {
  let pending = Promise.resolve()
  const write = (stream: NodeJS.WritableStream, text: string) => {
    pending = pending.then(() => new Promise<void>((resolve) => void stream.write(text, () => resolve())))
  }
  return {
    message(message) {
      if (format === 'stream-json') write(stdout, `${JSON.stringify(message)}\n`)
    },
    result(result) {
      if (format !== 'text') return write(stdout, `${JSON.stringify(result)}\n`)
      if (result.text) write(stdout, result.text.endsWith('\n') ? result.text : `${result.text}\n`)
      if (result.error) write(stderr, `coko headless: ${result.status}: ${result.error.code}: ${result.error.message}\n`)
    },
    flush: () => pending,
  }
}

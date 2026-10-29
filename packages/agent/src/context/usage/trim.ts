// 时间裁剪（M3 规格"预算与数值"，参照 claude-code 的 time-based microcompact）：距上一条 assistant 超过 60 分钟（提示缓存已冷）时，
// 较早的大段 toolResult 替换为说明文本。只改模型请求（经 transformMessages），不改条目。
import type { AgentMessage } from '@earendil-works/pi-agent-core'

export const OLD_TOOL_RESULT_CLEARED = '[Old tool result content cleared]'
/** 间隔超过该值（毫秒）视为缓存已冷。 */
export const TRIM_GAP_MS = 60 * 60_000
/** 每个裁剪点保留最近的 toolResult 个数。 */
export const TRIM_KEEP_RECENT = 5
/** 只替换超过该大小（UTF-8 字节）的结果。 */
export const TRIM_MIN_BYTES = 2048

const encoder = new TextEncoder()

const resultBytes = (message: AgentMessage): number => {
  let bytes = 0
  for (const block of (message as { content: { type: string; text?: string; data?: string }[] }).content) {
    if (block.type === 'text') bytes += encoder.encode(block.text ?? '').length
    else if (block.type === 'image') bytes += block.data?.length ?? 0
  }
  return bytes
}

/**
 * 裁剪点：assistant 之后第一条间隔超过 60 分钟的非 assistant 消息（用户隔了很久才发消息，或工具结果隔了很久才到），以及 now 距最后一条
 * assistant 超过 60 分钟时的末尾。每个裁剪点之前的 toolResult 除最近 5 个外，超过 2KB 的被替换。裁剪点只由消息的时间戳决定，
 * 所以同一 Run 的后续请求与之后的 Run 得到相同的前缀（不反复改变缓存前缀）。
 */
export function trimOldToolResults(messages: AgentMessage[], options: { now: number }): AgentMessage[] {
  const points: number[] = []
  let lastAssistant: number | undefined
  let marked = false
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      lastAssistant = (message as { timestamp: number }).timestamp
      marked = false
      return
    }
    if (lastAssistant === undefined || marked) return
    if ((message as { timestamp?: number }).timestamp! - lastAssistant > TRIM_GAP_MS) {
      points.push(index)
      marked = true
    }
  })
  if (lastAssistant !== undefined && options.now - lastAssistant > TRIM_GAP_MS) points.push(messages.length)
  if (points.length === 0) return messages

  const results: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'toolResult') results.push(index)
  })
  const clear = new Set<number>()
  for (const point of points) {
    const before = results.filter((index) => index < point)
    for (const index of before.slice(0, Math.max(0, before.length - TRIM_KEEP_RECENT))) {
      const message = messages[index]!
      const content = (message as { content: { type: string; text?: string }[] }).content
      const already = content.length === 1 && content[0]!.type === 'text' && content[0]!.text === OLD_TOOL_RESULT_CLEARED
      if (!already && resultBytes(message) > TRIM_MIN_BYTES) clear.add(index)
    }
  }
  if (clear.size === 0) return messages
  return messages.map((message, index) =>
    clear.has(index) ? ({ ...message, content: [{ type: 'text', text: OLD_TOOL_RESULT_CLEARED }] } as AgentMessage) : message,
  )
}

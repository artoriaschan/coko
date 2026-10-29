// Token 估算（M3 规格"预算与数值"）：最后一次有效的 assistant usage 加其后消息的 chars/4；没有 usage 时全部 chars/4。
// 字符计法与 pi coding-agent 1.4.0 的 estimateTokens 相同（MIT, Copyright (c) 2025 Mario Zechner）：图片按 4800 字符。
import type { AgentMessage } from '@earendil-works/pi-agent-core'

const IMAGE_CHARS = 4800

/** chars/4，向上取整。 */
export const charsToTokens = (chars: number) => Math.ceil(Math.max(0, chars) / 4)

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }

const contentChars = (content: unknown): number => {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const block of content as Block[]) {
    if (block.type === 'text') chars += block.text?.length ?? 0
    else if (block.type === 'image') chars += IMAGE_CHARS
  }
  return chars
}

/** 一条消息按模型可见内容计的字符数（system 计正文、各段与新增工具定义；assistant 计文本、思考与工具调用的名字和参数 JSON）。 */
export function estimateMessageChars(message: AgentMessage): number {
  const m = message as { role: string; content?: unknown; sections?: Record<string, string | null>; toolsAdded?: unknown[] }
  switch (m.role) {
    case 'system': {
      let chars = contentChars(m.content)
      for (const section of Object.values(m.sections ?? {})) chars += section?.length ?? 0
      if (m.toolsAdded?.length) chars += JSON.stringify(m.toolsAdded).length
      return chars
    }
    case 'user':
    case 'toolResult':
      return contentChars(m.content)
    case 'assistant': {
      let chars = 0
      for (const block of (m.content ?? []) as Block[]) {
        if (block.type === 'text') chars += block.text?.length ?? 0
        else if (block.type === 'thinking') chars += block.thinking?.length ?? 0
        else if (block.type === 'toolCall') chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? {}).length
      }
      return chars
    }
    default:
      return 0
  }
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** 与 context_usage progress 相同：input + cacheRead + cacheWrite + output。 */
export const usageTokens = (usage: Usage) => usage.input + usage.cacheRead + usage.cacheWrite + usage.output

/** 有效的 usage：不是出错或中止的回复，且不为 0。 */
function assistantUsage(message: AgentMessage): Usage | undefined {
  const m = message as { role: string; usage?: Usage; stopReason?: string }
  if (m.role !== 'assistant' || !m.usage || m.stopReason === 'error' || m.stopReason === 'aborted') return undefined
  return usageTokens(m.usage) > 0 ? m.usage : undefined
}

export interface ContextTokenEstimate {
  tokens: number
  /** 最后一次有效 usage 的 token 数；没有时为 0。 */
  usageTokens: number
  /** 按 chars/4 估算的消息部分（usage 之后的消息，没有 usage 时为全部消息）。 */
  trailingTokens: number
  /** 是否含按 chars/4 估算的部分。 */
  estimated: boolean
}

/** 没有 usage 时只计消息；宿主另加系统提示与工具定义（见 apps/server context/usage.ts）。 */
export function estimateContextTokens(messages: readonly AgentMessage[]): ContextTokenEstimate {
  let last = -1
  let usage: Usage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    usage = assistantUsage(messages[i]!)
    if (usage) {
      last = i
      break
    }
  }
  let trailingTokens = 0
  for (let i = last + 1; i < messages.length; i++) trailingTokens += charsToTokens(estimateMessageChars(messages[i]!))
  if (!usage) {
    return { tokens: trailingTokens, usageTokens: 0, trailingTokens, estimated: true }
  }
  const used = usageTokens(usage)
  return { tokens: used + trailingTokens, usageTokens: used, trailingTokens, estimated: last < messages.length - 1 }
}

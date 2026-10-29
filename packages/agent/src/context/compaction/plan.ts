// 压缩的切点与准备（grilling F2、F4）：从最后一个有效 compaction 保留的部分起，从尾部累加估算 token 到 keepRecentTokens，
// 切点只落在 user 或 assistant 消息开始处（不拆开 toolCall 与 toolResult）；没有可摘要的较早内容时不压缩。
// 算法参照 pi coding-agent 1.4.0 core/compaction/compaction.ts 的 findCutPoint 与 prepareCompaction（MIT, Copyright (c) 2025 Mario Zechner），
// 去掉了拆分回合的二次摘要：切在 assistant 开始处时，它之前的整轮都进入摘要。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { effectiveEntries, modelContext, type CompactionFields, type EntryLike } from '../../entries/index.ts'
import { charsToTokens, estimateContextTokens, estimateMessageChars, type ContextTokenEstimate } from '../usage/index.ts'

/** 压缩后保留的最近消息的估算 token 数。 */
export const KEEP_RECENT_TOKENS = 20_000

export interface CompactionPlan {
  /** 新 compaction 条目的 firstKeptSeq：保留的第一条消息条目。 */
  firstKeptSeq: number
  /** 要摘要的消息（上一个摘要之后、切点之前；不含出错或中止的回复与 system 消息）。 */
  messages: AgentMessage[]
  /** 上一个有效 compaction 的摘要（增量更新）。 */
  previousSummary?: string
  /** 只读过的文件（改过的只列在 modifiedFiles），含上一个 compaction 的。 */
  readFiles: string[]
  modifiedFiles: string[]
  /** 已调用的 Skill（skill 工具调用与 skill 来源的命令），含上一个 compaction 的。 */
  invokedSkills: string[]
}

type Payload = Record<string, unknown>
const isRecord = (value: unknown): value is Payload => typeof value === 'object' && value !== null
const roleOf = (entry: EntryLike) => (isRecord(entry.payload) ? entry.payload.role : undefined)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

/** 出错或中止的回复：不发给模型（pi-ai 跳过它们），也不作为切点或摘要内容。 */
export function isFailedReply(message: unknown): boolean {
  return isRecord(message) && message.role === 'assistant' && (message.stopReason === 'error' || message.stopReason === 'aborted')
}

/** 计入切点与摘要的消息条目：user、assistant 与 toolResult（system 是工具声明的变化，不是对话）。 */
const conversational = (entry: EntryLike) => {
  if (entry.kind !== 'message' || !isRecord(entry.payload)) return false
  const role = entry.payload.role
  return (role === 'user' || role === 'assistant' || role === 'toolResult') && !isFailedReply(entry.payload)
}

const toolCalls = (message: AgentMessage): { name: string; arguments: Payload }[] => {
  if (message.role !== 'assistant') return []
  return (message.content as { type: string; name?: unknown; arguments?: unknown }[]).flatMap((block) =>
    block.type === 'toolCall' && typeof block.name === 'string' ? [{ name: block.name, arguments: isRecord(block.arguments) ? block.arguments : {} }] : [],
  )
}

export function planCompaction(entries: readonly EntryLike[], options: { keepRecentTokens?: number } = {}): CompactionPlan | undefined {
  const keepRecent = options.keepRecentTokens ?? KEEP_RECENT_TOKENS
  const effective = effectiveEntries(entries, { compacted: true })
  const previous = effective.find((entry) => entry.kind === 'compaction')
  const candidates = effective.filter(conversational)
  if (candidates.length === 0) return undefined

  let cut = -1
  let accumulated = 0
  for (let i = candidates.length - 1; i >= 0; i--) {
    accumulated += charsToTokens(estimateMessageChars(candidates[i]!.payload as AgentMessage))
    if (accumulated < keepRecent) continue
    // 越过预算的位置之后最近的切点；最后的工具结果本身就超过预算时，保留它的调用。
    const isCut = (index: number) => roleOf(candidates[index]!) !== 'toolResult'
    let at = -1
    for (let j = i; j < candidates.length; j++)
      if (isCut(j)) {
        at = j
        break
      }
    if (at < 0)
      for (let j = candidates.length - 1; j >= 0; j--)
        if (isCut(j)) {
          at = j
          break
        }
    cut = at
    break
  }
  if (cut <= 0) return undefined

  const summarized = candidates.slice(0, cut)
  const firstKeptSeq = candidates[cut]!.seq
  const prior = previous && isRecord(previous.payload) ? previous.payload : undefined
  const read = new Set(strings(prior?.readFiles))
  const modified = new Set(strings(prior?.modifiedFiles))
  const skills = new Set(strings(prior?.invokedSkills))
  const messages = summarized.map((entry) => entry.payload as AgentMessage)
  for (const message of messages) {
    for (const call of toolCalls(message)) {
      const path = typeof call.arguments.path === 'string' ? call.arguments.path : undefined
      if (call.name === 'read' && path) read.add(path)
      else if ((call.name === 'write' || call.name === 'edit') && path) modified.add(path)
      else if (call.name === 'skill' && typeof call.arguments.name === 'string') skills.add(call.arguments.name)
    }
  }
  for (const entry of effective) {
    if (entry.kind !== 'command' || entry.seq >= firstKeptSeq || !isRecord(entry.payload)) continue
    if (entry.payload.source === 'skill' && typeof entry.payload.name === 'string') skills.add(entry.payload.name)
  }
  return {
    firstKeptSeq,
    messages,
    ...(prior && typeof prior.summary === 'string' ? { previousSummary: prior.summary } : {}),
    readFiles: [...read].filter((path) => !modified.has(path)).sort(),
    modifiedFiles: [...modified].sort(),
    invokedSkills: [...skills].sort(),
  }
}

/**
 * 模型上下文（modelContext）的 token 估算：最后一次有效 usage 只在它晚于最后一个有效 compaction 时可信（之前的 usage 量的是被摘要
 * 替代的历史），否则全部按 chars/4。只计消息；没有可信 usage 时宿主另加系统提示与工具定义。
 */
export function estimateCompactedTokens(entries: readonly EntryLike[]): ContextTokenEstimate {
  const messages = modelContext(entries) as AgentMessage[]
  const effective = effectiveEntries(entries, { compacted: true })
  const compaction = effective.find((entry) => entry.kind === 'compaction')
  if (!compaction) return estimateContextTokens(messages)
  const kept = effective.filter((entry) => entry.kind === 'message')
  const fresh = kept.findIndex((entry) => entry.seq > compaction.seq)
  if (fresh >= 0) {
    // messages[0] 是合成摘要消息。
    const tail = estimateContextTokens(messages.slice(1 + fresh))
    if (tail.usageTokens > 0) return tail
  }
  const tokens = messages.reduce((sum, message) => sum + charsToTokens(estimateMessageChars(message)), 0)
  return { tokens, usageTokens: 0, trailingTokens: tokens, estimated: true }
}

/** compaction 条目中派生用到的字段（再导出，供宿主构造合成条目）。 */
export type { CompactionFields }

// Session Reference（@session:<id>）的文字记录（docs/subsystems/context.md）：被引用会话的有效上下文（回退与压缩都已应用）序列化为
// [User] / [Assistant] 文本，说话方标记与压缩摘要请求的对话序列化一致。只取用户提交的文本与助手的文字回复；思考、工具调用与工具结果、
// 宿主附加的块（State Update、引用块、附件块、后台任务与子代理的通知、团队消息、Hook 上下文）与图片不进入记录；定时任务的提示词与
// Goal Round 的继续提示是文本输入，保留。记录中的 @session:<id> 与 @path 是文本，不再展开。
import { attachmentReferenceFromText, formatSessionReferenceOpen } from '@coko/protocol'
import { commandInvocation } from '../../checkpoints/rewind.ts'
import { HOST_BLOCK_TAGS } from '../../entries/host-input.ts'
import { effectiveEntries, pairedStateUpdates, type CompactionFields, type EntryLike } from '../../entries/index.ts'
import { DEFAULT_MAX_BYTES } from '../../tools/truncate.ts'

/** 单个会话引用的记录上限（UTF-8 字节，与单个文件相同）。 */
export const SESSION_REFERENCE_MAX_BYTES = DEFAULT_MAX_BYTES

/** 被引用会话没有可附内容时块中的说明（英文，发给模型）；其余说明见 expand.ts 的 SESSION_REFERENCE_NOTES。 */
export const EMPTY_SESSION_NOTE = '[No messages in this session.]'

const SEPARATOR = '\n\n'
const SUMMARY_TRUNCATED = '[Summary truncated to fit the session reference limit]'
const MESSAGE_TRUNCATED = '[Earlier part of this message omitted to fit the session reference limit]'
const omittedNotice = (count: number) => `[${count} earlier ${count === 1 ? 'message' : 'messages'} omitted to fit the session reference limit]`
/** 截断时为说明行（省略条数、截断标记与分隔）预留的字节；可用字节少于它时截断后的记录没有任何消息内容。 */
export const NOTICE_RESERVE = 200
/** 宿主块中作为文本输入留在记录里的两种：定时任务的提示词与 Goal Round 的继续提示。 */
const TEXT_INPUT_TAGS: ReadonlySet<string> = new Set(['scheduled_task', 'goal_round'])
// ponytail: 只看开头的标签，不核对前置条目；用户自己输入的以宿主标签开头的文本也不进入记录（少一段文字，不会多出宿主内容）。
const HOST_BLOCK = new RegExp(`^<(?:${HOST_BLOCK_TAGS.filter((tag) => !TEXT_INPUT_TAGS.has(tag)).join('|')})[\\s>]`)
/** 宿主附加在 user message 中的块：系统提示列出的宿主块（HOST_BLOCK_TAGS）与附件块。 */
const isHostBlock = (text: string) => HOST_BLOCK.test(text) || attachmentReferenceFromText(text) !== undefined

const byteLength = (text: string) => Buffer.byteLength(text, 'utf-8')
/** 按字节截取开头，不留半个字符。 */
const clip = (text: string, maxBytes: number) => Buffer.from(text, 'utf-8').subarray(0, Math.max(0, maxBytes)).toString('utf-8').replace(/�+$/u, '')
/** 按字节截取结尾，不留半个字符。 */
const clipEnd = (text: string, maxBytes: number) => {
  const bytes = Buffer.from(text, 'utf-8')
  return bytes
    .subarray(Math.max(0, bytes.length - Math.max(0, maxBytes)))
    .toString('utf-8')
    .replace(/^\uFFFD+/u, '')
}

/** 会话引用块：`title` 为展开那一刻被引用会话的标题。 */
export const sessionReferenceBlock = (id: string, title: string, body: string) => `${formatSessionReferenceOpen(id, title)}\n${body}\n</session_reference>`

type Block = { type?: string; text?: string }
const textBlocks = (content: unknown, skip?: ReadonlySet<number>): string =>
  ((typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []) as Block[])
    .filter((block, index) => block.type === 'text' && typeof block.text === 'string' && !skip?.has(index) && !isHostBlock(block.text))
    .map((block) => block.text)
    .join('\n')

function transcriptParts(entries: readonly EntryLike[]): { summary?: string; messages: string[] } {
  // 命令与 State Update 的归属在只应用回退的条目上判定：压缩边界可能把 command 条目与它的用户消息分开。
  const rewound = effectiveEntries(entries)
  const kept = new Set(effectiveEntries(entries, { compacted: true }))
  const states = pairedStateUpdates(rewound)
  const parts: { summary?: string; messages: string[] } = { messages: [] }
  rewound.forEach((entry, index) => {
    if (!kept.has(entry)) return
    if (entry.kind === 'compaction') parts.summary = `[Summary of the earlier conversation]: ${(entry.payload as CompactionFields).summary}`
    if (entry.kind !== 'message') return
    const { role, content } = entry.payload as { role?: string; content?: unknown }
    if (role === 'user') {
      const text = commandInvocation(rewound, index) ?? textBlocks(content, new Set(states.get(entry.seq)?.map((pair) => pair.blockIndex)))
      if (text.trim()) parts.messages.push(`[User]: ${text}`)
    } else if (role === 'assistant') {
      const text = textBlocks(content)
      if (text.trim()) parts.messages.push(`[Assistant]: ${text}`)
    }
  })
  return parts
}

export interface SessionTranscript {
  body: string
  /** 记录的字节数（计入合计额度）；没有消息时为 0。 */
  bytes: number
  truncated: boolean
}

/**
 * 被引用会话的全部已提交条目 → 文字记录。超过 maxBytes 时保留摘要与最近的消息，从摘要之后最早的消息开始省略并在省略处注明条数；
 * 摘要自身放不下时截断摘要（保留开头）；最近的一条消息自身放不下时保留它的结尾，说话方标记之后注明省略了开头。redact（登记明文的替换）在截断之前逐条作用。
 */
export function sessionTranscript(entries: readonly EntryLike[], options: { maxBytes?: number; redact?: (text: string) => string } = {}): SessionTranscript {
  const maxBytes = options.maxBytes ?? SESSION_REFERENCE_MAX_BYTES
  const redact = options.redact ?? ((text: string) => text)
  const parts = transcriptParts(entries)
  const summary = parts.summary === undefined ? undefined : redact(parts.summary)
  const messages = parts.messages.map(redact)
  if (summary === undefined && messages.length === 0) return { body: EMPTY_SESSION_NOTE, bytes: 0, truncated: false }
  const done = (parts: string[], truncated: boolean) => {
    const body = parts.join(SEPARATOR)
    return { body, bytes: byteLength(body), truncated }
  }
  const full = done([...(summary === undefined ? [] : [summary]), ...messages], false)
  if (full.bytes <= maxBytes) return full

  let room = maxBytes - NOTICE_RESERVE
  const head: string[] = []
  if (summary !== undefined && byteLength(summary) > room) {
    head.push(clip(summary, room), SUMMARY_TRUNCATED)
    room = 0
  } else if (summary !== undefined) {
    head.push(summary)
    room -= byteLength(summary) + SEPARATOR.length
  }
  const tail: string[] = []
  let first = messages.length
  while (first > 0 && byteLength(messages[first - 1]!) + SEPARATOR.length <= room) {
    room -= byteLength(messages[--first]!) + SEPARATOR.length
    tail.unshift(messages[first]!)
  }
  if (tail.length === 0 && room > 0 && first > 0) {
    const last = messages[--first]!
    const speaker = last.slice(0, last.indexOf(': ') + 2)
    tail.push(`${speaker}${MESSAGE_TRUNCATED}\n${clipEnd(last.slice(speaker.length), room - byteLength(speaker))}`)
  }
  return done([...head, ...(first > 0 ? [omittedNotice(first)] : []), ...tail], true)
}

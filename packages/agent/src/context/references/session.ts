// Session Reference（@session:<id>）的文字记录（docs/subsystems/context.md）：被引用会话的有效上下文（回退与压缩都已应用）序列化为
// [User] / [Assistant] 文本，说话方标记与压缩摘要请求的对话序列化一致。只取用户提交的文本与助手的文字回复；思考、工具调用与工具结果、
// 宿主附加的块（State Update、引用块、附件块）与图片不进入记录，记录中的 @session:<id> 与 @path 是文本，不再展开。
import { commandInvocation } from '../../checkpoints/rewind.ts'
import { effectiveEntries, pairedStateUpdates, type CompactionFields, type EntryLike } from '../../entries/index.ts'
import { DEFAULT_MAX_BYTES } from '../../tools/truncate.ts'

/** 单个会话引用的记录上限（UTF-8 字节，与单个文件相同）。 */
export const SESSION_REFERENCE_MAX_BYTES = DEFAULT_MAX_BYTES

/** 不附记录时块中的说明（英文，发给模型）。 */
export const SESSION_REFERENCE_NOTES = {
  empty: '[No messages in this session.]',
  outOfProject: '[Not attached: the session does not belong to the current project.]',
  notReferable: '[Not attached: this session cannot be referenced.]',
  count: '[Not attached: at most 10 references per message.]',
  budget: '[Not attached: references in this message exceed 200KB in total.]',
} as const

const SEPARATOR = '\n\n'
const SUMMARY_TRUNCATED = '[Summary truncated to fit the session reference limit]'
const MESSAGE_TRUNCATED = '[Message truncated to fit the session reference limit]'
const omittedNotice = (count: number) => `[${count} earlier ${count === 1 ? 'message' : 'messages'} omitted to fit the session reference limit]`
/** 截断时为说明行（省略条数、截断标记与分隔）预留的字节；可用字节少于它时截断后的记录没有任何消息内容。 */
export const NOTICE_RESERVE = 200
/** 宿主附加在 user message 中的块：File Reference、Session Reference 与附件（@coko/protocol 的 attachmentReferenceText）。 */
const HOST_BLOCK = /^<(file_reference path=|session_reference id=|coko_attachment>)/

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const byteLength = (text: string) => Buffer.byteLength(text, 'utf-8')
/** 按字节截取开头，不留半个字符。 */
const clip = (text: string, maxBytes: number) => Buffer.from(text, 'utf-8').subarray(0, Math.max(0, maxBytes)).toString('utf-8').replace(/�+$/u, '')

/** 会话引用块：`title` 为展开那一刻被引用会话的标题。 */
export const sessionReferenceBlock = (id: string, title: string, body: string) =>
  `<session_reference id="${escapeAttribute(id)}" title="${escapeAttribute(title)}">\n${body}\n</session_reference>`

type Block = { type?: string; text?: string }
const textBlocks = (content: unknown, skip?: ReadonlySet<number>): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[])
          .filter((block, index) => block.type === 'text' && typeof block.text === 'string' && !skip?.has(index) && !HOST_BLOCK.test(block.text))
          .map((block) => block.text)
          .join('\n')
      : ''

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
 * 摘要自身放不下时截断摘要，最近的一条消息自身放不下时截断它，都注明。
 */
export function sessionTranscript(entries: readonly EntryLike[], options: { maxBytes?: number } = {}): SessionTranscript {
  const maxBytes = options.maxBytes ?? SESSION_REFERENCE_MAX_BYTES
  const { summary, messages } = transcriptParts(entries)
  if (summary === undefined && messages.length === 0) return { body: SESSION_REFERENCE_NOTES.empty, bytes: 0, truncated: false }
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
  if (tail.length === 0 && room > 0 && first > 0) tail.push(clip(messages[--first]!, room), MESSAGE_TRUNCATED)
  return done([...head, ...(first > 0 ? [omittedNotice(first)] : []), ...tail], true)
}

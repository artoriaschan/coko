// 摘要请求（docs/subsystems/context.md#压缩）：合并 pi 的结构化摘要与增量更新（UPDATE）和 claude-code 的逐条用户消息与 Next Step 约束；
// 不做 <analysis> 草稿。对话序列化为文本（模型不会接着对话），工具结果截断，思考省略；File Reference 与指令文件块缩为一行路径，图片标为
// 省略；输入超过上限时从最早处省略（先工具结果，再消息），摘要请求本身不会溢出。序列化参照 pi coding-agent 1.4.0
// core/compaction/utils.ts 的 serializeConversation 与 formatFileOperations（MIT, Copyright (c) 2025 Mario Zechner）。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { CompactionPlan } from './plan.ts'

/** 摘要请求的输出上限。 */
export const SUMMARY_MAX_TOKENS = 20_000
/** 摘要输入中每个工具结果的字符上限。 */
export const SUMMARY_TOOL_RESULT_MAX_CHARS = 2000

export const SUMMARY_SECTIONS = [
  '## Goal',
  '## Constraints & Preferences',
  '## User Messages',
  '## Files and Code',
  '## Errors and Fixes',
  '## Key Decisions',
  '## Progress',
  '## Pending Tasks',
  '## Current Work',
  '## Next Step',
] as const

export const SUMMARY_SYSTEM_PROMPT =
  'You are a context summarization assistant. Read a conversation between a user and an AI coding agent, then produce a structured summary in the exact format requested.\n\nDo NOT continue the conversation. Do NOT answer questions in it. Do NOT call any tools. Output ONLY the structured summary as plain Markdown text.'

const FORMAT = `## Goal
[What the user is trying to accomplish; several items if the session covers several tasks.]

## Constraints & Preferences
- [Constraints, preferences and requirements the user stated, or "(none)".]

## User Messages
- [Every user message in order, summarized; quote security-relevant constraints and explicit prohibitions verbatim. Never attribute assistant text to the user.]

## Files and Code
- [Files read, created or changed, with the relevant functions, signatures and snippets.]

## Errors and Fixes
- [Errors met, how they were fixed, and user feedback on them, or "(none)".]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Progress
### Done
- [x] [Completed work]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Pending Tasks
- [Tasks the user asked for that are not done yet, or "(none)".]

## Current Work
[Precisely what was being worked on right before this summary.]

## Next Step
[The next action. It must agree with the user's most recent explicit request; write "(none)" if that request is complete.]

Keep each section concise. Preserve exact file paths, function names and error messages.`

const INITIAL =
  `The messages in <conversation> are the conversation to summarize. Create a structured context checkpoint that another model will use to continue the work.

Use this EXACT format:

` + FORMAT

const UPDATE =
  `The messages in <conversation> are NEW messages to incorporate into the existing summary in <previous-summary>. RULES:
- PRESERVE all existing information from the previous summary, including every listed user message
- ADD new user messages, progress, decisions, files and errors from the new messages
- UPDATE Progress: move items from In Progress to Done when completed
- UPDATE Pending Tasks, Current Work and Next Step to the current state
- If something is no longer relevant, you may remove it

Use this EXACT format:

` + FORMAT

type Block = { type: string; text?: string; name?: string; arguments?: unknown }

/** 附加的文件内容块（File Reference、指令文件）：摘要只需知道附加了哪个文件，内容可再读取。 */
const ATTACHED = /^<(file_reference|instruction_file) path="([^"]*)"[^>]*>[\s\S]*<\/\1>$/
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

const blockText = (block: Block): string | undefined => {
  if (block.type === 'image') return '[image omitted]'
  if (block.type !== 'text' || typeof block.text !== 'string') return undefined
  const attached = ATTACHED.exec(block.text.trim())
  if (!attached) return block.text
  return `[${attached[1] === 'file_reference' ? 'file reference' : 'instruction file'} attached: ${unescapeAttribute(attached[2]!)}]`
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[])
          .flatMap((block) => {
            const text = blockText(block)
            return text === undefined ? [] : [text]
          })
          .join('\n')
      : ''

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}\n\n[... ${text.length - max} more characters truncated]`)

type Part = { kind: 'user' | 'assistant' | 'tool'; text: string }

function conversationParts(messages: readonly AgentMessage[]): Part[] {
  const parts: Part[] = []
  for (const message of messages) {
    const m = message as { role: string; content?: unknown }
    if (m.role === 'user') {
      const text = textOf(m.content)
      if (text) parts.push({ kind: 'user', text: `[User]: ${text}` })
    } else if (m.role === 'assistant') {
      const blocks = (Array.isArray(m.content) ? m.content : []) as Block[]
      const text = textOf(blocks.filter((block) => block.type === 'text'))
      if (text) parts.push({ kind: 'assistant', text: `[Assistant]: ${text}` })
      const calls = blocks
        .filter((block) => block.type === 'toolCall')
        .map((block) => {
          const args = Object.entries((block.arguments ?? {}) as Record<string, unknown>)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ')
          return `${block.name ?? ''}(${args})`
        })
      if (calls.length > 0) parts.push({ kind: 'assistant', text: `[Assistant tool calls]: ${calls.join('; ')}` })
    } else if (m.role === 'toolResult') {
      const text = textOf(m.content)
      if (text) parts.push({ kind: 'tool', text: `[Tool result]: ${truncate(text, SUMMARY_TOOL_RESULT_MAX_CHARS)}` })
    }
  }
  return parts
}

const SEPARATOR = '\n\n'
const omittedNotice = (count: number) => `[${count} earlier ${count === 1 ? 'message' : 'messages'} omitted to fit the summary request]`

/**
 * 按字符上限保留对话：从最早处省略，先省略工具结果，再省略消息（最近的部分最能决定接下来的工作）；只剩一条仍超出时截掉它的中间。
 * 被省略的条数写在开头。
 */
function fitParts(parts: Part[], maxChars: number): string {
  const kept = [...parts]
  let omitted = 0
  const size = () =>
    kept.reduce((sum, part) => sum + part.text.length + SEPARATOR.length, 0) + (omitted > 0 ? omittedNotice(omitted).length + SEPARATOR.length : 0)
  while (kept.length > 1 && size() > maxChars) {
    const tool = kept.findIndex((part) => part.kind === 'tool')
    kept.splice(tool >= 0 && tool < kept.length - 1 ? tool : 0, 1)
    omitted++
  }
  if (kept.length === 1 && size() > maxChars) {
    const room = Math.max(0, maxChars - (size() - kept[0]!.text.length) - 100)
    const text = kept[0]!.text
    const head = Math.ceil(room / 2)
    kept[0] = {
      ...kept[0]!,
      text: `${text.slice(0, head)}\n\n[... ${text.length - room} characters omitted ...]\n\n${text.slice(text.length - (room - head))}`,
    }
  }
  const body = kept.map((part) => part.text)
  return (omitted > 0 ? [omittedNotice(omitted), ...body] : body).join(SEPARATOR)
}

/** 消息序列化为文本：[User] / [Assistant] / [Assistant tool calls] / [Tool result]（截断），思考省略。 */
export function serializeConversation(messages: readonly AgentMessage[], options: { maxChars?: number } = {}): string {
  const parts = conversationParts(messages)
  return options.maxChars === undefined ? parts.map((part) => part.text).join(SEPARATOR) : fitParts(parts, options.maxChars)
}

/**
 * 摘要请求的系统提示与唯一一条 user 消息；已有摘要时为增量更新，/compact 的指示追加在末尾。maxInputChars 为整个请求文本的上限
 * （运行时按模型窗口减去摘要输出上限给出）；对话部分只用去掉提示与上次摘要之后剩下的预算。
 */
export function summaryRequest(
  plan: Pick<CompactionPlan, 'messages' | 'previousSummary'>,
  instructions?: string,
  options: { maxInputChars?: number } = {},
): { systemPrompt: string; prompt: string } {
  const fixed = SUMMARY_SYSTEM_PROMPT.length + UPDATE.length + (plan.previousSummary?.length ?? 0) + (instructions?.length ?? 0) + 200
  const maxChars = options.maxInputChars === undefined ? undefined : Math.max(1_000, options.maxInputChars - fixed)
  let prompt = `<conversation>\n${serializeConversation(plan.messages, maxChars === undefined ? {} : { maxChars })}\n</conversation>\n\n`
  if (plan.previousSummary !== undefined) prompt += `<previous-summary>\n${plan.previousSummary}\n</previous-summary>\n\n`
  prompt += plan.previousSummary !== undefined ? UPDATE : INITIAL
  const extra = instructions?.trim()
  if (extra) prompt += `\n\nAdditional requirements from the user: ${extra}`
  return { systemPrompt: SUMMARY_SYSTEM_PROMPT, prompt }
}

/** 摘要正文之后列出读过与改过的文件（只列路径，不重读内容）和已调用的 Skill（模型可再调用）。 */
export function formatCompactionSummary(body: string, lists: Pick<CompactionPlan, 'readFiles' | 'modifiedFiles' | 'invokedSkills'>): string {
  const sections: string[] = []
  if (lists.readFiles.length > 0) sections.push(`<read-files>\n${lists.readFiles.join('\n')}\n</read-files>`)
  if (lists.modifiedFiles.length > 0) sections.push(`<modified-files>\n${lists.modifiedFiles.join('\n')}\n</modified-files>`)
  if (lists.invokedSkills.length > 0) sections.push(`<invoked-skills>\n${lists.invokedSkills.join('\n')}\n</invoked-skills>`)
  return sections.length === 0 ? body : `${body}\n\n${sections.join('\n\n')}`
}

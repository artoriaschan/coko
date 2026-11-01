// <memory> system section：用户级与当前 Workspace 的条目，updatedAt 倒序，条目合计不超过 12 000 字符，超出注明数量。
import type { SystemSection } from '../../engine/types.ts'

/** 单条记忆正文的上限（字符）。 */
export const MEMORY_MAX_CHARS = 2000
/** 注入的条目合计上限（字符，含每条的标签）。 */
export const MEMORY_SECTION_BUDGET = 12_000
/** memory_list 带 query 时至多返回的条数。 */
export const MEMORY_SEARCH_LIMIT = 20
/** system section 名（不像整数的稳定名）。 */
export const MEMORY_SECTION_NAME = 'memory'

export type MemoryScope = 'user' | 'workspace'

/** 模型看到的一条记忆：id、作用域与正文；updatedAt 只用于排序。 */
export interface MemoryEntry {
  id: string
  scope: MemoryScope
  content: string
  updatedAt: number
}

/** 正文中的结束标签换成 <\/…>，使条目与 section 保持自定界。 */
const escapeContent = (content: string) => content.replace(/<\/(entry|memory)>/gi, '<\\/$1>')

/** 一条记忆的文本块（section 与 memory_list 共用）。 */
export function formatMemoryEntry(entry: MemoryEntry): string {
  return `<entry id="${entry.id}" scope="${entry.scope}">\n${escapeContent(entry.content)}\n</entry>`
}

export const sortMemories = (entries: readonly MemoryEntry[]): MemoryEntry[] => [...entries].sort((a, b) => b.updatedAt - a.updatedAt)

const HEADER =
  'Saved memories, newest first. User entries apply in every workspace; workspace entries apply to this workspace. ' +
  'Keep them accurate: replace an entry with memory_write (pass its id) or remove it with memory_delete.'

/**
 * 组成 <memory> section：按 updatedAt 倒序逐条加入，加入下一条会使条目合计超过预算时停止（不跳过较新的去放较旧的），
 * 其余注明数量，并提示用 memory_list 的 query 检索。没有条目时 undefined（不注入）。
 */
export function memorySection(entries: readonly MemoryEntry[], budget = MEMORY_SECTION_BUDGET): SystemSection | undefined {
  if (entries.length === 0) return undefined
  const blocks: string[] = []
  let used = 0
  for (const entry of sortMemories(entries)) {
    const block = formatMemoryEntry(entry)
    if (used + block.length + 1 > budget) break
    blocks.push(block)
    used += block.length + 1
  }
  const omitted = entries.length - blocks.length
  const lines = ['<memory>', HEADER, ...blocks]
  if (omitted > 0) lines.push(`${omitted} more ${omitted === 1 ? 'entry' : 'entries'} not shown; use memory_list with a query to search them.`)
  lines.push('</memory>')
  return { name: MEMORY_SECTION_NAME, text: lines.join('\n') }
}

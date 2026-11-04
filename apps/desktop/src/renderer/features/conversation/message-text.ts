import type { SessionEntry } from '@coko/protocol'

/** Original Markdown text blocks, excluding thinking, tool content and footer labels. */
export function assistantMarkdown(entry: SessionEntry): string {
  if (entry.kind !== 'message' || entry.payload.role !== 'assistant' || !Array.isArray(entry.payload.content)) return ''
  return entry.payload.content.flatMap((block) => (block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : [])).join('\n\n')
}

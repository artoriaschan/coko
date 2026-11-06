import { fromMarkdown } from 'mdast-util-from-markdown'

interface PreviewNode {
  type: string
  value?: string
  alt?: string | null
  children?: readonly PreviewNode[]
}
const cache = new Map<string, string>()
const textOf = (node: PreviewNode): string =>
  node.value ??
  node.alt ??
  node.children?.map(textOf).join(['paragraph', 'heading', 'link', 'strong', 'emphasis', 'delete'].includes(node.type) ? '' : ' ') ??
  ''

/** Only the single-line list preview is bounded; inspectors and clipboard retain the original input. */
export function trajectoryPreviewText(source: string): string {
  const input = source.slice(0, 16_384)
  const previous = cache.get(input)
  if (previous !== undefined) return previous
  const text = textOf(fromMarkdown(input)).replace(/\s+/g, ' ').trim()
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(input, text)
  return text
}

// MCP 工具结果 → 模型内容（M3 规格 D6）：isError 为错误结果；文本按 2000 行 / 50KB 截断；图片透传；其他类型注明省略。
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { CallToolResult, ContentBlock } from '@earendil-works/pi-mcp'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '../../tools/truncate.ts'

export interface McpToolDetails {
  server: string
  tool: string
}

type ModelContent = TextContent | ImageContent

function blockToContent(block: ContentBlock): ModelContent {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image':
      return { type: 'image', data: block.data, mimeType: block.mimeType }
    case 'resource': {
      const resource = block.resource
      if ('text' in resource) return { type: 'text', text: resource.text }
      if (resource.mimeType?.startsWith('image/')) return { type: 'image', data: resource.blob, mimeType: resource.mimeType }
      return { type: 'text', text: `[binary resource ${resource.uri} (${resource.mimeType ?? 'unknown type'}) omitted]` }
    }
    case 'resource_link':
      return { type: 'text', text: `[resource link ${block.uri} "${block.title ?? block.name}" omitted]` }
    case 'audio':
      return { type: 'text', text: `[audio ${block.mimeType} omitted]` }
    default:
      return { type: 'text', text: `[unsupported MCP content ${(block as { type: string }).type} omitted]` }
  }
}

/** Convert a tools/call result. Text blocks are joined and truncated as one; images follow the text. */
export function convertMcpResult(
  server: string,
  tool: string,
  result: Pick<CallToolResult, 'content' | 'structuredContent' | 'isError'>,
): AgentToolResult<McpToolDetails> {
  const converted: ModelContent[] =
    result.content.length > 0
      ? result.content.map(blockToContent)
      : result.structuredContent !== undefined
        ? [{ type: 'text', text: JSON.stringify(result.structuredContent, null, 2) }]
        : []
  let combined = converted
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  if (result.isError && combined === '') combined = `MCP tool ${server}/${tool} returned an error`
  const truncation = truncateHead(combined)
  if (truncation.truncated) {
    const limit = truncation.truncatedBy === 'bytes' ? ` (${formatSize(DEFAULT_MAX_BYTES)} limit)` : ''
    combined = `${truncation.content}\n\n[MCP output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines${limit}]`
  }
  const images = converted.filter((block): block is ImageContent => block.type === 'image')
  return {
    content: [...(combined === '' ? [] : [{ type: 'text' as const, text: combined }]), ...images],
    details: { server, tool },
    ...(result.isError ? { isError: true } : {}),
  }
}

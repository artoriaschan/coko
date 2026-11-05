// MCP 资源（docs/subsystems/mcp.md）：Server 声明 resources 能力时，宿主注册 list_mcp_resources、list_mcp_resource_templates、
// read_mcp_resource { server, uri }（权限类 context-read 由宿主注册时给出，effect read）。列表为 JSON：给出 server 时列一页、cursor 接着翻；
// 不给时列出全部 Server 的全部分页（重复 cursor 与 1000 页上限见 pagination.ts）。读取：文本按 2000 行 / 50KB 截断，图片按内容块透传，
// 其他 blob 注明类型与大小。资源订阅不实现。
// Tool names, parameters and listing shape follow pi coding-agent 1.4.0 extensions/mcp/resources.ts (MIT, Copyright (c) 2025 Mario Zechner).
// See THIRD_PARTY_NOTICES.md.
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { McpRequestOptions, ServerCapabilities } from '@earendil-works/pi-mcp'
import { Type, type Static } from 'typebox'
import type { CokoTool, CokoToolResult } from '../../tools/types.ts'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '../../tools/truncate.ts'
import { invalidResult, isRecord, listAllPages, listPage, type McpRequester } from './pagination.ts'
import type { McpToolDetails } from './results.ts'

export const LIST_MCP_RESOURCES_TOOL = 'list_mcp_resources'
export const LIST_MCP_RESOURCE_TEMPLATES_TOOL = 'list_mcp_resource_templates'
export const READ_MCP_RESOURCE_TOOL = 'read_mcp_resource'
export const MCP_RESOURCE_TOOL_NAMES: readonly string[] = [LIST_MCP_RESOURCES_TOOL, LIST_MCP_RESOURCE_TEMPLATES_TOOL, READ_MCP_RESOURCE_TOOL]

/** A connected server; only those whose capabilities declare resources are reached. */
export interface McpResourceServer {
  connection: McpRequester & { readonly capabilities: ServerCapabilities | undefined }
  /** Per-request timeout (the server's `timeout`). */
  timeoutMs?: number
}

const ListParameters = Type.Object(
  {
    server: Type.Optional(Type.String({ description: 'MCP server name. Omit to list every server with resources.' })),
    cursor: Type.Optional(Type.String({ description: 'Opaque cursor from a previous call with the same server; omit for the first page.' })),
  },
  { additionalProperties: false },
)
const ReadParameters = Type.Object(
  {
    server: Type.String({ description: "MCP server name exactly as configured; the 'server' field returned by list_mcp_resources." }),
    uri: Type.String({ description: 'Resource URI to read, as returned by list_mcp_resources (or built from a resource template).' }),
  },
  { additionalProperties: false },
)

type Item = Record<string, unknown>

/** A listed item without `_meta` and icons, tagged with its server. */
function tagged(server: string, item: Item): Item {
  const { _meta: _ignored, icons: _icons, ...rest } = item
  return { server, ...rest }
}

// `name` is required by the spec, but some servers omit it; the URI stands in (as pi-mcp does).
const toResource = (item: Item): Item | undefined =>
  typeof item.uri === 'string' && (item.name === undefined || typeof item.name === 'string') ? { ...item, name: item.name ?? item.uri } : undefined
const toTemplate = (item: Item): Item | undefined =>
  typeof item.uriTemplate === 'string' && (item.name === undefined || typeof item.name === 'string')
    ? { ...item, name: item.name ?? item.uriTemplate }
    : undefined

const optionalArg = (value: string | undefined) => (value === undefined || value.trim() === '' ? undefined : value.trim())

function truncated(text: string): string {
  const truncation = truncateHead(text)
  if (!truncation.truncated) return text
  if (truncation.firstLineExceedsLimit) {
    // One line longer than the limit: keep its first bytes (a cut multi-byte character is dropped).
    const head = Buffer.from(text, 'utf8')
      .subarray(0, DEFAULT_MAX_BYTES)
      .toString('utf8')
      .replace(/\uFFFD$/, '')
    return `${head}\n\n[Resource truncated: showing first ${formatSize(DEFAULT_MAX_BYTES)} of ${formatSize(truncation.totalBytes)} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`
  }
  const limit = truncation.truncatedBy === 'bytes' ? ` (${formatSize(DEFAULT_MAX_BYTES)} limit)` : ''
  return `${truncation.content}\n\n[Resource truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines${limit}]`
}

function jsonResult(tool: string, server: string | undefined, payload: Item): CokoToolResult<McpToolDetails> {
  const original = JSON.stringify(payload)
  const text = truncated(original)
  return { content: [{ type: 'text', text }], details: { server: server ?? '', tool }, ...(text !== original ? { untruncatedText: original } : {}) }
}

type ReadContents = { uri: string; mimeType?: string; text?: string; blob?: string }

function validateRead(server: string, value: unknown): ReadContents[] {
  const contents = isRecord(value) ? value.contents : undefined
  const fail = (detail: string) => new Error(invalidResult(server, 'resources/read', detail).message)
  if (!Array.isArray(contents)) throw fail('"contents" is not an array')
  for (const item of contents) {
    if (!isRecord(item) || typeof item.uri !== 'string' || (typeof item.text !== 'string' && typeof item.blob !== 'string'))
      throw fail('every content needs a uri and text or blob')
    if (item.mimeType !== undefined && typeof item.mimeType !== 'string') throw fail('mimeType is not a string')
  }
  return contents as ReadContents[]
}

/** read result → model content: texts joined (labeled by URI when there are several) and truncated as one; images follow. */
function readContent(uri: string, contents: readonly ReadContents[]): { content: (TextContent | ImageContent)[]; untruncatedText?: string } {
  const texts: string[] = []
  const images: ImageContent[] = []
  for (const item of contents) {
    const label = contents.length > 1 ? `${item.uri}:\n` : ''
    if (typeof item.text === 'string') texts.push(`${label}${item.text}`)
    else if (item.mimeType?.startsWith('image/')) {
      if (label) texts.push(label.trimEnd())
      images.push({ type: 'image', data: item.blob!, mimeType: item.mimeType })
    } else
      texts.push(`${label}[binary resource ${item.uri} (${item.mimeType ?? 'unknown type'}, ${formatSize(Buffer.byteLength(item.blob!, 'base64'))}) omitted]`)
  }
  if (texts.length === 0 && images.length === 0) texts.push(`Resource ${uri} is empty.`)
  const original = texts.join('\n\n')
  const text = truncated(original)
  return { content: [...(texts.length === 0 ? [] : [{ type: 'text' as const, text }]), ...images], ...(text !== original ? { untruncatedText: original } : {}) }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The three resource tools. `servers` gives the connected servers at call time; those without the resources capability are skipped. */
export function createMcpResourceTools(options: { servers: () => readonly McpResourceServer[] }): CokoTool[] {
  const withResources = () =>
    options
      .servers()
      .filter((s) => s.connection.capabilities?.resources)
      .sort((a, b) => a.connection.name.localeCompare(b.connection.name))
  const find = (name: string): McpResourceServer => {
    const servers = withResources()
    const found = servers.find((s) => s.connection.name === name)
    if (found) return found
    const available = servers.map((s) => s.connection.name).join(', ')
    throw new Error(`MCP server "${name}" has no resources${available ? `. Servers with resources: ${available}` : ''}`)
  }
  const requestOptions = (server: McpResourceServer, signal: AbortSignal | undefined): McpRequestOptions => ({
    ...(signal ? { signal } : {}),
    ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
  })

  const lister = (
    tool: string,
    method: string,
    key: string,
    toItem: (item: Item) => Item | undefined,
    description: string,
  ): CokoTool<typeof ListParameters> => ({
    name: tool,
    label: tool,
    description,
    parameters: ListParameters,
    effect: 'read',
    async execute(_toolCallId, params: Static<typeof ListParameters>, signal) {
      const serverName = optionalArg(params?.server)
      const cursor = optionalArg(params?.cursor)
      if (serverName) {
        const server = find(serverName)
        const page = await listPage(server.connection, method, key, toItem, cursor, requestOptions(server, signal))
        const name = server.connection.name
        return jsonResult(tool, name, {
          server: name,
          [key]: page.items.map((item) => tagged(name, item)),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          ...(page.diagnostics.length > 0 ? { errors: page.diagnostics.map((d) => ({ server: name, error: d.message })) } : {}),
        })
      }
      if (cursor) throw new Error('cursor can only be used when a server is specified')
      const servers = withResources()
      const settled = await Promise.allSettled(servers.map((s) => listAllPages(s.connection, method, key, toItem, requestOptions(s, signal))))
      const items: Item[] = []
      const errors: { server: string; error: string }[] = []
      settled.forEach((result, index) => {
        const name = servers[index]!.connection.name
        if (result.status === 'rejected') errors.push({ server: name, error: message(result.reason) })
        else {
          items.push(...result.value.items.map((item) => tagged(name, item)))
          errors.push(...result.value.diagnostics.map((d) => ({ server: name, error: d.message })))
        }
      })
      return jsonResult(tool, undefined, { [key]: items, ...(errors.length > 0 ? { errors } : {}) })
    },
  })

  const read: CokoTool<typeof ReadParameters> = {
    name: READ_MCP_RESOURCE_TOOL,
    label: READ_MCP_RESOURCE_TOOL,
    description: 'Read a specific resource from an MCP server given the server name and resource URI.',
    parameters: ReadParameters,
    effect: 'read',
    permissionSubject: (args) => args.uri,
    async execute(_toolCallId, params: Static<typeof ReadParameters>, signal) {
      const serverName = optionalArg(params?.server)
      const uri = optionalArg(params?.uri)
      if (!serverName) throw new Error('server must be provided')
      if (!uri) throw new Error('uri must be provided')
      const server = find(serverName)
      const name = server.connection.name
      const contents = validateRead(name, await server.connection.request<unknown>('resources/read', { uri }, requestOptions(server, signal)))
      return { ...readContent(uri, contents), details: { server: name, tool: READ_MCP_RESOURCE_TOOL } }
    },
  }

  return [
    lister(
      LIST_MCP_RESOURCES_TOOL,
      'resources/list',
      'resources',
      toResource,
      'Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.',
    ) as CokoTool,
    lister(
      LIST_MCP_RESOURCE_TEMPLATES_TOOL,
      'resources/templates/list',
      'resourceTemplates',
      toTemplate,
      'Lists resource templates provided by MCP servers. Parameterized resource templates (RFC 6570 URI templates) allow servers to share data that takes parameters. Fill a template and read it with read_mcp_resource.',
    ) as CokoTool,
    read as CokoTool,
  ]
}

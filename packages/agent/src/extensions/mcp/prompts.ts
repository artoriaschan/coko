// MCP 提示模板（M3 规格 D9）：pi-mcp 没有 prompts 方法，经 McpConnection.request("prompts/list" | "prompts/get") 封装。
// 能力检查（Server 未声明 prompts 时不请求）；prompts/list 按 cursor 分页（pagination.ts）；结果按 schema 校验，不合格的记诊断，
// prompts/get 不合格时以 McpResultError 拒绝（宿主转为提交失败，不进入 Run）；消息转文本（文本拼接、嵌入的文本资源内联、
// 图片、音频与二进制注明省略）。
import type { McpRequestOptions, ServerCapabilities } from '@earendil-works/pi-mcp'
import type { ResourceDiagnostic } from '../../instructions/shared/diagnostics.ts'
import { formatSize } from '../../tools/truncate.ts'
import { parseCommandArgs } from '../../instructions/commands/args.ts'
import { invalidResult, isRecord, listAllPages, type Listed, type McpRequester } from './pagination.ts'

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgument[]
}

export type McpPromptContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } | { uri: string; mimeType?: string; blob: string } }
  | { type: 'resource_link'; uri: string; name: string; title?: string; mimeType?: string }

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: McpPromptContent
}

export interface McpPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

/** A result that does not match the MCP schema. */
export class McpResultError extends Error {
  override readonly name = 'McpResultError'
  readonly diagnostic: ResourceDiagnostic
  constructor(diagnostic: ResourceDiagnostic) {
    super(diagnostic.message)
    this.diagnostic = diagnostic
  }
}

interface PromptConnection extends McpRequester {
  readonly capabilities: ServerCapabilities | undefined
}

const optionalString = (value: unknown) => value === undefined || typeof value === 'string'

function toArgument(value: unknown): McpPromptArgument | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '' || !optionalString(value.description)) return undefined
  if (value.required !== undefined && typeof value.required !== 'boolean') return undefined
  return {
    name: value.name,
    ...(value.description === undefined ? {} : { description: value.description as string }),
    ...(value.required === undefined ? {} : { required: value.required }),
  }
}

function toPrompt(item: Record<string, unknown>): McpPrompt | undefined {
  if (typeof item.name !== 'string' || item.name === '' || !optionalString(item.title) || !optionalString(item.description)) return undefined
  let args: McpPromptArgument[] | undefined
  if (item.arguments !== undefined && item.arguments !== null) {
    if (!Array.isArray(item.arguments)) return undefined
    args = []
    for (const raw of item.arguments) {
      const argument = toArgument(raw)
      if (!argument) return undefined
      args.push(argument)
    }
  }
  return {
    name: item.name,
    ...(item.title === undefined ? {} : { title: item.title as string }),
    ...(item.description === undefined ? {} : { description: item.description as string }),
    ...(args && args.length > 0 ? { arguments: args } : {}),
  }
}

/** Every prompt of the server (prompts/list through all pages); none when the server does not declare prompts. */
export async function listMcpPrompts(connection: PromptConnection, options: McpRequestOptions = {}): Promise<Listed<McpPrompt>> {
  if (!connection.capabilities?.prompts) return { items: [], diagnostics: [] }
  return listAllPages(connection, 'prompts/list', 'prompts', toPrompt, options)
}

/**
 * Positional arguments (quotes group words, as for prompt templates) mapped to the declared arguments in order; words beyond
 * the last declared argument join it. `missing` lists required arguments without a value.
 */
export function mapPromptArguments(prompt: McpPrompt, args: string): { arguments: Record<string, string>; missing: string[] } {
  const declared = prompt.arguments ?? []
  const words = parseCommandArgs(args)
  const values: Record<string, string> = {}
  declared.forEach((argument, index) => {
    const value = index === declared.length - 1 ? words.slice(index).join(' ') : words[index]
    if (value !== undefined && value !== '') values[argument.name] = value
  })
  return { arguments: values, missing: declared.filter((a) => a.required && values[a.name] === undefined).map((a) => a.name) }
}

function validContent(value: unknown): value is McpPromptContent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string'
    case 'image':
    case 'audio':
      return typeof value.data === 'string' && typeof value.mimeType === 'string'
    case 'resource': {
      const resource = value.resource
      return (
        isRecord(resource) &&
        typeof resource.uri === 'string' &&
        optionalString(resource.mimeType) &&
        (typeof resource.text === 'string' || typeof resource.blob === 'string')
      )
    }
    case 'resource_link':
      return typeof value.uri === 'string' && typeof value.name === 'string'
    default:
      return false
  }
}

function validatePromptResult(server: string, value: unknown): McpPromptResult {
  const fail = (detail: string) => new McpResultError(invalidResult(server, 'prompts/get', detail))
  if (!isRecord(value) || !Array.isArray(value.messages)) throw fail('"messages" is not an array')
  if (!optionalString(value.description)) throw fail('"description" is not a string')
  value.messages.forEach((message, index) => {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')) throw fail(`message ${index} has no valid role`)
    if (!validContent(message.content)) throw fail(`message ${index} has invalid content`)
  })
  return value as unknown as McpPromptResult
}

/** prompts/get; rejects with McpResultError when the result does not match the schema. */
export async function getMcpPrompt(
  connection: McpRequester,
  name: string,
  args: Record<string, string>,
  options: McpRequestOptions = {},
): Promise<McpPromptResult> {
  return validatePromptResult(connection.name, await connection.request<unknown>('prompts/get', { name, arguments: args }, options))
}

const decodedSize = (base64: string) => Buffer.byteLength(base64, 'base64')

function contentToText(content: McpPromptContent): string {
  switch (content.type) {
    case 'text':
      return content.text
    case 'image':
      return `[image ${content.mimeType} omitted]`
    case 'audio':
      return `[audio ${content.mimeType} omitted]`
    case 'resource': {
      const resource = content.resource
      if ('text' in resource) return `<resource uri="${resource.uri}">\n${resource.text}\n</resource>`
      return `[binary resource ${resource.uri} (${resource.mimeType ?? 'unknown type'}, ${formatSize(decodedSize(resource.blob))}) omitted]`
    }
    case 'resource_link':
      return `[resource link ${content.uri} "${content.title ?? content.name}"]`
  }
}

/** The messages as one text: every message's content in order, separated by blank lines (roles are not kept). */
export function promptMessagesToText(messages: readonly McpPromptMessage[]): string {
  return messages
    .map((message) => contentToText(message.content))
    .filter((text) => text !== '')
    .join('\n\n')
}

// MCP 工具 → CokoTool（docs/subsystems/mcp.md）：名字 mcp__<server>__<tool>；描述与 inputSchema 原样交给模型（缺 type / properties 时补上，
// 参数按 JSON Schema 校验，不支持的关键字放行，与 pi coding-agent 1.4.0 相同）；effect 一律 side-effect（Server 的 readOnly 提示不可信）；
// 权限类 external 由宿主注册时给出；disabledTools 不注册；_meta.idempotencyKey 为 <sessionId>:<toolCallId>。
// Adapted in part from pi coding-agent 1.4.0 extensions/mcp/tools.ts (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.
import type { TSchema } from 'typebox'
import { Compile } from 'typebox/compile'
import type { Tool as McpTool } from '@earendil-works/pi-mcp'
import type { CokoTool } from '../../tools/types.ts'
import { DEFAULT_MCP_TIMEOUT_SECONDS, type McpServerConfig } from './config.ts'
import type { McpConnection } from './connection.ts'
import { createMcpToolName } from './naming.ts'
import { convertMcpResult, type McpToolDetails } from './results.ts'

/**
 * Tool input schemas must be objects; MCP servers may omit `type`, and some providers reject object schemas without
 * `properties`. A schema the validator cannot compile (for example a broken `$ref`) is replaced by an open object, so
 * the tool stays callable and the server validates the arguments itself.
 */
export function toParameters(schema: Record<string, unknown>): TSchema {
  const parameters = { ...schema, type: schema.type ?? 'object', ...(schema.properties === undefined ? { properties: {} } : {}) }
  try {
    Compile(parameters as unknown as TSchema)
    return parameters as unknown as TSchema
  } catch {
    return { type: 'object', properties: {}, ...(typeof schema.description === 'string' ? { description: schema.description } : {}) } as unknown as TSchema
  }
}

export interface CreateMcpToolsOptions {
  config: McpServerConfig
}

/** Coko tools for the connection's current tool list (call it at the start of each Run). */
export function createMcpTools(connection: McpConnection, options: CreateMcpToolsOptions): CokoTool<TSchema, McpToolDetails>[] {
  const disabled = new Set(options.config.disabledTools ?? [])
  const timeoutMs = (options.config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000
  const taken = new Set<string>()
  const result: CokoTool<TSchema, McpToolDetails>[] = []
  for (const tool of connection.tools) {
    if (disabled.has(tool.name)) continue
    const name = createMcpToolName(connection.name, tool.name, (candidate) => taken.has(candidate))
    taken.add(name)
    result.push(adapt(connection, tool, name, timeoutMs))
  }
  return result
}

function adapt(connection: McpConnection, tool: McpTool, name: string, timeoutMs: number): CokoTool<TSchema, McpToolDetails> {
  const server = connection.name
  return {
    name,
    label: `${server}/${tool.name}`,
    description: tool.description?.trim() || tool.title || `MCP tool ${tool.name} from server ${server}`,
    parameters: toParameters(tool.inputSchema),
    effect: 'side-effect',
    // The request timeout (reset by progress notifications) is the MCP client's; the unified wall-clock limit does not apply.
    timeoutMs: 0,
    async execute(_toolCallId, params, signal, onUpdate, context) {
      const result = await connection.callTool(tool.name, (params ?? {}) as Record<string, unknown>, {
        ...(signal ? { signal } : {}),
        timeoutMs,
        ...(context ? { meta: { idempotencyKey: context.idempotencyKey } } : {}),
        onProgress: (progress) => {
          const total = progress.total === undefined ? '' : `/${progress.total}`
          onUpdate?.({ content: [{ type: 'text', text: progress.message ?? `Progress ${progress.progress}${total}` }], details: { server, tool: tool.name } })
        },
      })
      return convertMcpResult(server, tool.name, result)
    },
  }
}

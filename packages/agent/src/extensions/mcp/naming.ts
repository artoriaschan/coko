// Adapted from pi coding-agent 1.4.0 extensions/mcp/tools.ts (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.
import { createHash } from 'node:crypto'
import { MCP_TOOL_PREFIX } from '../../policy/decide.ts'

/** Provider tool names are limited to 64 characters of `[A-Za-z0-9_-]`. */
export const MAX_MCP_TOOL_NAME_LENGTH = 64
/** Longest server name: keeps `mcp__<server>__` and room for a hash suffix within the tool name limit. */
export const MAX_MCP_SERVER_NAME_LENGTH = 40

/** `mcp__<server>`: the rule name that matches every tool of the server. */
export const mcpNamespace = (server: string) => `${MCP_TOOL_PREFIX}${server}`

/**
 * `mcp__<server>__<tool>` with every character outside `[A-Za-z0-9_-]` replaced by `_`. Longer than 64 characters, or
 * already taken by another tool of the server (two names that sanitize alike), the tool part is cut and an 8-character
 * hash of server and tool is appended; the `mcp__<server>__` prefix is kept so `mcp__<server>` rules still match.
 */
export function createMcpToolName(server: string, tool: string, isTaken: (name: string) => boolean = () => false): string {
  const name = `${mcpNamespace(server)}__${tool}`.replace(/[^A-Za-z0-9_-]/g, '_')
  if (name.length <= MAX_MCP_TOOL_NAME_LENGTH && !isTaken(name)) return name
  const hash = createHash('sha256').update(`${server}\0${tool}`).digest('hex').slice(0, 8)
  return `${name.slice(0, MAX_MCP_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`
}

/** Server names that differ only in `-` and `_` are confusing in rules and logs; the later one is rejected. */
export function serverNamesConflict(a: string, b: string): boolean {
  return a !== b && a.replace(/-/g, '_') === b.replace(/-/g, '_')
}

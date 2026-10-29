// 分页列表（M3 规格 D8、D9）：按 nextCursor 取全部分页，最多 1000 页；重复的 cursor 停止翻页。不合格的页停止、不合格的项跳过，
// 都只记诊断（保留已取得的项），不抛到 Run；请求本身失败（未连接、超时、Server 错误）时 reject。
// Pagination limits follow pi-mcp 1.4.0 client.ts listAll (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.
import type { McpRequestOptions } from '@earendil-works/pi-mcp'
import { diagnostic, type ResourceDiagnostic } from '../../instructions/shared/diagnostics.ts'

export const MCP_MAX_LIST_PAGES = 1_000

/** What the list helpers need from a connection (McpConnection satisfies it). */
export interface McpRequester {
  readonly name: string
  request<T = unknown>(method: string, params?: Record<string, unknown>, options?: McpRequestOptions): Promise<T>
}

export interface Listed<T> {
  items: T[]
  diagnostics: ResourceDiagnostic[]
}

export interface Page<T> extends Listed<T> {
  nextCursor?: string
  /** The page itself did not match the schema (no items under the key, or a bad cursor). */
  invalid?: boolean
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const invalidResult = (server: string, method: string, detail: string) =>
  diagnostic('mcp', 'invalid-result', `MCP server "${server}" returned an invalid ${method} result: ${detail}`)

/** One page of `method`: items under `key` converted by `toItem` (undefined: the item is invalid and skipped). */
export async function listPage<T>(
  connection: McpRequester,
  method: string,
  key: string,
  toItem: (item: Record<string, unknown>) => T | undefined,
  cursor: string | undefined,
  options: McpRequestOptions = {},
): Promise<Page<T>> {
  const value = await connection.request<unknown>(method, cursor === undefined ? undefined : { cursor }, options)
  const raw = isRecord(value) ? value[key] : undefined
  if (!Array.isArray(raw)) return { items: [], diagnostics: [invalidResult(connection.name, method, `"${key}" is not an array`)], invalid: true }
  const items: T[] = []
  const diagnostics: ResourceDiagnostic[] = []
  for (const entry of raw) {
    const item = isRecord(entry) ? toItem(entry) : undefined
    if (item === undefined) diagnostics.push(invalidResult(connection.name, method, `entry ${JSON.stringify(entry)?.slice(0, 120)} skipped`))
    else items.push(item)
  }
  // Some servers end pagination with null or "" instead of omitting the cursor.
  const next = (value as Record<string, unknown>).nextCursor
  if (next === undefined || next === null || next === '') return { items, diagnostics }
  if (typeof next !== 'string')
    return { items, diagnostics: [...diagnostics, invalidResult(connection.name, method, 'nextCursor is not a string')], invalid: true }
  return { items, diagnostics, nextCursor: next }
}

/** Every page of `method`, following nextCursor. */
export async function listAllPages<T>(
  connection: McpRequester,
  method: string,
  key: string,
  toItem: (item: Record<string, unknown>) => T | undefined,
  options: McpRequestOptions = {},
): Promise<Listed<T>> {
  const items: T[] = []
  const diagnostics: ResourceDiagnostic[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MCP_MAX_LIST_PAGES; page++) {
    const result = await listPage(connection, method, key, toItem, cursor, options)
    items.push(...result.items)
    diagnostics.push(...result.diagnostics)
    if (result.invalid || result.nextCursor === undefined) return { items, diagnostics }
    if (seen.has(result.nextCursor)) {
      diagnostics.push(
        diagnostic(
          'mcp',
          'duplicate-cursor',
          `MCP server "${connection.name}" repeated ${method} cursor ${JSON.stringify(result.nextCursor)}; listing stopped`,
        ),
      )
      return { items, diagnostics }
    }
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
  diagnostics.push(diagnostic('mcp', 'page-limit', `MCP server "${connection.name}" ${method} exceeded ${MCP_MAX_LIST_PAGES} pages; listing stopped`))
  return { items, diagnostics }
}

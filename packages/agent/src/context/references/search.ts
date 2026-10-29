// @ 菜单的文件候选（票 06，GET /api/workspaces/:id/files）：遍历 Workspace（与内置 find / grep 相同的 walkTree：遵守 .gitignore /
// .ignore / .rgignore，不含 .git，不跟随符号链接），按查询模糊匹配，目录以 / 结尾。
import { walkTree } from '../../tools/builtin/walk.ts'

export const FILE_SEARCH_LIMIT = 50
/** 遍历的条目上限：很大的仓库只在前这么多项中查找，使每次按键的响应有界。 */
const FILE_SEARCH_SCAN_LIMIT = 20_000

export interface WorkspaceFileEntry {
  /** 相对 Workspace，/ 分隔；目录以 / 结尾。 */
  path: string
  kind: 'file' | 'directory'
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (const ch of text) if (ch === query[i] && ++i === query.length) return true
  return query.length === 0
}

/** 匹配档位（越小越靠前）：路径前缀、文件名前缀、包含、子序列；不匹配时 undefined。 */
function tier(path: string, query: string): number | undefined {
  if (query === '') return 0
  const lower = path.toLowerCase()
  if (lower.startsWith(query)) return 0
  const name = lower.replace(/\/$/, '').split('/').at(-1)!
  if (name.startsWith(query)) return 1
  if (lower.includes(query)) return 2
  return isSubsequence(query, lower) ? 3 : undefined
}

const depth = (path: string) => path.replace(/\/$/, '').split('/').length - 1

/** 查询（不区分大小写）的候选：按档位、深度、路径排序，最多 limit 条（不超过 50）。以 / 结尾的查询不含该目录本身。 */
export async function searchWorkspaceFiles(cwd: string, query: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<WorkspaceFileEntry[]> {
  const limit = Math.max(0, Math.min(options.limit ?? FILE_SEARCH_LIMIT, FILE_SEARCH_LIMIT))
  const q = query.toLowerCase()
  const matches: { entry: WorkspaceFileEntry; tier: number; depth: number; key: string }[] = []
  let scanned = 0
  for await (const entry of walkTree(cwd, options.signal ? { signal: options.signal } : {})) {
    if (++scanned > FILE_SEARCH_SCAN_LIMIT) break
    const path = entry.isDirectory ? `${entry.relativePath}/` : entry.relativePath
    if (q !== '' && path.toLowerCase() === q) continue
    const t = tier(path, q)
    if (t === undefined) continue
    matches.push({ entry: { path, kind: entry.isDirectory ? 'directory' : 'file' }, tier: t, depth: depth(path), key: path.toLowerCase() })
  }
  matches.sort((a, b) => a.tier - b.tier || a.depth - b.depth || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return matches.slice(0, limit).map((m) => m.entry)
}

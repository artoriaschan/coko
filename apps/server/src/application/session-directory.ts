import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { Workspace, WorktreeRecord } from '@coko/session'

/** Describe the fixed directory without admitting a Run; removed/busy worktrees remain readable. */
export async function sessionDirectory(workspace: Workspace, worktree?: WorktreeRecord): Promise<string> {
  if (!worktree) return workspace.path
  const real = await realpath(workspace.path).catch(() => workspace.path)
  const rel = relative(worktree.repoRoot, real)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return worktree.path
  return join(worktree.path, rel)
}

/** 首次发送的本地日期；目录建立后保存实际路径，不再根据时钟重算。 */
export function sessionDateDirectory(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 同日短名已占用时使用完整身份；调用方负责检查磁盘与持久化幂等目录。 */
export function sessionDirectoryName(sessionId: string, shortNameExists = false): string {
  return shortNameExists ? sessionId : `chat-${sessionId.slice(0, 12)}`
}

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

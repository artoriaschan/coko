// Stable host and Workspace facts; date is delivered separately as a State Update.
import { readFile, stat } from 'node:fs/promises'
import { platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_COMMAND_SHELL } from '@coko/agent'
import type { ContextContribution } from './types.ts'

/** Detect a repository and linked worktree without running git status or inspecting mutable working files. */
async function repository(cwd: string): Promise<{ git: boolean; worktree: boolean }> {
  let dir = resolve(cwd)
  while (true) {
    const dotGit = join(dir, '.git')
    const info = await stat(dotGit).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
      throw error
    })
    if (info?.isDirectory()) return { git: true, worktree: false }
    if (info?.isFile()) {
      const pointer = /^gitdir:\s*(.+)\s*$/m.exec(await readFile(dotGit, 'utf8'))?.[1]
      // Submodules also have a .git file; only linked worktrees have commondir.
      const common = pointer ? await stat(join(resolve(dir, pointer.trim()), 'commondir')).catch(() => undefined) : undefined
      return { git: pointer !== undefined, worktree: common?.isFile() ?? false }
    }
    const parent = dirname(dir)
    if (parent === dir) return { git: false, worktree: false }
    dir = parent
  }
}

export function environmentContribution(): ContextContribution {
  return {
    name: 'environment',
    async systemSections(scope) {
      const repo = await repository(scope.cwd)
      const text = [
        '<environment>',
        `Workspace: ${scope.cwd}`,
        `Additional folders: ${JSON.stringify(scope.additionalFolders ?? [])}`,
        `Git repository: ${repo.git}`,
        `Worktree: ${Boolean(scope.worktreeId) || repo.worktree}`,
        `Platform: ${platform()}`,
        `Shell: ${DEFAULT_COMMAND_SHELL}`,
        `OS version: ${release()}`,
        `Model: ${scope.model ? `${scope.model.providerId}/${scope.model.modelId}` : 'unavailable'}`,
        `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        '</environment>',
      ].join('\n')
      return [{ name: 'environment', text }]
    },
  }
}

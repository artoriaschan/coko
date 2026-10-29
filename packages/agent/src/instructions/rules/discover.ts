// 指令文件的发现：仓库根（Workspace 向上最近的含 .git 的祖先，不越过家目录）、目录链与每个目录的指令文件。
import { dirname, join, resolve } from 'node:path'
import { pathContains } from '../../policy/rules.ts'
import type { ReadOnlyFiles } from '../shared/index.ts'

/**
 * Workspace 向上最近的含 .git（目录或 worktree 的文件）的祖先；遇到家目录或其祖先时停止（家目录本身不算），
 * 不在仓库内时 undefined。
 */
export async function findRepoRoot(files: ReadOnlyFiles, cwd: string, homeDir: string): Promise<string | undefined> {
  const home = resolve(homeDir)
  let dir = resolve(cwd)
  for (;;) {
    if (pathContains(dir, home)) return undefined
    const git = await files.stat(join(dir, '.git')).catch(() => undefined)
    if (git) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** from 到 to（含两端）的目录，远到近；to 须在 from 之内。 */
export function directoryChain(from: string, to: string): string[] {
  const chain = [to]
  let dir = to
  while (dir !== from) {
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
    chain.unshift(dir)
  }
  return chain
}

const NAMES = ['agents.md', 'claude.md']

/** 目录中的指令文件：AGENTS.md，不存在时 CLAUDE.md（文件名大小写不敏感）；都没有时 undefined。 */
export async function pickInstructionFile(files: ReadOnlyFiles, dir: string): Promise<string | undefined> {
  const entries = await files.list(dir)
  for (const name of NAMES) {
    const found = entries.find((entry) => entry.kind === 'file' && entry.name.toLowerCase() === name)
    if (found) return join(dir, found.name)
  }
  return undefined
}

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { throwIfAborted } from '../paths.ts'

/** Ignore files read in every directory, lowest precedence first (same order as ripgrep). */
const IGNORE_FILES = ['.gitignore', '.ignore', '.rgignore']

interface IgnoreLayer {
  base: string
  matcher: Ignore
}

export interface WalkEntry {
  absolutePath: string
  /** Path relative to the walk root, with `/` separators. */
  relativePath: string
  isDirectory: boolean
}

export interface WalkOptions {
  signal?: AbortSignal
  /** Return false to skip a directory and everything below it. */
  descend?: (entry: WalkEntry) => boolean
}

const toPosix = (path: string) => (sep === '/' ? path : path.split(sep).join('/'))

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    // Missing or unreadable file.
    return undefined
  }
}

const layerOf = (base: string, patterns: string[]): IgnoreLayer | undefined =>
  patterns.length === 0 ? undefined : { base, matcher: ignore().add(patterns.join('\n')) }

async function loadLayer(dir: string): Promise<IgnoreLayer | undefined> {
  const patterns: string[] = []
  for (const name of IGNORE_FILES) {
    const text = await readText(join(dir, name))
    if (text !== undefined) patterns.push(text)
  }
  return layerOf(dir, patterns)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The git directory holding `info/exclude` for a repository whose working tree is `dir`: `.git` itself, or for a
 * worktree / submodule (`.git` is a file with `gitdir: <path>`) that directory's `commondir` when present.
 */
async function gitCommonDir(dir: string): Promise<string | undefined> {
  const dotGit = join(dir, '.git')
  let info
  try {
    info = await stat(dotGit)
  } catch {
    return undefined
  }
  if (info.isDirectory()) return dotGit
  const pointer = (await readText(dotGit))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  if (!pointer) return undefined
  const gitDir = resolve(dir, pointer)
  const common = (await readText(join(gitDir, 'commondir')))?.trim()
  return common ? resolve(gitDir, common) : gitDir
}

/** `.git/info/exclude` of the repository rooted at `dir`, relative to `dir`. */
async function excludeLayer(dir: string): Promise<IgnoreLayer | undefined> {
  const gitDir = await gitCommonDir(dir)
  const text = gitDir ? await readText(join(gitDir, 'info', 'exclude')) : undefined
  return text === undefined ? undefined : layerOf(dir, [text])
}

const expandHome = (path: string, home: string) => (path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path)

/**
 * The global excludes file, as ripgrep resolves it: `core.excludesFile` from `~/.gitconfig`, else from
 * `$XDG_CONFIG_HOME/git/config` (`~/.config/git/config` when unset); without that setting
 * `$XDG_CONFIG_HOME/git/ignore` (`~/.config/git/ignore`). Includes are not followed; `~` is expanded.
 */
export async function globalExcludesFile(): Promise<string | undefined> {
  const home = homedir()
  if (!home) return undefined
  const xdg = process.env.XDG_CONFIG_HOME ? process.env.XDG_CONFIG_HOME : join(home, '.config')
  for (const config of [join(home, '.gitconfig'), join(xdg, 'git', 'config')]) {
    const text = await readText(config)
    const value = text?.match(/^\s*excludesfile\s*=\s*("?)(.+?)\1\s*$/im)?.[2]
    if (value) {
      const path = expandHome(value, home)
      return isAbsolute(path) ? path : join(home, path)
    }
  }
  return join(xdg, 'git', 'ignore')
}

/** The global excludes, matched relative to the walk root (as ripgrep does). */
async function globalLayer(root: string): Promise<IgnoreLayer | undefined> {
  const file = await globalExcludesFile()
  const text = file ? await readText(file) : undefined
  return text === undefined ? undefined : layerOf(root, [text])
}

/**
 * Ignore files of ancestors of `root`, outermost first, stopping at the enclosing git repository root, and the
 * `info/exclude` of that repository (or of `root` itself when it is a repository root).
 */
async function ancestorLayers(root: string): Promise<{ layers: IgnoreLayer[]; exclude: IgnoreLayer | undefined }> {
  const layers: IgnoreLayer[] = []
  let current = root
  if (await exists(join(current, '.git'))) return { layers, exclude: await excludeLayer(current) }
  while (true) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    const layer = await loadLayer(current)
    if (layer) layers.unshift(layer)
    if (await exists(join(current, '.git'))) return { layers, exclude: await excludeLayer(current) }
  }
  return { layers, exclude: undefined }
}

function isIgnored(layers: readonly IgnoreLayer[], absolutePath: string, isDirectory: boolean): boolean {
  let ignored = false
  for (const layer of layers) {
    const rel = toPosix(relative(layer.base, absolutePath))
    if (!rel || rel.startsWith('..')) continue
    const result = layer.matcher.test(isDirectory ? `${rel}/` : rel)
    if (result.ignored) ignored = true
    else if (result.unignored) ignored = false
  }
  return ignored
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/**
 * Depth-first walk sorted by name, like `rg --sort path`: honors .gitignore / .ignore / .rgignore in
 * the tree and its ancestors (also outside git repositories), the repository's `.git/info/exclude` and the
 * global git excludes (`core.excludesFile`, see globalExcludesFile), includes hidden entries, skips `.git`
 * and does not follow symlinks. Precedence, lowest first (ripgrep's): global excludes, `info/exclude`, ignore files.
 */
export async function* walkTree(root: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry> {
  const [{ layers: baseLayers, exclude }, global] = await Promise.all([ancestorLayers(root), globalLayer(root)])
  const baseLow = [global, exclude].filter((layer): layer is IgnoreLayer => layer !== undefined)

  // low：全局 excludes 与 info/exclude（优先级低于任何 ignore 文件）；layers：各目录的 ignore 文件。
  async function* visit(dir: string, low: readonly IgnoreLayer[], layers: readonly IgnoreLayer[]): AsyncGenerator<WalkEntry> {
    throwIfAborted(options.signal)
    const own = await loadLayer(dir)
    const active = own ? [...layers, own] : layers
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // 嵌套仓库（遍历中遇到的 .git）的 info/exclude 作用于该目录之下。
    let lowHere = low
    if (dir !== root && entries.some((dirent) => dirent.name === '.git')) {
      const nested = await excludeLayer(dir)
      if (nested) lowHere = [...low, nested]
    }
    const all = [...lowHere, ...active]
    entries.sort(byName)
    for (const dirent of entries) {
      if (dirent.isSymbolicLink()) continue
      const isDirectory = dirent.isDirectory()
      if (!isDirectory && !dirent.isFile()) continue
      if (isDirectory && dirent.name === '.git') continue
      const absolutePath = join(dir, dirent.name)
      if (isIgnored(all, absolutePath, isDirectory)) continue
      const entry: WalkEntry = { absolutePath, relativePath: toPosix(relative(root, absolutePath)), isDirectory }
      yield entry
      if (isDirectory && (options.descend?.(entry) ?? true)) yield* visit(absolutePath, lowHere, active)
    }
  }

  yield* visit(root, baseLow, baseLayers)
}

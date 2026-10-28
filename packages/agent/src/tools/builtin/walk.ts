import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
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

async function loadLayer(dir: string): Promise<IgnoreLayer | undefined> {
  const patterns: string[] = []
  for (const name of IGNORE_FILES) {
    try {
      patterns.push(await readFile(join(dir, name), 'utf-8'))
    } catch {
      // Missing or unreadable ignore file.
    }
  }
  if (patterns.length === 0) return undefined
  return { base: dir, matcher: ignore().add(patterns.join('\n')) }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Ignore layers from ancestors of `root`, outermost first, stopping at the enclosing git repository root. */
async function ancestorLayers(root: string): Promise<IgnoreLayer[]> {
  const layers: IgnoreLayer[] = []
  let current = root
  if (await exists(join(current, '.git'))) return layers
  while (true) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    const layer = await loadLayer(current)
    if (layer) layers.unshift(layer)
    if (await exists(join(current, '.git'))) break
  }
  return layers
}

function isIgnored(layers: IgnoreLayer[], absolutePath: string, isDirectory: boolean): boolean {
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
 * the tree and its ancestors (also outside git repositories), includes hidden entries, skips `.git`
 * and does not follow symlinks.
 */
export async function* walkTree(root: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry> {
  const baseLayers = await ancestorLayers(root)

  async function* visit(dir: string, layers: IgnoreLayer[]): AsyncGenerator<WalkEntry> {
    throwIfAborted(options.signal)
    const own = await loadLayer(dir)
    const active = own ? [...layers, own] : layers
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort(byName)
    for (const dirent of entries) {
      if (dirent.isSymbolicLink()) continue
      const isDirectory = dirent.isDirectory()
      if (!isDirectory && !dirent.isFile()) continue
      if (isDirectory && dirent.name === '.git') continue
      const absolutePath = join(dir, dirent.name)
      if (isIgnored(active, absolutePath, isDirectory)) continue
      const entry: WalkEntry = { absolutePath, relativePath: toPosix(relative(root, absolutePath)), isDirectory }
      yield entry
      if (isDirectory && (options.descend?.(entry) ?? true)) yield* visit(absolutePath, active)
    }
  }

  yield* visit(root, baseLayers)
}

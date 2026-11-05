import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Artifact } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import { requireSession } from './session-runtimes.ts'
import { sessionProject } from './session-project.ts'

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Disk is the only Artifact index. No Session entries or cached historical paths are created. */
export class ArtifactService {
  readonly #store: SessionStore
  constructor(store: SessionStore) {
    this.#store = store
  }

  async #root(sessionId: string): Promise<string> {
    const session = await requireSession(this.#store, sessionId)
    if (!session.directory || (await sessionProject(this.#store, session))) throw new AppError('not-found', 'Artifacts are unavailable for this session')
    const directory = join(session.directory, 'outputs')
    // Replacing outputs itself with a link must not redefine the allowed tree.
    try {
      if (!(await lstat(directory)).isDirectory() || !(await lstat(session.directory)).isDirectory())
        throw new AppError('forbidden', 'Artifact directory is not an ordinary directory')
    } catch (error) {
      if (!missing(error)) throw error
    }
    return directory
  }

  async list(sessionId: string): Promise<Artifact[]> {
    const directory = await this.#root(sessionId)
    const root = await realpath(directory).catch((error: unknown) => {
      if (missing(error)) return undefined
      throw error
    })
    if (!root) return []
    const artifacts: Artifact[] = []
    const visit = async (folder: string, prefix: string) => {
      const entries = await readdir(folder, { withFileTypes: true })
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue
        const local = join(folder, entry.name)
        try {
          const actual = await realpath(local)
          if (!inside(root, actual)) continue
          const info = await lstat(local)
          if (!info.isDirectory() && !info.isFile()) continue
          const path = prefix + entry.name
          artifacts.push({
            path,
            name: entry.name,
            kind: info.isDirectory() ? 'directory' : 'file',
            size: info.isFile() ? info.size : 0,
            modifiedAt: info.mtimeMs,
          })
          if (info.isDirectory()) await visit(actual, path + '/')
        } catch (error) {
          if (!missing(error)) throw error
        }
      }
    }
    await visit(root, '')
    return artifacts
  }

  /** Revalidate disk containment at click time rather than trusting a stale list. */
  async resolve(sessionId: string, path: string): Promise<string> {
    const parts = path.split('/')
    if (parts.some((part) => !part || part.startsWith('.') || (sep === '\\' && part.includes('\\')) || part.includes('\0')) || isAbsolute(path))
      throw new AppError('bad-request', 'Invalid artifact path')
    const directory = await this.#root(sessionId)
    try {
      const root = await realpath(directory)
      const actual = await realpath(join(root, ...parts))
      if (!inside(root, actual)) throw new AppError('forbidden', 'Artifact is outside outputs')
      let current = root
      for (const part of parts) {
        current = join(current, part)
        if ((await lstat(current)).isSymbolicLink()) throw new AppError('forbidden', 'Artifact links are unavailable')
      }
      const info = await lstat(actual)
      if (!info.isFile() && !info.isDirectory()) throw new AppError('not-found', 'Artifact is unavailable')
      return actual
    } catch (error) {
      if (missing(error)) throw new AppError('not-found', 'Artifact no longer exists')
      throw error
    }
  }
}

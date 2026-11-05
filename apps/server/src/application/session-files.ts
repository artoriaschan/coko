import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rmdir, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getLogger } from '@coko/logging'
import type { Session, SessionStore } from '@coko/session'
import type { RunEntry } from '@coko/agent'

const log = getLogger(['application', 'session-files'])
const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

/** Session-owned files are separate from shared project/Workspace files. */
export class SessionFiles {
  readonly #options: { store: SessionStore; attachmentsRoot?: string; toolResultsRoot?: string }
  constructor(options: { store: SessionStore; attachmentsRoot?: string; toolResultsRoot?: string }) {
    this.#options = options
  }

  /** Rebind spilled outputs before publishing forked history; each Session owns its private data. */
  async fork(sourceId: string, sessionId: string, entries: readonly RunEntry[]): Promise<{ entries: RunEntry[]; rollback(): Promise<void> }> {
    const root = this.#options.toolResultsRoot
    if (!root) return { entries: [...entries], rollback: async () => {} }
    const source = join(root, encodeURIComponent(sourceId))
    const destination = join(root, encodeURIComponent(sessionId))
    const created: string[] = []
    const rollback = async () => {
      for (const path of created) await rm(path, { force: true })
      await rmdir(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error
      })
    }
    let serialized = JSON.stringify(entries)
    const references = JSON.stringify(entries.filter((entry) => entry.kind === 'message' && entry.payload.role === 'toolResult'))
    try {
      const names = await readdir(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const name of names) {
        const path = join(source, name)
        const from = JSON.stringify(path).slice(1, -1)
        if (!references.includes(from)) continue
        if (!(await lstat(path)).isFile()) throw new Error('Spilled output is not a regular file')
        await mkdir(destination, { recursive: true, mode: 0o700 })
        const target = join(destination, name)
        await copyFile(path, target, constants.COPYFILE_EXCL)
        created.push(target)
        serialized = serialized.replaceAll(from, JSON.stringify(target).slice(1, -1))
      }
      const copied: RunEntry[] = JSON.parse(serialized)
      return { entries: copied, rollback }
    } catch (error) {
      await rollback()
      throw error
    }
  }

  async #removable(directory: string): Promise<boolean> {
    try {
      if (!(await lstat(directory)).isDirectory()) return false
      for (const name of await readdir(directory)) {
        if (name !== 'work' && name !== 'outputs') return false
        const path = join(directory, name)
        if (!(await lstat(path)).isDirectory() || (await readdir(path)).length) return false
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      return false
    }
  }

  async #shared(directory: string, deleted: Set<string>): Promise<boolean> {
    const visit = async (session: Session): Promise<boolean> => {
      if (!deleted.has(session.id) && session.directory === directory) return true
      for (const child of await this.#options.store.sessions.listChildren(session.id)) if (await visit(child)) return true
      return false
    }
    for (const session of await this.#options.store.sessions.listSessions()) if (await visit(session)) return true
    return false
  }

  async preview(tree: readonly Session[]): Promise<{ retainedDirectories: string[] }> {
    const deleted = new Set(tree.map((session) => session.id))
    const directories = [...new Set(tree.flatMap((session) => (session.directory ? [session.directory] : [])))]
    const retainedDirectories: string[] = []
    const projectFolders: string[] = []
    for (const project of await this.#options.store.projects.list()) {
      const primary = await this.#options.store.sessions.getWorkspace(project.primaryWorkspaceId)
      if (primary) projectFolders.push(primary.path)
      projectFolders.push(...project.additionalFolders)
    }
    for (const directory of directories) {
      const projectBound =
        tree.some((session) => session.directory === directory && session.projectId !== null) ||
        projectFolders.some((path) => within(directory, path) || within(path, directory))
      if (projectBound || (await this.#shared(directory, deleted)) || !(await this.#removable(directory))) retainedDirectories.push(directory)
    }
    return { retainedDirectories }
  }

  async delete(tree: readonly Session[]): Promise<{ retainedDirectories: string[] }> {
    const { retainedDirectories } = await this.preview(tree)
    const retained = new Set(retainedDirectories)
    for (const session of tree) {
      const directory = session.directory
      if (!directory || retained.has(directory)) continue
      try {
        // rmdir never follows a symlink or removes a file created after the preview.
        for (const name of ['work', 'outputs'])
          await rmdir(join(directory, name)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        await this.#options.store.sessions.deleteWorkspaceIfUnused(session.workspaceId)
      } catch (error) {
        log.warn('standalone directory retained after cleanup failed', { directory, error })
        retained.add(directory)
      }
    }
    for (const session of tree)
      for (const root of [this.#options.attachmentsRoot, this.#options.toolResultsRoot]) {
        if (root) await rm(join(root, encodeURIComponent(session.id)), { recursive: true, force: true })
      }
    return { retainedDirectories: [...retained] }
  }
}

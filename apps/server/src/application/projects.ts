import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { CreateProjectResponse, Project, ProjectFields } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from './errors.ts'

/** Project 的持久化组织关系与当前列表视图。 */
export class ProjectService {
  readonly #store: SessionStore
  readonly #removal: { removeProject(id: string): Promise<{ sessionIds: string[] }> }
  constructor(store: SessionStore, removal: { removeProject(id: string): Promise<{ sessionIds: string[] }> }) {
    this.#store = store
    this.#removal = removal
  }

  delete(id: string): Promise<{ sessionIds: string[] }> {
    return this.#removal.removeProject(id)
  }

  async checkFolder(path: string): Promise<{ path: string }> {
    if (!isAbsolute(path)) throw new AppError('bad-request', 'Folder path must be absolute', { reason: 'absolute' })
    let canonical: string
    try {
      canonical = await realpath(path)
      if (!(await stat(canonical)).isDirectory()) throw new AppError('bad-request', 'Choose a directory', { reason: 'not-directory' })
      await access(canonical, constants.R_OK | constants.X_OK)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('bad-request', 'Folder cannot be accessed', { reason: 'unavailable' })
    }
    return { path: canonical }
  }

  async create(input: ProjectFields): Promise<CreateProjectResponse> {
    const name = input.name.trim()
    if (!name || [...name].length > 50) throw new AppError('bad-request', 'Project name must contain 1–50 characters')
    if (input.folders.filter((folder) => folder.primary).length !== 1) throw new AppError('bad-request', 'Choose exactly one primary folder')
    const folders = await Promise.all(input.folders.map(async (folder) => ({ ...(await this.checkFolder(folder.path)), primary: folder.primary })))
    if (new Set(folders.map((folder) => folder.path)).size !== folders.length)
      throw new AppError('bad-request', 'Folder already added', { reason: 'duplicate' })
    const primary = folders.find((folder) => folder.primary)!
    const existing = (await this.list()).find((project) => project.folders.some((folder) => folder.primary && folder.path === primary.path))
    if (existing) return { status: 'existing', project: existing }
    const workspace = await this.#store.sessions.registerWorkspace({ path: primary.path })
    try {
      const created = await this.#store.projects.create({
        name,
        primaryWorkspaceId: workspace.id,
        additionalFolders: folders.filter((folder) => !folder.primary).map((folder) => folder.path),
        primaryFolderIndex: folders.findIndex((folder) => folder.primary),
      })
      return { status: 'created', project: (await this.list()).find((project) => project.id === created.id)! }
    } catch (error) {
      // 并发请求可能在检查后先登记同一主要 Workspace；唯一约束仍是最终裁决。
      const winner = (await this.list()).find((project) => project.primaryWorkspaceId === workspace.id)
      if (winner) return { status: 'existing', project: winner }
      throw error
    }
  }

  async rename(id: string, name: string): Promise<Project> {
    name = name.trim()
    if (!name || [...name].length > 50) throw new AppError('bad-request', 'Project name must contain 1–50 characters')
    await this.#store.projects.update(id, { name })
    return (await this.list()).find((project) => project.id === id)!
  }

  async setPinned(id: string, pinned: boolean): Promise<Project> {
    const current = await this.#store.projects.get(id)
    if (!current) throw new AppError('not-found', 'Project not found')
    await this.#store.projects.update(id, { pinnedAt: pinned ? (current.pinnedAt ?? Date.now()) : null })
    return (await this.list()).find((project) => project.id === id)!
  }

  async update(id: string, input: ProjectFields): Promise<{ status: 'updated'; project: Project }> {
    if (!(await this.#store.projects.get(id))) throw new AppError('not-found', 'Project not found')
    const name = input.name.trim()
    if (!name || [...name].length > 50) throw new AppError('bad-request', 'Project name must contain 1–50 characters')
    if (input.folders.filter((folder) => folder.primary).length !== 1) throw new AppError('bad-request', 'Choose exactly one primary folder')
    const folders = await Promise.all(input.folders.map(async (folder) => ({ ...(await this.checkFolder(folder.path)), primary: folder.primary })))
    if (new Set(folders.map((folder) => folder.path)).size !== folders.length)
      throw new AppError('bad-request', 'Folder already added', { reason: 'duplicate' })
    const workspace = await this.#store.sessions.registerWorkspace({ path: folders.find((folder) => folder.primary)!.path })
    const rejectConflict = async () => {
      const conflict = (await this.list()).find((project) => project.id !== id && project.primaryWorkspaceId === workspace.id)
      if (conflict) throw new AppError('already-exists', 'Primary folder belongs to another project', { reason: 'primary-conflict', project: conflict })
    }
    await rejectConflict()
    try {
      await this.#store.projects.update(id, {
        name,
        primaryWorkspaceId: workspace.id,
        additionalFolders: folders.filter((folder) => !folder.primary).map((folder) => folder.path),
        primaryFolderIndex: folders.findIndex((folder) => folder.primary),
      })
    } catch (error) {
      await rejectConflict()
      throw error
    }
    return { status: 'updated', project: (await this.list()).find((project) => project.id === id)! }
  }

  async list(): Promise<Project[]> {
    const [projects, workspaces, sessions] = await Promise.all([
      this.#store.projects.list(),
      this.#store.sessions.listWorkspaces(),
      this.#store.sessions.listSessions(),
    ])
    return projects.map((project) => {
      const primary = workspaces.find((workspace) => workspace.id === project.primaryWorkspaceId)!
      const members = sessions.filter((session) => session.projectId === project.id)
      const folders = project.additionalFolders.map((path) => ({ path, primary: false }))
      folders.splice(project.primaryFolderIndex, 0, { path: primary.path, primary: true })
      return {
        id: project.id,
        name: project.name,
        primaryWorkspaceId: project.primaryWorkspaceId,
        folders,
        pinnedAt: project.pinnedAt,
        createdAt: project.createdAt,
        lastUsedAt: Math.max(project.createdAt, ...members.map((session) => session.updatedAt)),
        sessionCount: members.filter((session) => session.archivedAt === null).length,
      }
    })
  }
}

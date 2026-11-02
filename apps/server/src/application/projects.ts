import type { Project } from '@coko/protocol'
import type { SessionStore } from '@coko/session'

/** Project 的持久化组织关系与当前列表视图。 */
export class ProjectService {
  readonly #store: SessionStore
  constructor(store: SessionStore) {
    this.#store = store
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
      return {
        id: project.id,
        name: project.name,
        primaryWorkspaceId: project.primaryWorkspaceId,
        folders: [{ path: primary.path, primary: true }, ...project.additionalFolders.map((path) => ({ path, primary: false }))],
        pinnedAt: project.pinnedAt,
        createdAt: project.createdAt,
        lastUsedAt: Math.max(project.createdAt, ...members.map((session) => session.updatedAt)),
        sessionCount: members.filter((session) => session.archivedAt === null).length,
      }
    })
  }
}

import type { Project, Session, SessionStore } from '@coko/session'
import { requireSession } from './session-runtimes.ts'

/** Child Sessions inherit their root Session's Project folders, without gaining Project ownership. */
export async function sessionProject(store: SessionStore, session: Session) {
  let root = session
  const visited = new Set<string>()
  while (root.parentSessionId && !visited.has(root.id)) {
    visited.add(root.id)
    root = await requireSession(store, root.parentSessionId)
  }
  return root.projectId ? store.projects.get(root.projectId) : undefined
}

/** 项目归属给上下文作用域的字段：附加文件夹与项目记忆 Workspace（主要文件夹，ADR 0027）；没有项目时只有用户级记忆。 */
export const projectScope = (project: Project | undefined) => ({
  additionalFolders: project?.additionalFolders ?? [],
  ...(project ? { memoryWorkspaceId: project.primaryWorkspaceId } : {}),
})

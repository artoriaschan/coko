import type { Session, SessionStore } from '@coko/session'
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

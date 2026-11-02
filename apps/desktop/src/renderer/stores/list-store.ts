import type { Project, Session, Workspace } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ApiClient } from '../client/api.ts'

export interface ListState {
  workspaces: Workspace[]
  projects: Project[]
  sessions: Session[]
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
}
export interface ListActions {
  load(): Promise<boolean>
  upsertSession(session: Session): void
  patchSession(id: string, patch: Partial<Session>): void
}
export type ListStore = StoreApi<ListState & ListActions>

/** 列表与组织关系独立于会话内容，业务事件只更新这里的一份数据。 */
export function createListStore(api: ApiClient): ListStore {
  return createStore<ListState & ListActions>()((set, get) => ({
    workspaces: [],
    projects: [],
    sessions: [],
    listStatus: 'idle',
    async load() {
      if (get().listStatus === 'idle') set({ listStatus: 'loading' })
      try {
        const [workspaces, projects, sessions] = await Promise.all([api.listWorkspaces(), api.listProjects(), api.listSessions()])
        set({ workspaces, projects, sessions, listStatus: 'ready' })
        return true
      } catch {
        if (get().listStatus !== 'ready') set({ listStatus: 'error' })
        return false
      }
    },
    upsertSession(session) {
      set((state) => ({ sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)] }))
    },
    patchSession(id, patch) {
      set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? { ...session, ...patch } : session)) }))
    },
  }))
}

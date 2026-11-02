import type { Project, Session, Workspace } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ApiClient } from '../client/api.ts'

export type SidebarCategory = 'conversations' | 'projects'
export interface ListDisplay {
  categoryOrder: SidebarCategory[]
  categoryExpanded: Record<string, boolean>
  expandedProjects: Record<string, boolean>
  projectSort: 'recent' | 'created'
  lastSessionId: string | null | undefined
}
const DISPLAY_KEY = 'coko.workbench.lists.v1'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const booleans = (value: unknown): Record<string, boolean> =>
  record(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {}

function readDisplay(): ListDisplay {
  const fallback: ListDisplay = {
    categoryOrder: ['conversations', 'projects'],
    categoryExpanded: {},
    expandedProjects: {},
    projectSort: 'recent',
    lastSessionId: undefined,
  }
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw: unknown = JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null')
    if (!record(raw)) return fallback
    return {
      categoryOrder:
        Array.isArray(raw.categoryOrder) &&
        raw.categoryOrder.length === 2 &&
        raw.categoryOrder.includes('conversations') &&
        raw.categoryOrder.includes('projects')
          ? raw.categoryOrder
          : fallback.categoryOrder,
      categoryExpanded: booleans(raw.categoryExpanded),
      expandedProjects: booleans(raw.expandedProjects),
      projectSort: raw.projectSort === 'created' ? 'created' : 'recent',
      lastSessionId: typeof raw.lastSessionId === 'string' || raw.lastSessionId === null ? raw.lastSessionId : undefined,
    }
  } catch {
    return fallback
  }
}

export interface ListState extends ListDisplay {
  workspaces: Workspace[]
  projects: Project[]
  sessions: Session[]
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
  visibleCounts: Record<string, number>
}
export interface ListActions {
  load(): Promise<boolean>
  setPinned(id: string, pinned: boolean): Promise<boolean>
  renameSession(id: string, title: string): Promise<boolean>
  reorderCategories(first: SidebarCategory): void
  rememberSession(id: string | null): void
  sortProjects(sort: 'recent' | 'created'): void
  toggleProject(id: string): void
  expandProjects(ids: string[], expanded: boolean): void
  toggleCategory(key: string): void
  showMore(key: string): void
  showLess(key: string): void
  upsertSession(session: Session): void
  patchSession(id: string, patch: Partial<Session>): void
}
export type ListStore = StoreApi<ListState & ListActions>

/** 列表与组织关系独立于会话内容，业务事件只更新这里的一份数据。 */
export function createListStore(api: ApiClient): ListStore {
  const initial = readDisplay()
  return createStore<ListState & ListActions>()((set, get) => {
    const save = (patch: Partial<ListDisplay>) => {
      set(patch)
      const { categoryOrder, categoryExpanded, expandedProjects, projectSort, lastSessionId } = get()
      try {
        if (typeof localStorage !== 'undefined')
          localStorage.setItem(DISPLAY_KEY, JSON.stringify({ categoryOrder, categoryExpanded, expandedProjects, projectSort, lastSessionId }))
      } catch {
        /* 展示偏好保存不可用不阻止本窗口操作。 */
      }
    }
    return {
      workspaces: [],
      projects: [],
      sessions: [],
      listStatus: 'idle',
      ...initial,
      reorderCategories(first) {
        save({ categoryOrder: first === 'projects' ? ['projects', 'conversations'] : ['conversations', 'projects'] })
      },
      rememberSession(lastSessionId) {
        save({ lastSessionId })
      },
      sortProjects(projectSort) {
        save({ projectSort })
      },
      toggleProject(id) {
        save({ expandedProjects: { ...get().expandedProjects, [id]: !(get().expandedProjects[id] ?? true) } })
      },
      expandProjects(ids, expanded) {
        save({ expandedProjects: { ...get().expandedProjects, ...Object.fromEntries(ids.map((id) => [id, expanded])) } })
      },
      toggleCategory(key) {
        save({ categoryExpanded: { ...get().categoryExpanded, [key]: !(get().categoryExpanded[key] ?? true) } })
      },
      visibleCounts: {},
      showMore(key) {
        set((state) => ({ visibleCounts: { ...state.visibleCounts, [key]: (state.visibleCounts[key] ?? 5) + 5 } }))
      },
      showLess(key) {
        set((state) => ({ visibleCounts: { ...state.visibleCounts, [key]: 5 } }))
      },
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
      async setPinned(id, pinned) {
        try {
          get().patchSession(id, await api.setSessionPinned(id, pinned))
          return true
        } catch {
          return false
        }
      },
      async renameSession(id, title) {
        try {
          get().patchSession(id, await api.renameSession(id, title))
          return true
        } catch {
          return false
        }
      },
      upsertSession(session) {
        set((state) => ({ sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)] }))
      },
      patchSession(id, patch) {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, ...patch, updatedAt: Math.max(session.updatedAt, patch.updatedAt ?? session.updatedAt) } : session,
          ),
        }))
      },
    }
  })
}

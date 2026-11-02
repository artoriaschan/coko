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
  archivedSessions: Session[]
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
  visibleCounts: Record<string, number>
}
export interface ListActions {
  upsertProject(project: Project): void
  load(): Promise<boolean>
  loadArchived(): Promise<void>
  setArchiveState(session: Session): void
  setProjectPinned(id: string, pinned: boolean): Promise<boolean>
  renameProject(id: string, name: string): Promise<boolean>
  moveSession(id: string, projectId: string | null): Promise<boolean>
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
  removeSessions(ids: string[]): void
  upsertSession(session: Session): void
  patchSession(id: string, patch: Partial<Session>): void
}
export type ListStore = StoreApi<ListState & ListActions>

/** 列表与组织关系独立于会话内容，业务事件只更新这里的一份数据。 */
export function createListStore(api: ApiClient): ListStore {
  const initial = readDisplay()
  const removed = new Set<string>()
  const organization = new Map<string, Partial<Session>>()
  let archiveRevision = 0
  let archiveLoadRevision = 0
  const archiveChanges = new Map<string, number>()
  let loadRevision = 0
  let titleRevision = 0
  const titleChanges = new Map<string, { revision: number; title: string }>()
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
      archivedSessions: [],
      async loadArchived() {
        const request = ++archiveLoadRevision
        const titlesAtStart = titleRevision
        const before = archiveRevision
        const sessions = await api.listArchivedSessions()
        if (request !== archiveLoadRevision) return
        sessions.push(
          ...get().archivedSessions.filter((session) => (archiveChanges.get(session.id) ?? 0) > before && !sessions.some((item) => item.id === session.id)),
        )
        set({
          archivedSessions: sessions
            .map((session) => {
              const title = titleChanges.get(session.id)
              return { ...session, ...organization.get(session.id), ...(title && title.revision > titlesAtStart ? { title: title.title } : {}) }
            })
            .filter((session) => !removed.has(session.id) && session.archivedAt !== null),
        })
      },
      setArchiveState(session) {
        archiveChanges.set(session.id, ++archiveRevision)
        organization.set(session.id, { ...organization.get(session.id), archivedAt: session.archivedAt, pinnedAt: null })
        get().upsertSession(session)
      },
      upsertProject(project) {
        set((state) => ({
          projects: [...state.projects.filter((item) => item.id !== project.id), project],
          workspaces: state.workspaces.some((workspace) => workspace.id === project.primaryWorkspaceId)
            ? state.workspaces
            : [
                ...state.workspaces,
                {
                  id: project.primaryWorkspaceId,
                  path: project.folders.find((folder) => folder.primary)!.path,
                  name: project.name,
                  createdAt: project.createdAt,
                },
              ],
        }))
      },
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
        const request = ++loadRevision
        const titlesAtStart = titleRevision
        const archivesAtStart = archiveRevision
        if (get().listStatus === 'idle') set({ listStatus: 'loading' })
        try {
          const [workspaces, projects, sessions] = await Promise.all([api.listWorkspaces(), api.listProjects(), api.listSessions()])
          if (request !== loadRevision) return false
          sessions.push(
            ...get().sessions.filter((session) => (archiveChanges.get(session.id) ?? 0) > archivesAtStart && !sessions.some((item) => item.id === session.id)),
          )
          const current = sessions
            .map((session) => ({ ...session, ...organization.get(session.id) }))
            .filter((session) => session.archivedAt === null)
            .filter((session) => !removed.has(session.id))
            .map((session) => {
              const title = titleChanges.get(session.id)
              if (!title) return session
              if (title.revision > titlesAtStart) return { ...session, title: title.title }
              titleChanges.delete(session.id)
              return session
            })
          for (const [id, change] of titleChanges)
            if (change.revision <= titlesAtStart && !get().archivedSessions.some((session) => session.id === id)) titleChanges.delete(id)
          set({ workspaces, projects, sessions: current, listStatus: 'ready' })
          return true
        } catch {
          if (get().listStatus !== 'ready') set({ listStatus: 'error' })
          return false
        }
      },
      async setProjectPinned(id, pinned) {
        try {
          get().upsertProject(await api.setProjectPinned(id, pinned))
          return true
        } catch {
          return false
        }
      },
      async renameProject(id, name) {
        try {
          get().upsertProject(await api.renameProject(id, name))
          return true
        } catch {
          return false
        }
      },
      async moveSession(id, projectId) {
        try {
          const updated = await api.moveSession(id, projectId)
          get().patchSession(id, { projectId: updated.projectId })
          return true
        } catch {
          return false
        }
      },
      async setPinned(id, pinned) {
        const beforeArchive = archiveChanges.get(id) ?? 0
        try {
          const updated = await api.setSessionPinned(id, pinned)
          if ((archiveChanges.get(id) ?? 0) !== beforeArchive || organization.get(id)?.archivedAt != null) return false
          if (organization.has(id)) organization.set(id, { ...organization.get(id), pinnedAt: updated.pinnedAt })
          get().patchSession(id, { pinnedAt: updated.pinnedAt })
          return true
        } catch {
          return false
        }
      },
      async renameSession(id, title) {
        try {
          const updated = await api.renameSession(id, title)
          get().patchSession(id, { title: updated.title })
          return true
        } catch {
          return false
        }
      },
      removeSessions(ids) {
        for (const id of ids) {
          removed.add(id)
          titleChanges.delete(id)
        }
        set((state) => ({
          sessions: state.sessions.filter((session) => !removed.has(session.id)),
          archivedSessions: state.archivedSessions.filter((session) => !removed.has(session.id)),
        }))
      },
      upsertSession(session) {
        if (removed.has(session.id)) return
        session = { ...session, ...organization.get(session.id) }
        const observed = titleChanges.get(session.id)
        if (observed) session = { ...session, title: observed.title }
        set((state) => ({
          sessions:
            session.archivedAt === null ? [session, ...state.sessions.filter((s) => s.id !== session.id)] : state.sessions.filter((s) => s.id !== session.id),
          archivedSessions:
            session.archivedAt !== null
              ? [session, ...state.archivedSessions.filter((s) => s.id !== session.id)]
              : state.archivedSessions.filter((s) => s.id !== session.id),
        }))
      },
      patchSession(id, patch) {
        if (typeof patch.title === 'string') titleChanges.set(id, { title: patch.title, revision: ++titleRevision })
        set((state) => ({
          archivedSessions: state.archivedSessions.map((session) => (session.id === id ? { ...session, ...patch, ...organization.get(id) } : session)),
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, ...patch, updatedAt: Math.max(session.updatedAt, patch.updatedAt ?? session.updatedAt) } : session,
          ),
        }))
      },
    }
  })
}

import {
  API_ROUTES,
  Session,
  Worktree,
  WorktreeBusyDetails,
  WorktreeDirtyDetails,
  WorktreeListResponse,
  worktreePaths,
  type WorktreeBusyReason,
} from '@coko/protocol'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// Worktree 的 store（docs/subsystems/worktrees.md）：每个 Workspace 的 worktree 列表（GET /api/workspaces/:id/worktrees）、
// 在新 worktree 中新建会话（POST worktree 后以 worktreeId 创建 Session）与移除（DELETE /api/worktrees/:id；busy / dirty 的原因保留在状态中供对话框显示）。

export interface WorktreesBackend {
  list(workspaceId: string): Promise<Worktree[]>
  create(workspaceId: string, name: string | undefined): Promise<Worktree>
  createSession(workspaceId: string, worktreeId: string): Promise<Session>
  remove(worktreeId: string): Promise<void>
}

const NoContent = Type.Undefined()

export function httpWorktreesBackend(fetchImpl?: Fetch): WorktreesBackend {
  return {
    list: (workspaceId) => requestJson(WorktreeListResponse, 'GET', worktreePaths.workspaceWorktrees(workspaceId), undefined, fetchImpl),
    create: (workspaceId, name) => requestJson(Worktree, 'POST', worktreePaths.workspaceWorktrees(workspaceId), name ? { name } : {}, fetchImpl),
    createSession: (workspaceId, worktreeId) => requestJson(Session, 'POST', API_ROUTES.sessions, { workspaceId, worktreeId }, fetchImpl),
    remove: async (worktreeId) => {
      await requestJson(NoContent, 'DELETE', worktreePaths.worktree(worktreeId), undefined, fetchImpl)
    },
  }
}

/** 移除被拒绝的原因（409 的 details，已按 schema 校验）。 */
export type RemoveBlock = { kind: 'busy'; reasons: WorktreeBusyReason[] } | { kind: 'dirty'; files: string[]; count: number }

export interface WorkspaceWorktrees {
  status: 'loading' | 'ready' | 'error'
  worktrees: Worktree[]
}

export interface WorktreesState {
  workspaces: Record<string, WorkspaceWorktrees>
  /** 最近一次移除被拒绝的原因（按 worktree）；再次移除或成功时清除。 */
  blocked: Record<string, RemoveBlock>
}

export interface WorktreesActions {
  /** 读取 Workspace 的 worktree；失败时保留已有列表。 */
  load(workspaceId: string): Promise<void>
  /** 创建 worktree 并以它创建 Session，返回新 Session。失败时抛 ApiError（调用方本地化提示）。 */
  createSession(workspaceId: string, name: string | undefined): Promise<Session>
  /** 移除；busy / dirty 时返回原因（同时记在 blocked），成功时 undefined。其他错误抛 ApiError。之后重新读取列表。 */
  remove(workspaceId: string, worktreeId: string): Promise<RemoveBlock | undefined>
}

export type WorktreesStore = StoreApi<WorktreesState & WorktreesActions>

/** 409 worktree-busy / worktree-dirty 的 details；不合 schema 时 undefined（按普通错误处理）。 */
export function removeBlock(error: unknown): RemoveBlock | undefined {
  if (!(error instanceof ApiError)) return undefined
  if (error.code === 'worktree-busy' && Value.Check(WorktreeBusyDetails, error.details)) return { kind: 'busy', reasons: error.details.reasons }
  if (error.code === 'worktree-dirty' && Value.Check(WorktreeDirtyDetails, error.details))
    return { kind: 'dirty', files: error.details.files, count: error.details.count }
  return undefined
}

export function createWorktreesStore(backend: WorktreesBackend = httpWorktreesBackend()): WorktreesStore {
  /** 每个 Workspace 最近发出的读取：较早的请求晚到时丢弃。 */
  const latest = new Map<string, number>()
  let counter = 0
  return createStore<WorktreesState & WorktreesActions>()((set, get) => {
    const load = async (workspaceId: string) => {
      const id = ++counter
      latest.set(workspaceId, id)
      const current = get().workspaces[workspaceId]
      if (!current) set((s) => ({ workspaces: { ...s.workspaces, [workspaceId]: { status: 'loading', worktrees: [] } } }))
      try {
        const worktrees = await backend.list(workspaceId)
        if (latest.get(workspaceId) !== id) return
        set((s) => ({ workspaces: { ...s.workspaces, [workspaceId]: { status: 'ready', worktrees } } }))
      } catch {
        if (latest.get(workspaceId) !== id) return
        set((s) => ({ workspaces: { ...s.workspaces, [workspaceId]: { status: 'error', worktrees: s.workspaces[workspaceId]?.worktrees ?? [] } } }))
      }
    }
    const clearBlock = (worktreeId: string) =>
      set((s) => {
        if (!(worktreeId in s.blocked)) return {}
        const { [worktreeId]: _removed, ...rest } = s.blocked
        return { blocked: rest }
      })
    return {
      workspaces: {},
      blocked: {},
      load,
      async createSession(workspaceId, name) {
        const worktree = await backend.create(workspaceId, name)
        try {
          return await backend.createSession(workspaceId, worktree.id)
        } finally {
          void load(workspaceId)
        }
      },
      async remove(workspaceId, worktreeId) {
        clearBlock(worktreeId)
        try {
          await backend.remove(worktreeId)
          return undefined
        } catch (error) {
          const block = removeBlock(error)
          if (!block) throw error
          set((s) => ({ blocked: { ...s.blocked, [worktreeId]: block } }))
          return block
        } finally {
          void load(workspaceId)
        }
      },
    }
  })
}

/** 应用内共用的 store（组件经 context 取用，测试可换成自己的）。 */
export const worktreesStore = createWorktreesStore()

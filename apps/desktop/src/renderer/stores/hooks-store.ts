import { HooksResponse, hookPaths, type HooksConfig } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 外部 Hook（ADR 0013）的视图 store：GET /api/hooks（给出会话时含该会话目录的项目 Hook 与批准状态，新会话草稿按 Workspace 目录）、PUT /api/hooks
// （整体替换全局配置，revision 冲突时读回）与 POST /api/hooks/approvals（逐条批准项目 Hook）。设置 → Hooks 分区读取它。

/** 读取项目 Hook 的目录：会话（其工作目录）或 Workspace（没有会话时）；字符串为 sessionId。 */
export type HooksTarget = string | { sessionId: string } | { workspaceId: string }

export interface HooksBackend {
  get(target?: HooksTarget): Promise<HooksResponse>
  update(hooks: HooksConfig, expectedRevision: number): Promise<HooksResponse>
  approve(request: { workspaceId: string; digest: string; sessionId?: string }): Promise<void>
}

const NoContent = Type.Undefined()

const query = (target: HooksTarget | undefined) => {
  if (target === undefined) return ''
  if (typeof target === 'string') return `?sessionId=${encodeURIComponent(target)}`
  return 'sessionId' in target ? `?sessionId=${encodeURIComponent(target.sessionId)}` : `?workspaceId=${encodeURIComponent(target.workspaceId)}`
}
const sessionOf = (target: HooksTarget | undefined) =>
  target === undefined ? undefined : typeof target === 'string' ? target : 'sessionId' in target ? target.sessionId : undefined
const keyOf = (target: HooksTarget | undefined) => query(target)

/** 经 requestJson（错误体与响应在信任边界按 schema 校验）。 */
export function httpHooksBackend(fetchImpl?: Fetch): HooksBackend {
  return {
    get: (target) => requestJson(HooksResponse, 'GET', `${hookPaths.hooks}${query(target)}`, undefined, fetchImpl),
    update: (hooks, expectedRevision) => requestJson(HooksResponse, 'PUT', hookPaths.hooks, { hooks, expectedRevision }, fetchImpl),
    approve: async (request) => {
      await requestJson(NoContent, 'POST', hookPaths.approvals, request, fetchImpl)
    },
  }
}

export interface HooksState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读到的视图；target 为读取时的会话或 Workspace（项目 Hook 按其目录）。 */
  view: HooksResponse | undefined
  target: HooksTarget | undefined
  /** 最近一次失败（保存的诊断在 details.diagnostics）。 */
  error: ApiError | undefined
  load(target?: HooksTarget): Promise<void>
  /** 保存全局配置；revision 冲突时读回最新值并抛出（界面提示后由用户重试）。 */
  save(hooks: HooksConfig): Promise<void>
  /** 批准当前会话目录（或 Workspace 目录）中的一条项目 Hook，之后读回。 */
  approve(workspaceId: string, digest: string): Promise<void>
}

const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

export function createHooksStore(backend: HooksBackend = httpHooksBackend()): StoreApi<HooksState> {
  return createStore<HooksState>()((set, get) => ({
    status: 'idle',
    view: undefined,
    target: undefined,
    error: undefined,
    async load(target) {
      set({ status: get().view && keyOf(get().target) === keyOf(target) ? get().status : 'loading', target })
      try {
        const view = await backend.get(target)
        if (keyOf(get().target) === keyOf(target)) set({ status: 'ready', view, error: undefined })
      } catch (error) {
        if (keyOf(get().target) === keyOf(target)) set({ status: 'error', error: asApiError(error) })
      }
    },
    async save(hooks) {
      const revision = get().view?.global.revision ?? 0
      try {
        const view = await backend.update(hooks, revision)
        set({ view: { ...view, ...(get().view?.project ? { project: get().view!.project } : {}) }, error: undefined })
      } catch (error) {
        const failure = asApiError(error)
        set({ error: failure })
        if (failure.code === 'revision-conflict') await get().load(get().target)
        throw failure
      }
    },
    async approve(workspaceId, digest) {
      const target = get().target
      const sessionId = sessionOf(target)
      try {
        await backend.approve({ workspaceId, digest, ...(sessionId === undefined ? {} : { sessionId }) })
      } catch (error) {
        set({ error: asApiError(error) })
        throw error
      } finally {
        await get().load(target)
      }
    },
  }))
}

/** 应用内共用的 store（设置 → Hooks 分区经 zustand 的 useStore 订阅）。 */
export const hooksStore: StoreApi<HooksState> = createHooksStore()

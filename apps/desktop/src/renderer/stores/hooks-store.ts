import { HooksResponse, hookPaths, type HooksConfig } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 外部 Hook（ADR 0013）的视图 store：GET /api/hooks（给出 sessionId 时含该会话目录的项目 Hook 与批准状态）、PUT /api/hooks（整体替换全局
// 配置，revision 冲突时读回）与 POST /api/hooks/approvals（逐条批准项目 Hook）。设置 → Hooks 分区读取它。

export interface HooksBackend {
  get(sessionId?: string): Promise<HooksResponse>
  update(hooks: HooksConfig, expectedRevision: number): Promise<HooksResponse>
  approve(request: { workspaceId: string; digest: string; sessionId?: string }): Promise<void>
}

const NoContent = Type.Undefined()

/** 经 requestJson（错误体与响应在信任边界按 schema 校验）。 */
export function httpHooksBackend(fetchImpl?: Fetch): HooksBackend {
  return {
    get: (sessionId) =>
      requestJson(
        HooksResponse,
        'GET',
        sessionId === undefined ? hookPaths.hooks : `${hookPaths.hooks}?sessionId=${encodeURIComponent(sessionId)}`,
        undefined,
        fetchImpl,
      ),
    update: (hooks, expectedRevision) => requestJson(HooksResponse, 'PUT', hookPaths.hooks, { hooks, expectedRevision }, fetchImpl),
    approve: async (request) => {
      await requestJson(NoContent, 'POST', hookPaths.approvals, request, fetchImpl)
    },
  }
}

export interface HooksState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读到的视图；sessionId 为读取时的会话（项目 Hook 按其目录）。 */
  view: HooksResponse | undefined
  sessionId: string | undefined
  /** 最近一次失败（保存的诊断在 details.diagnostics）。 */
  error: ApiError | undefined
  load(sessionId?: string): Promise<void>
  /** 保存全局配置；revision 冲突时读回最新值并抛出（界面提示后由用户重试）。 */
  save(hooks: HooksConfig): Promise<void>
  /** 批准当前会话目录中的一条项目 Hook，之后读回。 */
  approve(workspaceId: string, digest: string): Promise<void>
}

const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

export function createHooksStore(backend: HooksBackend = httpHooksBackend()): StoreApi<HooksState> {
  return createStore<HooksState>()((set, get) => ({
    status: 'idle',
    view: undefined,
    sessionId: undefined,
    error: undefined,
    async load(sessionId) {
      set({ status: 'loading', sessionId })
      try {
        const view = await backend.get(sessionId)
        if (get().sessionId === sessionId) set({ status: 'ready', view, error: undefined })
      } catch (error) {
        if (get().sessionId === sessionId) set({ status: 'error', error: asApiError(error) })
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
        if (failure.code === 'revision-conflict') await get().load(get().sessionId)
        throw failure
      }
    },
    async approve(workspaceId, digest) {
      const sessionId = get().sessionId
      try {
        await backend.approve({ workspaceId, digest, ...(sessionId === undefined ? {} : { sessionId }) })
      } catch (error) {
        set({ error: asApiError(error) })
        throw error
      } finally {
        await get().load(sessionId)
      }
    },
  }))
}

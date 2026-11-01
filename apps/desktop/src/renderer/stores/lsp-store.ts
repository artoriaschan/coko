import { LspResponse, lspPaths, type LspServersConfig, type ProgressEvent } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 代码智能（语言服务器）的视图 store：GET /api/lsp（给出会话时含其 Workspace 的服务器，状态按会话目录）、PUT /api/lsp（整体替换一个作用域，
// revision 冲突时读回）、POST /api/lsp/restart，以及 progress lsp_update 的状态合并。设置 → 代码智能分区读取它。

/** 读取的作用域：会话（其 Workspace 与工作目录）或 Workspace（没有会话时）。 */
export type LspTarget = { sessionId: string } | { workspaceId: string }
export type LspScope = 'global' | 'workspace'

export interface LspBackend {
  get(target?: LspTarget): Promise<LspResponse>
  update(scope: 'global' | { workspaceId: string }, servers: LspServersConfig, expectedRevision: number): Promise<LspResponse>
  restart(name: string, cwd?: string): Promise<void>
}

const NoContent = Type.Undefined()

const query = (target: LspTarget | undefined) =>
  target === undefined
    ? ''
    : 'sessionId' in target
      ? `?sessionId=${encodeURIComponent(target.sessionId)}`
      : `?workspaceId=${encodeURIComponent(target.workspaceId)}`

/** 经 requestJson（错误体与响应在信任边界按 schema 校验）。 */
export function httpLspBackend(fetchImpl?: Fetch): LspBackend {
  return {
    get: (target) => requestJson(LspResponse, 'GET', `${lspPaths.lsp}${query(target)}`, undefined, fetchImpl),
    update: (scope, servers, expectedRevision) => requestJson(LspResponse, 'PUT', lspPaths.lsp, { scope, servers, expectedRevision }, fetchImpl),
    restart: async (name, cwd) => {
      await requestJson(NoContent, 'POST', lspPaths.restart, { name, ...(cwd === undefined ? {} : { cwd }) }, fetchImpl)
    },
  }
}

/** chat-store 的 progress 订阅（onProgress）。 */
export interface LspProgressSource {
  onProgress(listener: (progress: { sessionId: string; runId: string; event: ProgressEvent }) => void): () => void
}

export interface LspState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  view: LspResponse | undefined
  target: LspTarget | undefined
  error: ApiError | undefined
  load(target?: LspTarget): Promise<void>
  /** 保存一个作用域；revision 冲突时读回最新值并抛出（界面提示后由用户重试），400 时抛出（details.diagnostics）。 */
  save(scope: LspScope, servers: LspServersConfig): Promise<void>
  /** 重启（按名字与工作目录），之后读回。 */
  restart(name: string, cwd?: string): Promise<void>
  /** 订阅 lsp_update：当前会话的进度替换状态列表；返回取消订阅。 */
  attach(source: LspProgressSource): () => void
}

const keyOf = (target: LspTarget | undefined) => query(target)
const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

export function createLspStore(backend: LspBackend = httpLspBackend()): StoreApi<LspState> {
  return createStore<LspState>()((set, get) => ({
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
    async save(scope, servers) {
      const view = get().view
      const workspaceId = view?.workspace?.workspaceId
      if (scope === 'workspace' && workspaceId === undefined) throw new ApiError('bad-request', 'No workspace', 400)
      const revision = scope === 'global' ? (view?.global.revision ?? 0) : (view?.workspace?.revision ?? 0)
      try {
        await backend.update(scope === 'global' ? 'global' : { workspaceId: workspaceId! }, servers, revision)
        set({ error: undefined })
        await get().load(get().target)
      } catch (error) {
        const failure = asApiError(error)
        set({ error: failure })
        if (failure.code === 'revision-conflict') await get().load(get().target)
        throw failure
      }
    },
    async restart(name, cwd) {
      try {
        await backend.restart(name, cwd)
      } finally {
        await get().load(get().target)
      }
    },
    attach(source) {
      return source.onProgress(({ sessionId, event }) => {
        if (event.type !== 'lsp_update') return
        const { target, view } = get()
        if (!view || !target || !('sessionId' in target) || target.sessionId !== sessionId) return
        set({ view: { ...view, status: event.servers } })
      })
    },
  }))
}

/** 应用内共用的 store（设置 → 代码智能分区经 zustand 的 useStore 订阅）。 */
export const lspStore: StoreApi<LspState> = createLspStore()

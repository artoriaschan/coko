import { contextPaths, ContextUsageResponse } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { targetKey, type CommandTarget } from './commands-store.ts'

/** 上下文用量的作用域：会话，或还没有会话的 Workspace 草稿（与命令目录相同）。 */
export type ContextTarget = CommandTarget

export interface ContextState {
  /** 最近一次读取对应的作用域。 */
  key: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  usage: ContextUsageResponse | null
}

export interface ContextActions {
  /**
   * 读取该作用域的用量（Sidecar 每次重新计算）。切换作用域时先清空；同一作用域刷新失败时保留上次的值并记为 error。
   * 较早发出的请求晚到时被丢弃。
   */
  load(target: ContextTarget): Promise<void>
}

export type ContextStore = StoreApi<ContextState & ContextActions>

export type FetchContextUsage = (target: ContextTarget) => Promise<ContextUsageResponse>

/** GET /api/sessions/:id/context 或 /api/workspaces/:id/context：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function httpFetchContextUsage(fetchImpl: (input: string) => Promise<Response> = (input) => fetch(input)): FetchContextUsage {
  return async (target) => {
    const path = 'sessionId' in target ? contextPaths.session(target.sessionId) : contextPaths.workspace(target.workspaceId)
    const response = await fetchImpl(path)
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !Value.Check(ContextUsageResponse, value)) throw new Error(`GET ${path} failed with status ${response.status}`)
    return value
  }
}

/** 上下文用量的 vanilla store（无 React 依赖）：输入区底栏的上下文环读取它。 */
export function createContextStore(fetchUsage: FetchContextUsage = httpFetchContextUsage()): ContextStore {
  let latest = 0
  return createStore<ContextState & ContextActions>()((set, get) => ({
    key: null,
    status: 'idle',
    usage: null,
    async load(target) {
      const key = targetKey(target)
      const request = ++latest
      if (get().key !== key) set({ key, status: 'loading', usage: null })
      else set({ status: 'loading' })
      try {
        const usage = await fetchUsage(target)
        if (request === latest) set({ status: 'ready', usage })
      } catch {
        if (request === latest) set({ status: 'error' })
      }
    },
  }))
}

/** 应用内共用的 store。 */
export const contextStore: ContextStore = createContextStore()

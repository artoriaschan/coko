import { ConfigResponse, configPaths } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface ConfigState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读取对应的 Workspace；没有 Workspace 时为 null（只有全局）。 */
  workspaceId: string | null
  config: ConfigResponse | null
}

export interface ConfigActions {
  /** 读取有效配置与该 Workspace 的项目设置文件（Sidecar 每次请求按 mtime 读文件）。较早发出的请求晚到时被丢弃。 */
  load(workspaceId?: string): Promise<void>
}

export type ConfigStore = StoreApi<ConfigState & ConfigActions>

export type FetchConfig = (workspaceId?: string) => Promise<ConfigResponse>

/** GET /api/config：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function httpFetchConfig(fetchImpl: (input: string) => Promise<Response> = (input) => fetch(input)): FetchConfig {
  return async (workspaceId) => {
    const path = workspaceId === undefined ? configPaths.config : `${configPaths.config}?workspaceId=${encodeURIComponent(workspaceId)}`
    const response = await fetchImpl(path)
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !Value.Check(ConfigResponse, value)) throw new Error(`GET ${path} failed with status ${response.status}`)
    return value
  }
}

/** 能力配置的 vanilla store（无 React 依赖）：设置弹窗的项目设置行与之后的能力开关读取它。 */
export function createConfigStore(fetchConfig: FetchConfig = httpFetchConfig()): ConfigStore {
  let latest = 0
  return createStore<ConfigState & ConfigActions>()((set) => ({
    status: 'idle',
    workspaceId: null,
    config: null,
    async load(workspaceId) {
      const request = ++latest
      set((state) => ({ status: state.workspaceId === (workspaceId ?? null) && state.config ? state.status : 'loading', workspaceId: workspaceId ?? null }))
      try {
        const config = await fetchConfig(workspaceId)
        if (request === latest) set({ status: 'ready', config })
      } catch {
        if (request === latest) set({ status: 'error' })
      }
    },
  }))
}

/** 应用内共用的 store（设置分区经 zustand 的 useStore 订阅）。 */
export const configStore: ConfigStore = createConfigStore()

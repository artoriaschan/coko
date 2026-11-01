import { PluginInfo, PluginListResponse, pluginPaths, type PluginSource } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 插件（ADR 0017）的视图 store：GET /api/plugins 的列表，安装、批准、启停、更新与卸载。设置 → 插件分区经 zustand 的 useStore 订阅。
// 请求经 requestJson：响应按 PluginInfo 校验，错误体按 ErrorResponse 校验（不合法为 bad-response）。

export interface PluginsBackend {
  list(): Promise<PluginListResponse>
  install(source: PluginSource): Promise<PluginInfo>
  approve(name: string, digest: string): Promise<PluginInfo>
  setEnabled(name: string, enabled: boolean): Promise<PluginInfo>
  update(name: string): Promise<PluginInfo>
  uninstall(name: string): Promise<void>
}

const NoContent = Type.Undefined()

export function httpPluginsBackend(fetchImpl?: Fetch): PluginsBackend {
  return {
    list: () => requestJson(PluginListResponse, 'GET', pluginPaths.plugins, undefined, fetchImpl),
    install: (source) => requestJson(PluginInfo, 'POST', pluginPaths.plugins, { source }, fetchImpl),
    approve: (name, digest) => requestJson(PluginInfo, 'POST', pluginPaths.approve(name), { digest }, fetchImpl),
    setEnabled: (name, enabled) => requestJson(PluginInfo, 'PATCH', pluginPaths.plugin(name), { enabled }, fetchImpl),
    update: (name) => requestJson(PluginInfo, 'POST', pluginPaths.update(name), undefined, fetchImpl),
    uninstall: async (name) => {
      await requestJson(NoContent, 'DELETE', pluginPaths.plugin(name), undefined, fetchImpl)
    },
  }
}

export interface PluginsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  plugins: PluginInfo[]
  /** 最近一次读取失败（有内容时保留内容）。 */
  error: ApiError | undefined
  load(): Promise<void>
  /** 安装后状态为 needs-approval；失败时抛 ApiError（plugin-invalid 的诊断在 details.diagnostics）。 */
  install(source: PluginSource): Promise<PluginInfo>
  /** digest 与当前不同（409 digest-mismatch）时读回列表并抛出。 */
  approve(name: string, digest: string): Promise<PluginInfo>
  setEnabled(name: string, enabled: boolean): Promise<PluginInfo>
  /** 按原来源重新取；digestChanged 为 true 时插件回到 needs-approval。 */
  update(name: string): Promise<{ plugin: PluginInfo; digestChanged: boolean }>
  uninstall(name: string): Promise<void>
}

const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

/** 记录与当前列表不一致的失败：读回列表后再抛出。 */
const STALE = new Set(['digest-mismatch', 'plugin-not-found', 'plugin-exists'])

export function createPluginsStore(backend: PluginsBackend = httpPluginsBackend()): StoreApi<PluginsState> {
  let latest = 0
  return createStore<PluginsState>()((set, get) => {
    const upsert = (plugin: PluginInfo) => {
      latest++
      const plugins = get().plugins
      const index = plugins.findIndex((p) => p.name === plugin.name)
      set({ status: 'ready', plugins: index === -1 ? [...plugins, plugin] : plugins.map((p, i) => (i === index ? plugin : p)) })
      return plugin
    }
    const mutate = async <T>(task: () => Promise<T>): Promise<T> => {
      try {
        return await task()
      } catch (error) {
        const failure = asApiError(error)
        if (STALE.has(failure.code)) await get().load()
        throw failure
      }
    }
    return {
      status: 'idle',
      plugins: [],
      error: undefined,
      async load() {
        const request = ++latest
        if (get().status !== 'ready') set({ status: 'loading' })
        try {
          const plugins = await backend.list()
          if (request === latest) set({ status: 'ready', plugins, error: undefined })
        } catch (error) {
          if (request === latest) set({ status: get().plugins.length > 0 ? 'ready' : 'error', error: asApiError(error) })
        }
      },
      install: (source) => mutate(async () => upsert(await backend.install(source))),
      approve: (name, digest) => mutate(async () => upsert(await backend.approve(name, digest))),
      setEnabled: (name, enabled) => mutate(async () => upsert(await backend.setEnabled(name, enabled))),
      update: (name) =>
        mutate(async () => {
          const before = get().plugins.find((p) => p.name === name)?.digest
          const plugin = upsert(await backend.update(name))
          return { plugin, digestChanged: before !== undefined && before !== plugin.digest }
        }),
      uninstall: (name) =>
        mutate(async () => {
          await backend.uninstall(name)
          latest++
          set({ plugins: get().plugins.filter((p) => p.name !== name) })
        }),
    }
  })
}

/** 应用内共用的 store。 */
export const pluginsStore: StoreApi<PluginsState> = createPluginsStore()

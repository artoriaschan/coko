import { ConfigResponse, configPaths, ErrorResponse, type CapabilityConfig, type CapabilityConfigValues } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** 能力开关：设置界面可切换的全局键（PUT /api/config 整体替换全局值，项目只能关闭，ADR 0008）。 */
export type CapabilitySwitch =
  | 'instructions.enabled'
  | 'skills.enabled'
  | 'commands.enabled'
  | 'mcp.enabled'
  | 'memory.enabled'
  | 'context.autoCompact'
  | 'context.trimOldToolResults'

interface SwitchAccess {
  /** 全局值（省略即默认开）。 */
  global(values: CapabilityConfigValues): boolean
  effective(config: CapabilityConfig): boolean
  /** 改写全局值中的这一个键，其余原样。 */
  set(values: CapabilityConfigValues, on: boolean): CapabilityConfigValues
}

const section = <S extends keyof CapabilityConfig, K extends keyof CapabilityConfig[S] & string>(name: S, key: K): SwitchAccess => ({
  global: (values) => (values[name] as Record<string, unknown> | undefined)?.[key] !== false,
  effective: (config) => config[name][key] === true,
  set: (values, on) => ({ ...values, [name]: { ...values[name], [key]: on } }),
})

export const CAPABILITY_SWITCHES: Record<CapabilitySwitch, SwitchAccess> = {
  'instructions.enabled': section('instructions', 'enabled'),
  'skills.enabled': section('skills', 'enabled'),
  'commands.enabled': section('commands', 'enabled'),
  'mcp.enabled': section('mcp', 'enabled'),
  'memory.enabled': section('memory', 'enabled'),
  'context.autoCompact': section('context', 'autoCompact'),
  'context.trimOldToolResults': section('context', 'trimOldToolResults'),
}

/** GET 与 PUT /api/config：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function createConfigClient(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  const scoped = (workspaceId?: string) =>
    workspaceId === undefined ? configPaths.config : `${configPaths.config}?workspaceId=${encodeURIComponent(workspaceId)}`
  async function call(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<ConfigResponse> {
    const response = await fetchImpl(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const code = Value.Check(ErrorResponse, value) ? value.error.code : 'bad-response'
      throw new Error(`${method} ${path} failed with status ${response.status} (${code})`)
    }
    if (!Value.Check(ConfigResponse, value)) throw new Error(`Unexpected response for ${method} ${path}`)
    return value
  }
  return {
    get: (workspaceId?: string) => call('GET', scoped(workspaceId)),
    /** 读取全局值与 revision 后整体替换（PUT /api/config 只接受整份全局值，其他全局键原样带回）。 */
    async update(change: (global: CapabilityConfigValues) => CapabilityConfigValues, workspaceId?: string): Promise<ConfigResponse> {
      const current = await call('GET', scoped(workspaceId))
      return call('PUT', configPaths.config, {
        values: change(current.global),
        expectedRevision: current.globalRevision,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      })
    },
  }
}

export type ConfigClient = ReturnType<typeof createConfigClient>

export interface ConfigState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读取对应的 Workspace；没有 Workspace 时为 null（只有全局）。 */
  workspaceId: string | null
  config: ConfigResponse | null
}

export interface ConfigActions {
  /** 读取有效配置与该 Workspace 的项目设置文件（Sidecar 每次请求按 mtime 读文件）。较早发出的请求晚到时被丢弃。 */
  load(workspaceId?: string): Promise<void>
  /** 写入一个能力开关的全局值后重新读取（当前 Workspace）；失败时抛出，状态不变。 */
  setSwitch(name: CapabilitySwitch, on: boolean): Promise<void>
}

export type ConfigStore = StoreApi<ConfigState & ConfigActions>

/** 能力配置的 vanilla store（无 React 依赖）：设置弹窗的项目设置行与能力开关读取它。 */
export function createConfigStore(client: Pick<ConfigClient, 'get' | 'update'> = createConfigClient()): ConfigStore {
  let latest = 0
  return createStore<ConfigState & ConfigActions>()((set, get) => ({
    status: 'idle',
    workspaceId: null,
    config: null,
    async load(workspaceId) {
      const request = ++latest
      set((state) => ({ status: state.workspaceId === (workspaceId ?? null) && state.config ? state.status : 'loading', workspaceId: workspaceId ?? null }))
      try {
        const config = await client.get(workspaceId)
        if (request === latest) set({ status: 'ready', config })
      } catch {
        if (request === latest) set({ status: 'error' })
      }
    },
    async setSwitch(name, on) {
      const workspaceId = get().workspaceId ?? undefined
      await client.update((global) => CAPABILITY_SWITCHES[name].set(global, on), workspaceId)
      await get().load(workspaceId)
    },
  }))
}

/** 应用内共用的 store（设置分区经 zustand 的 useStore 订阅）。 */
export const configStore: ConfigStore = createConfigStore()

import { DEFAULT_DEVELOPER_SETTINGS, DEVELOPER_SETTING, DeveloperSettings } from '@coko/protocol'
import { Value } from 'typebox/value'
import type { AvailableModel, CatalogModel, ModelProtocol, PermissionsResponse, Provider, SessionModel, UpdatePermissionsRequest } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { CokoBridge, FetchProviderModelsInput, FetchProviderModelsResult, SaveProviderResult } from '../../shared/bridge.ts'

/** 服务端已确认的设置值及其 revision；未保存过的键不在其中（revision 视为 0）。 */
export interface KnownSetting {
  value: unknown
  revision: number
}

export interface SettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  values: Record<string, KnownSetting>
  /** 开发者设置的界面选择；保存失败或冲突时保留，values 仍是服务端确认值。 */
  developer: DeveloperSettings
  providers: Provider[]
  models: AvailableModel[]
  defaultModel: SessionModel | null
  /** 默认模式与全局规则（及最近读取的 Workspace 规则）；读取前为 null。 */
  permissions: PermissionsResponse | null
}

/** 去掉 expectedRevision 的修改；store 按已知 revision 补上。 */
export type PermissionsChange =
  | Omit<Extract<UpdatePermissionsRequest, { target: 'defaultMode' }>, 'expectedRevision'>
  | Omit<Extract<UpdatePermissionsRequest, { target: 'global' }>, 'expectedRevision'>
  | Omit<Extract<UpdatePermissionsRequest, { target: 'workspace' }>, 'expectedRevision'>

export type SaveSettingResult = { status: 'saved' } | { status: 'conflict' } | { status: 'failed'; error: ApiError }

/** 设置页中编辑的 Provider；编辑时 secret 为空表示保留原 Credential。 */
export interface ProviderDraft {
  /** 新建时为用户输入的 Provider ID；编辑时为已有 Provider 的 ID（创建后不可修改）。 */
  id: string
  isNew: boolean
  name: string
  api: ModelProtocol
  baseUrl: string
  incrementalTools?: boolean
  models: CatalogModel[]
  secret: string
}

/** 一次提交的结果；失败时配置与 Key 都没有写入，界面保留草稿（ADR 0010）。 */
export type { SaveProviderResult }

export interface SettingsActions {
  /** 读取设置、Provider 与可用模型。 */
  load(): Promise<void>
  /** 以已知 revision 写入；同一键的写入按调用顺序串行。冲突时读回服务端的值与 revision。 */
  saveSetting(key: string, value: unknown): Promise<SaveSettingResult>
  setDeveloperSettings(value: DeveloperSettings): Promise<SaveSettingResult>
  saveProvider(draft: ProviderDraft): Promise<SaveProviderResult>
  /** 获取供应商的可用模型（ADR 0010）：表单中的 Key 只用于这一次请求；编辑时 Key 留空用已保存的 Credential。不改变 store。 */
  fetchProviderModels(input: FetchProviderModelsInput): Promise<FetchProviderModelsResult>
  /** 取消进行中的获取；对应的 fetchProviderModels 以 cancelled 结束。 */
  cancelProviderModels(requestKey: string): void
  /**
   * 引用该 Provider 的 Session 数量；失败时抛出 ApiError（ApiClient 已把各种失败转为 ApiError），不经 onFailure。直接转发：
   * 组件只经 store 访问 Sidecar，不持有 ApiClient；删除确认在自己的区域显示读取失败与重试。
   */
  providerReferences(id: string): Promise<{ sessions: number }>
  /** 同时删除其 Credential，引用它的 Session 模型字段被清空。返回是否已删除。 */
  deleteProvider(id: string): Promise<boolean>
  /** 读取默认模式与全局规则；给出 workspaceId 时另带该 Workspace 的规则。 */
  loadPermissions(workspaceId?: string): Promise<void>
  /** 按已知 revision 修改一项；同一 store 的修改串行。冲突时读回最新值。 */
  savePermissions(change: PermissionsChange): Promise<SaveSettingResult>
}

export type SettingsStore = StoreApi<SettingsState & SettingsActions>

export interface SettingsStoreOptions {
  api: ApiClient
  /** preload 的一次提交通道；不在桌面窗口中时缺省。 */
  saveProvider?: CokoBridge['saveProvider']
  /** preload 的获取可用模型通道；不在桌面窗口中时缺省。 */
  providerModels?: Pick<CokoBridge, 'fetchProviderModels' | 'cancelProviderModels'> | undefined
  onFailure?: (error: ApiError) => void
  /** Provider 删除成功后调用：引用它的 Session 模型字段已在 Sidecar 清空，会话列表需要重新读取。 */
  onProviderDeleted?: (id: string) => void
}

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

const toValues = (settings: { key: string; value: unknown; revision: number }[]) =>
  Object.fromEntries(settings.map((s) => [s.key, { value: s.value, revision: s.revision }]))

/** 设置与 Provider 的 vanilla store（无 React 依赖）。Provider 与密钥经 preload 交给 main 一次提交，不经 HTTP（ADR 0004、0010）。 */
export function createSettingsStore({ api, saveProvider: submitProvider, providerModels, onFailure, onProviderDeleted }: SettingsStoreOptions): SettingsStore {
  let developerTouched = false
  const chains = new Map<string, Promise<unknown>>()

  return createStore<SettingsState & SettingsActions>()((set, get) => {
    const refreshProviders = async () => {
      const [providers, { models, defaultModel }] = await Promise.all([api.listProviders(), api.listModels()])
      set({ providers, models, defaultModel })
    }

    const putSetting = async (key: string, value: unknown): Promise<SaveSettingResult> => {
      const expected = get().values[key]?.revision ?? 0
      try {
        const saved = await api.putSetting(key, value, expected)
        set((state) => ({ values: { ...state.values, [key]: { value: saved.value, revision: saved.revision } } }))
        return { status: 'saved' }
      } catch (error) {
        const apiError = toApiError(error)
        if (apiError.code !== 'revision-conflict') return { status: 'failed', error: apiError }
        // 读回服务端的当前值与 revision，下一次保存基于它。
        try {
          set({ values: toValues(await api.listSettings()) })
        } catch {
          const actual = apiError.details?.actual
          if (typeof actual === 'number') set((state) => ({ values: { ...state.values, [key]: { value: state.values[key]?.value, revision: actual } } }))
        }
        return { status: 'conflict' }
      }
    }

    let permissionChain: Promise<unknown> = Promise.resolve()
    const expectedRevision = (change: PermissionsChange): number => {
      const known = get().permissions
      if (change.target === 'defaultMode') return known?.defaultMode.revision ?? 0
      if (change.target === 'global') return known?.global.revision ?? 0
      return known?.workspace?.workspaceId === change.workspaceId ? known.workspace.revision : 0
    }
    const putPermissions = async (change: PermissionsChange): Promise<SaveSettingResult> => {
      const workspaceId = change.target === 'workspace' ? change.workspaceId : get().permissions?.workspace?.workspaceId
      try {
        const saved = await api.updatePermissions({ ...change, expectedRevision: expectedRevision(change) } as UpdatePermissionsRequest)
        // 响应只带被修改的 Workspace（及其项目规则）；保留已知的其他部分。
        set((state) => {
          const known = saved.workspace
            ? {}
            : {
                ...(state.permissions?.workspace ? { workspace: state.permissions.workspace } : {}),
                ...(state.permissions?.project ? { project: state.permissions.project } : {}),
              }
          return { permissions: { ...saved, ...known } }
        })
        return { status: 'saved' }
      } catch (error) {
        const apiError = toApiError(error)
        if (apiError.code !== 'revision-conflict') return { status: 'failed', error: apiError }
        await get()
          .loadPermissions(workspaceId)
          .catch(() => undefined)
        return { status: 'conflict' }
      }
    }

    return {
      status: 'idle',
      values: {},
      developer: { ...DEFAULT_DEVELOPER_SETTINGS },
      providers: [],
      models: [],
      defaultModel: null,
      permissions: null,

      async loadPermissions(workspaceId) {
        try {
          set({ permissions: await api.getPermissions(workspaceId) })
        } catch (error) {
          onFailure?.(toApiError(error))
        }
      },

      savePermissions(change) {
        const next = permissionChain.then(() => putPermissions(change))
        permissionChain = next
        return next
      },

      async load() {
        if (get().status !== 'ready') set({ status: 'loading' })
        try {
          const [settings, providers, { models, defaultModel }] = await Promise.all([api.listSettings(), api.listProviders(), api.listModels()])
          const storedDeveloper = settings.find((setting) => setting.key === DEVELOPER_SETTING)?.value
          const developer = Value.Check(DeveloperSettings, storedDeveloper) ? storedDeveloper : { ...DEFAULT_DEVELOPER_SETTINGS }
          set({ status: 'ready', values: toValues(settings), providers, models, defaultModel, ...(!developerTouched ? { developer } : {}) })
          void get().loadPermissions(get().permissions?.workspace?.workspaceId)
        } catch (error) {
          if (get().status !== 'ready') set({ status: 'error' })
          onFailure?.(toApiError(error))
        }
      },

      saveSetting(key, value) {
        const previous = chains.get(key) ?? Promise.resolve()
        const next = previous.then(() => putSetting(key, value))
        chains.set(key, next)
        return next
      },

      setDeveloperSettings(developer) {
        developerTouched = true
        set({ developer })
        return get().saveSetting(DEVELOPER_SETTING, developer)
      },

      async saveProvider(draft) {
        if (!submitProvider) return { ok: false, code: 'sidecar-unavailable', message: 'Desktop bridge is unavailable' }
        const { id, name, api: protocol, baseUrl, models, secret, incrementalTools } = draft
        const result = await submitProvider({
          mode: draft.isNew ? 'create' : 'update',
          provider: { id, name, api: protocol, baseUrl, models, ...(incrementalTools === undefined ? {} : { incrementalTools }) },
          ...(secret === '' ? {} : { secret }),
        }).catch((error: unknown): SaveProviderResult => ({
          ok: false,
          code: 'sidecar-unavailable',
          message: error instanceof Error ? error.message : String(error),
        }))
        if (!result.ok) return result
        await refreshProviders().catch((error: unknown) => onFailure?.(toApiError(error)))
        return { ok: true, provider: get().providers.find((p) => p.id === result.provider.id) ?? result.provider }
      },

      async fetchProviderModels(input) {
        if (!providerModels) return { ok: false, code: 'sidecar-unavailable', message: 'Desktop bridge is unavailable' }
        return providerModels.fetchProviderModels(input).catch((error: unknown): FetchProviderModelsResult => ({
          ok: false,
          code: 'sidecar-unavailable',
          message: error instanceof Error ? error.message : String(error),
        }))
      },

      cancelProviderModels(requestKey) {
        providerModels?.cancelProviderModels(requestKey)
      },

      providerReferences: (id) => api.providerReferences(id),

      async deleteProvider(id) {
        try {
          await api.deleteProvider(id)
        } catch (error) {
          onFailure?.(toApiError(error))
          return false
        }
        onProviderDeleted?.(id)
        await refreshProviders().catch((error: unknown) => onFailure?.(toApiError(error)))
        return true
      },
    }
  })
}

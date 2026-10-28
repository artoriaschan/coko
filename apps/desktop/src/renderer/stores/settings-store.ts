import type { AvailableModel, Provider, ProviderKind, ProviderPreset, SessionModel } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { CokoBridge, CredentialErrorCode } from '../../shared/bridge.ts'

/** 服务端已确认的设置值及其 revision；未保存过的键不在其中（revision 视为 0）。 */
export interface KnownSetting {
  value: unknown
  revision: number
}

export interface SettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  values: Record<string, KnownSetting>
  providers: Provider[]
  presets: ProviderPreset[]
  models: AvailableModel[]
  defaultModel: SessionModel | null
}

export type SaveSettingResult = { status: 'saved' } | { status: 'conflict' } | { status: 'failed'; error: ApiError }

/** 设置弹窗中编辑的 Provider；secret 为空表示不改 Credential。 */
export interface ProviderDraft {
  /** 编辑已有 Provider 时给出；kind 创建后不可改。 */
  id?: string
  kind: ProviderKind
  name: string
  /** 预设 kind 留空表示使用预设地址。 */
  baseUrl: string
  models: string[]
  secret: string
}

export type SaveProviderResult =
  | { ok: true; provider: Provider }
  | { ok: false; stage: 'provider'; error: ApiError }
  /** 配置已保存，Credential 未保存：界面转为编辑该 Provider 并保留输入。 */
  | { ok: false; stage: 'credential'; code: CredentialErrorCode; message: string; provider: Provider }

export interface SettingsActions {
  /** 读取设置、Provider、预设与可用模型。 */
  load(): Promise<void>
  /** 以已知 revision 写入；同一键的写入按调用顺序串行。冲突时读回服务端的值与 revision。 */
  saveSetting(key: string, value: unknown): Promise<SaveSettingResult>
  saveProvider(draft: ProviderDraft): Promise<SaveProviderResult>
  /** 返回是否已删除。 */
  deleteProvider(id: string): Promise<boolean>
}

export type SettingsStore = StoreApi<SettingsState & SettingsActions>

export interface SettingsStoreOptions {
  api: ApiClient
  /** preload 的 Credential 通道；不在桌面窗口中时缺省。 */
  setCredential?: CokoBridge['setCredential']
  onFailure?: (error: ApiError) => void
}

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

const toValues = (settings: { key: string; value: unknown; revision: number }[]) =>
  Object.fromEntries(settings.map((s) => [s.key, { value: s.value, revision: s.revision }]))

/** 设置与 Provider 的 vanilla store（无 React 依赖）。密钥经 preload 交给 main，不经 HTTP（ADR 0004）。 */
export function createSettingsStore({ api, setCredential, onFailure }: SettingsStoreOptions): SettingsStore {
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

    return {
      status: 'idle',
      values: {},
      providers: [],
      presets: [],
      models: [],
      defaultModel: null,

      async load() {
        if (get().status !== 'ready') set({ status: 'loading' })
        try {
          const [settings, providers, presets, { models, defaultModel }] = await Promise.all([
            api.listSettings(),
            api.listProviders(),
            api.listProviderPresets(),
            api.listModels(),
          ])
          set({ status: 'ready', values: toValues(settings), providers, presets, models, defaultModel })
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

      async saveProvider(draft) {
        let provider: Provider
        try {
          provider =
            draft.id === undefined
              ? await api.createProvider({ kind: draft.kind, name: draft.name, models: draft.models, ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}) })
              : await api.updateProvider(draft.id, { name: draft.name, baseUrl: draft.baseUrl, models: draft.models })
        } catch (error) {
          return { ok: false, stage: 'provider', error: toApiError(error) }
        }
        let credentialFailure: { code: CredentialErrorCode; message: string } | undefined
        if (draft.secret !== '') {
          const result = setCredential
            ? await setCredential(provider.id, draft.secret).catch((error: unknown) => ({
                ok: false as const,
                code: 'sidecar-unavailable' as const,
                message: error instanceof Error ? error.message : String(error),
              }))
            : { ok: false as const, code: 'sidecar-unavailable' as const, message: 'Desktop bridge is unavailable' }
          if (!result.ok) credentialFailure = { code: result.code, message: result.message }
        }
        await refreshProviders().catch((error: unknown) => onFailure?.(toApiError(error)))
        const latest = get().providers.find((p) => p.id === provider.id) ?? provider
        if (credentialFailure) return { ok: false, stage: 'credential', ...credentialFailure, provider: latest }
        return { ok: true, provider: latest }
      },

      async deleteProvider(id) {
        try {
          await api.deleteProvider(id)
        } catch (error) {
          onFailure?.(toApiError(error))
          return false
        }
        await refreshProviders().catch((error: unknown) => onFailure?.(toApiError(error)))
        return true
      },
    }
  })
}

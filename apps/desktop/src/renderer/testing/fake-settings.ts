// 单元测试与 Browser Mode 共用：按 Sidecar 规则实现设置 revision 与 Provider 的内存后端。
import {
  MODEL_CATALOG_DEFAULTS,
  THINKING_LEVELS,
  type AvailableModel,
  type CatalogModel,
  type PermissionsResponse,
  type Provider,
  type ProviderFields,
  type Setting,
} from '@coko/protocol'
import { vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { CokoBridge } from '../../shared/bridge.ts'

type Api = ApiClient

export function fakeSettingsBackend() {
  const settings = new Map<string, Setting>()
  const providers: Provider[] = []
  /** 引用各 Provider 的 Session 数量（setReferences 设置；删除时归零）。 */
  const references = new Map<string, number>()
  const permissions: PermissionsResponse = { defaultMode: { value: 'default', revision: 0 }, global: { rules: [], revision: 0 } }
  const workspaceRules = new Map<string, { rules: PermissionsResponse['global']['rules']; revision: number }>()
  const permissionsOf = (workspaceId?: string): PermissionsResponse => ({
    ...structuredClone(permissions),
    ...(workspaceId ? { workspace: { workspaceId, ...structuredClone(workspaceRules.get(workspaceId) ?? { rules: [], revision: 0 }) } } : {}),
  })
  // 与 Sidecar 一致：会话可选的档位为 off，推理开关打开时再加上已配置的档位（固定顺序）。
  const selectable = (m: CatalogModel) =>
    THINKING_LEVELS.filter((level) => level === 'off' || (m.reasoning && m.thinkingLevels.some((configured) => configured.level === level)))
  const models = (): AvailableModel[] =>
    providers.flatMap((p) =>
      p.models.map((m) => ({ providerId: p.id, providerName: p.name, modelId: m.id, name: m.name || m.id, thinkingLevels: selectable(m) })),
    )
  const api = {
    listSettings: vi.fn<Api['listSettings']>(async () => [...settings.values()]),
    putSetting: vi.fn<Api['putSetting']>(async (key, value, expectedRevision) => {
      const actual = settings.get(key)?.revision ?? 0
      if (actual !== expectedRevision) throw new ApiError('revision-conflict', 'conflict', 409, { expected: expectedRevision, actual })
      const next = { key, value, revision: actual + 1, updatedAt: 1 }
      settings.set(key, next)
      return next
    }),
    listProviders: vi.fn<Api['listProviders']>(async () => [...providers]),
    listModels: vi.fn<Api['listModels']>(async () => {
      const list = models()
      return { models: list, defaultModel: list[0] ? { providerId: list[0].providerId, modelId: list[0].modelId } : null }
    }),
    getPermissions: vi.fn<Api['getPermissions']>(async (workspaceId) => permissionsOf(workspaceId)),
    updatePermissions: vi.fn<Api['updatePermissions']>(async (request) => {
      const current =
        request.target === 'defaultMode'
          ? permissions.defaultMode.revision
          : request.target === 'global'
            ? permissions.global.revision
            : (workspaceRules.get(request.workspaceId)?.revision ?? 0)
      if (current !== request.expectedRevision)
        throw new ApiError('revision-conflict', 'conflict', 409, { expected: request.expectedRevision, actual: current })
      if (request.target === 'defaultMode') permissions.defaultMode = { value: request.value, revision: current + 1 }
      else if (request.target === 'global') permissions.global = { rules: request.rules, revision: current + 1 }
      else workspaceRules.set(request.workspaceId, { rules: request.rules, revision: current + 1 })
      return permissionsOf(request.target === 'workspace' ? request.workspaceId : undefined)
    }),
    providerReferences: vi.fn<Api['providerReferences']>(async (id) => {
      if (!providers.some((p) => p.id === id)) throw new ApiError('not-found', 'missing', 404)
      return { sessions: references.get(id) ?? 0 }
    }),
    deleteProvider: vi.fn<Api['deleteProvider']>(async (id) => {
      const index = providers.findIndex((p) => p.id === id)
      if (index < 0) throw new ApiError('not-found', 'missing', 404)
      providers.splice(index, 1)
      references.delete(id)
      return undefined
    }),
  }
  /** 模拟另一处写入（另一窗口、另一进程）。 */
  const externalWrite = (key: string, value: unknown) => {
    const revision = (settings.get(key)?.revision ?? 0) + 1
    settings.set(key, { key, value, revision, updatedAt: 2 })
  }
  /** 已有的 Provider（不经 saveProvider，不计入调用）；secret 给出时记为已配置 Key。 */
  const seedProvider = (fields: ProviderFields, secret?: string) => {
    providers.push({ ...structuredClone(fields), credential: secret ? { hint: secret.slice(-4) } : null, createdAt: 1, updatedAt: 1 })
  }
  /** 模拟 main 与 Sidecar 的一次提交（ADR 0010）：新建必须带 Key；失败时什么都不写；只记录提示。 */
  const saveProvider = vi.fn<CokoBridge['saveProvider']>(async ({ mode, provider: fields, secret }) => {
    const index = providers.findIndex((p) => p.id === fields.id)
    if (mode === 'create' && secret === undefined) return { ok: false, code: 'invalid-input', message: 'An API key is required for a new Provider' }
    if (mode === 'create' && index >= 0)
      return { ok: false, code: 'already-exists', message: `Provider ID ${fields.id} is already in use`, details: { field: 'id', id: fields.id } }
    if (mode === 'update' && index < 0) return { ok: false, code: 'not-found', message: 'missing' }
    const credential = secret !== undefined ? { hint: secret.slice(-4) } : (providers[index]?.credential ?? null)
    const provider: Provider = { ...structuredClone(fields), credential, createdAt: 1, updatedAt: 1 }
    if (index >= 0) providers[index] = provider
    else providers.push(provider)
    return { ok: true, provider }
  })
  /** 设置引用某 Provider 的 Session 数量（providerReferences 的返回值）。 */
  const setReferences = (id: string, sessions: number) => void references.set(id, sessions)
  /** 供应商返回的候选模型 ID（fetchProviderModels 的默认结果）。 */
  let candidates: string[] = []
  const setCandidates = (ids: string[]) => void (candidates = [...ids])
  /** 进行中的获取：cancelProviderModels 以 cancelled 结束它们（与 main 一致）。 */
  const pendingFetches = new Map<string, (result: Awaited<ReturnType<CokoBridge['fetchProviderModels']>>) => void>()
  /**
   * 模拟 main 与 Sidecar 的获取可用模型：没有 Key 时用 providerId 已保存的 Credential，没有则 no-credential。测试可用
   * mockImplementationOnce 返回失败、空列表或用 holdFetch 挂起。
   */
  const fetchProviderModels = vi.fn<CokoBridge['fetchProviderModels']>(async ({ providerId, secret }) => {
    const saved = providerId !== undefined && providers.find((p) => p.id === providerId)?.credential
    if (!secret && !saved) return { ok: false, code: 'no-credential', message: 'No API key is available for this provider' }
    return { ok: true, models: [...candidates] }
  })
  /** 让下一次获取挂起，直到 cancelProviderModels 或返回的 resolve 结束它。 */
  const holdFetch = () => {
    let resolve!: (result: Awaited<ReturnType<CokoBridge['fetchProviderModels']>>) => void
    fetchProviderModels.mockImplementationOnce(
      ({ requestKey }) =>
        new Promise((r) => {
          resolve = r
          pendingFetches.set(requestKey, r)
        }),
    )
    return (result: Awaited<ReturnType<CokoBridge['fetchProviderModels']>>) => resolve(result)
  }
  const cancelProviderModels = vi.fn<CokoBridge['cancelProviderModels']>((requestKey) => {
    pendingFetches.get(requestKey)?.({ ok: false, code: 'cancelled', message: 'Cancelled' })
    pendingFetches.delete(requestKey)
  })
  return {
    api: api as unknown as ApiClient,
    raw: api,
    settings,
    providers,
    permissions,
    externalWrite,
    seedProvider,
    saveProvider,
    setReferences,
    setCandidates,
    fetchProviderModels,
    cancelProviderModels,
    holdFetch,
  }
}

/** 测试用的 Model Catalog 条目：默认容量、文本输入、推理关闭。 */
export const catalogModel = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: '',
  ...MODEL_CATALOG_DEFAULTS,
  input: ['text'],
  reasoning: false,
  thinkingLevels: [],
  ...extra,
})

/** 自定义 Provider 的完整配置；models 给模型 ID 时使用默认能力。 */
export function customProvider(id: string, models: string[], extra: Partial<ProviderFields> = {}): ProviderFields {
  return { id, name: id, api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', models: models.map((m) => catalogModel(m)), ...extra }
}

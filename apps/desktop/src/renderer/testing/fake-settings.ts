// 单元测试与 Browser Mode 共用：按 Sidecar 规则实现设置 revision 与 Provider 的内存后端。
import {
  MODEL_CATALOG_DEFAULTS,
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
  const permissions: PermissionsResponse = { defaultMode: { value: 'default', revision: 0 }, global: { rules: [], revision: 0 } }
  const workspaceRules = new Map<string, { rules: PermissionsResponse['global']['rules']; revision: number }>()
  const permissionsOf = (workspaceId?: string): PermissionsResponse => ({
    ...structuredClone(permissions),
    ...(workspaceId ? { workspace: { workspaceId, ...structuredClone(workspaceRules.get(workspaceId) ?? { rules: [], revision: 0 }) } } : {}),
  })
  const models = (): AvailableModel[] =>
    providers.flatMap((p) => p.models.map((m) => ({ providerId: p.id, providerName: p.name, modelId: m.id, name: m.name || m.id })))
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
    deleteProvider: vi.fn<Api['deleteProvider']>(async (id) => {
      const index = providers.findIndex((p) => p.id === id)
      if (index < 0) throw new ApiError('not-found', 'missing', 404)
      providers.splice(index, 1)
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
  return { api: api as unknown as ApiClient, raw: api, settings, providers, permissions, externalWrite, seedProvider, saveProvider }
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

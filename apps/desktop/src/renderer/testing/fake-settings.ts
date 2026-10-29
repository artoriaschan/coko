// 单元测试与 Browser Mode 共用：按 Sidecar 规则实现设置 revision 与 Provider 的内存后端。
import {
  MODEL_CATALOG_DEFAULTS,
  type AvailableModel,
  type CatalogModel,
  type CreateProviderRequest,
  type PermissionsResponse,
  type Provider,
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
    createProvider: vi.fn<Api['createProvider']>(async (input) => {
      if (providers.some((p) => p.id === input.id))
        throw new ApiError('already-exists', `Provider ID ${input.id} is already in use`, 409, { field: 'id', id: input.id })
      const provider: Provider = { ...structuredClone(input), credential: null, createdAt: 1, updatedAt: 1 }
      providers.push(provider)
      return provider
    }),
    updateProvider: vi.fn<Api['updateProvider']>(async (id, patch) => {
      const index = providers.findIndex((p) => p.id === id)
      if (index < 0) throw new ApiError('not-found', 'missing', 404)
      providers[index] = { ...providers[index]!, ...structuredClone(patch) }
      return providers[index]!
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
  /** 模拟 main 保存密文：只记录提示。 */
  const setCredential = vi.fn<CokoBridge['setCredential']>(async (providerId, secret) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) return { ok: false, code: 'rejected', message: 'not found' }
    provider.credential = { hint: secret.slice(-4) }
    return { ok: true, hint: secret.slice(-4) }
  })
  return { api: api as unknown as ApiClient, raw: api, settings, providers, permissions, externalWrite, setCredential }
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

/** 自定义 Provider 的创建请求；models 给模型 ID 时使用默认能力。 */
export function customProvider(id: string, models: string[], extra: Partial<CreateProviderRequest> = {}): CreateProviderRequest {
  return { id, name: id, api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', models: models.map((m) => catalogModel(m)), ...extra }
}

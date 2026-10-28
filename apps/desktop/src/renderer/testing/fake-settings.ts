// 单元测试与 Browser Mode 共用：按 Sidecar 规则实现设置 revision 与 Provider 的内存后端。
import type { AvailableModel, PermissionsResponse, Provider, Setting } from '@coko/protocol'
import { vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { CokoBridge } from '../../shared/bridge.ts'

type Api = ApiClient

export function fakeSettingsBackend() {
  const settings = new Map<string, Setting>()
  const providers: Provider[] = []
  let nextId = 1
  const permissions: PermissionsResponse = { defaultMode: { value: 'default', revision: 0 }, global: { rules: [], revision: 0 } }
  const workspaceRules = new Map<string, { rules: PermissionsResponse['global']['rules']; revision: number }>()
  const permissionsOf = (workspaceId?: string): PermissionsResponse => ({
    ...structuredClone(permissions),
    ...(workspaceId ? { workspace: { workspaceId, ...structuredClone(workspaceRules.get(workspaceId) ?? { rules: [], revision: 0 }) } } : {}),
  })
  const models = (): AvailableModel[] =>
    providers.flatMap((p) => p.models.map((modelId) => ({ providerId: p.id, providerName: p.name, modelId, name: modelId })))
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
    listProviderPresets: vi.fn<Api['listProviderPresets']>(async () => [
      { kind: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash'] },
    ]),
    listModels: vi.fn<Api['listModels']>(async () => {
      const list = models()
      return { models: list, defaultModel: list[0] ? { providerId: list[0].providerId, modelId: list[0].modelId } : null }
    }),
    createProvider: vi.fn<Api['createProvider']>(async (input) => {
      const provider: Provider = {
        id: `p${nextId++}`,
        name: input.name,
        kind: input.kind,
        api: 'openai-completions',
        baseUrl: input.baseUrl ?? '',
        models: input.models,
        credential: null,
        createdAt: 1,
        updatedAt: 1,
      }
      providers.push(provider)
      return provider
    }),
    updateProvider: vi.fn<Api['updateProvider']>(async (id, patch) => {
      const index = providers.findIndex((p) => p.id === id)
      if (index < 0) throw new ApiError('not-found', 'missing', 404)
      providers[index] = { ...providers[index]!, ...patch }
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

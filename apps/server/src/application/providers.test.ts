import { createModelRegistry, InMemoryCredentialStore } from '@coko/agent'
import type { CatalogModel, CreateProviderRequest } from '@coko/protocol'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { ProviderService } from './providers.ts'

const catalogModel = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: '',
  contextWindow: 128_000,
  maxTokens: 16_000,
  input: ['text'],
  reasoning: false,
  thinkingLevels: [],
  ...extra,
})

const request = (extra: Partial<CreateProviderRequest> = {}): CreateProviderRequest => ({
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'anthropic-messages',
  baseUrl: 'https://gateway.example',
  models: [
    catalogModel('custom-model-1', {
      name: '自定义模型一',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevels: [{ level: 'off' }, { level: 'medium', value: 'medium' }, { level: 'high', value: 'deep' }],
    }),
  ],
  ...extra,
})

function setup(store = createMemoryStore({ payloads: createPayloadRegistry([]) })) {
  const registry = createModelRegistry({ credentials: new InMemoryCredentialStore() })
  const service = new ProviderService({ store, registry, invalidateCredential: () => {} })
  return { store, registry, service }
}

describe('ProviderService：自定义 Provider', () => {
  it('创建后读回与提交一致；模型以目录中的能力与 thinkingLevelMap 注册；重新装载（重启）后一致', async () => {
    const { store, registry, service } = setup()
    const created = await service.create(request())
    expect(created).toMatchObject({ ...request(), credential: null })
    expect(await service.list()).toEqual([created])
    const expected = {
      id: 'custom-model-1',
      name: '自定义模型一',
      provider: 'custom-provider-1',
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: null, medium: 'medium', high: 'deep', xhigh: null, max: null },
    }
    expect(registry.models.getModel('custom-provider-1', 'custom-model-1')).toMatchObject(expected)

    const restarted = setup(store)
    await restarted.service.load()
    expect(await restarted.service.list()).toEqual([created])
    expect(restarted.registry.models.getModel('custom-provider-1', 'custom-model-1')).toMatchObject(expected)
    expect(restarted.service.models()).toEqual([
      { providerId: 'custom-provider-1', providerName: '自定义供应商一', modelId: 'custom-model-1', name: '自定义模型一' },
    ])
  })

  it('ID 重复时以 already-exists 拒绝；目录或地址不合规则时以 bad-request 拒绝；库与 registry 不变', async () => {
    const { registry, service } = setup()
    const created = await service.create(request())
    await expect(service.create(request({ name: '另一个', baseUrl: 'https://other.example' }))).rejects.toMatchObject({ code: 'already-exists' })
    for (const bad of [
      request({ id: 'custom-provider-2', baseUrl: 'ftp://gateway.example' }),
      request({ id: 'custom-provider-2', models: [catalogModel('m'), catalogModel('m')] }),
      request({ id: 'custom-provider-2', models: [catalogModel('m', { contextWindow: 1000, maxTokens: 2000 })] }),
    ]) {
      await expect(service.create(bad)).rejects.toMatchObject({ code: 'bad-request' })
    }
    await expect(service.update('custom-provider-1', { models: [catalogModel('m'), catalogModel('m')] })).rejects.toMatchObject({ code: 'bad-request' })
    expect(await service.list()).toEqual([created])
    expect(registry.models.getProviders().map((p) => p.id)).toEqual(['custom-provider-1'])
    expect(registry.models.getModels('custom-provider-1').map((m) => m.id)).toEqual(['custom-model-1'])
  })

  it('修改协议、地址与目录后 registry 随之更新；ID 不变', async () => {
    const { registry, service } = setup()
    await service.create(request())
    const updated = await service.update('custom-provider-1', {
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:9/v1',
      models: [catalogModel('custom-model-2')],
    })
    expect(updated).toMatchObject({ id: 'custom-provider-1', api: 'openai-responses', models: [catalogModel('custom-model-2')] })
    expect(registry.models.getModels('custom-provider-1').map((m) => [m.id, m.api, m.baseUrl, m.name])).toEqual([
      ['custom-model-2', 'openai-responses', 'http://127.0.0.1:9/v1', 'custom-model-2'],
    ])
  })
})

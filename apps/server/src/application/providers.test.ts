import { createModelRegistry, InMemoryCredentialStore } from '@coko/agent'
import { DEFAULT_MODEL_SETTING, type CatalogModel, type ProviderFields } from '@coko/protocol'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { ProviderService, serveProviderSave } from './providers.ts'

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

const request = (extra: Partial<ProviderFields> = {}): ProviderFields => ({
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
  const invalidated: string[] = []
  const service = new ProviderService({ store, registry, invalidateCredential: (id) => void invalidated.push(id) })
  return { store, registry, service, invalidated }
}

const credential = (bytes: number[], hint: string) => ({ ciphertext: Buffer.from(bytes).toString('base64'), hint })

describe('ProviderService：自定义 Provider', () => {
  it('创建后读回与提交一致；模型以目录中的能力与 thinkingLevelMap 注册；重新装载（重启）后一致', async () => {
    const { store, registry, service } = setup()
    const created = await service.save('create', request())
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
      // 会话可选的档位：off 与已配置的档位，按固定顺序。
      {
        providerId: 'custom-provider-1',
        providerName: '自定义供应商一',
        modelId: 'custom-model-1',
        name: '自定义模型一',
        thinkingLevels: ['off', 'medium', 'high'],
      },
    ])
  })

  it('ID 重复、修改不存在的 Provider 或目录与地址不合规则时拒绝；配置、密文与 registry 都不变', async () => {
    const { store, registry, service, invalidated } = setup()
    const created = await service.save('create', request(), credential([1, 2], 'aaaa'))
    await expect(service.save('create', request({ name: '另一个', baseUrl: 'https://other.example' }), credential([3], 'bbbb'))).rejects.toMatchObject({
      code: 'already-exists',
    })
    await expect(service.save('update', request({ id: 'custom-provider-9' }), credential([3], 'bbbb'))).rejects.toMatchObject({ code: 'not-found' })
    for (const bad of [
      request({ id: 'custom-provider-2', baseUrl: 'ftp://gateway.example' }),
      request({ id: 'custom-provider-2', models: [catalogModel('m'), catalogModel('m')] }),
      request({ id: 'custom-provider-2', models: [catalogModel('m', { contextWindow: 1000, maxTokens: 2000 })] }),
    ]) {
      await expect(service.save('create', bad, credential([3], 'bbbb'))).rejects.toMatchObject({ code: 'bad-request' })
    }
    await expect(service.save('update', request({ models: [catalogModel('m'), catalogModel('m')] }), credential([3], 'bbbb'))).rejects.toMatchObject({
      code: 'bad-request',
    })
    expect(await service.list()).toEqual([created])
    expect(Array.from((await store.providers.getCredentialCiphertext('custom-provider-1')) ?? [])).toEqual([1, 2])
    expect(await store.providers.get('custom-provider-2')).toBeUndefined()
    // 只有成功写入新密文时才清除明文缓存。
    expect(invalidated).toEqual(['custom-provider-1'])
    expect(registry.models.getProviders().map((p) => p.id)).toEqual(['custom-provider-1'])
    expect(registry.models.getModels('custom-provider-1').map((m) => m.id)).toEqual(['custom-model-1'])
  })

  it('修改协议、地址与目录后 registry 随之更新；ID 不变；带新密钥时替换并清除明文缓存', async () => {
    const { store, registry, service, invalidated } = setup()
    await service.save('create', request(), credential([1], 'aaaa'))
    invalidated.length = 0
    const updated = await service.save(
      'update',
      request({ api: 'openai-responses', baseUrl: 'http://127.0.0.1:9/v1', models: [catalogModel('custom-model-2')] }),
    )
    expect(updated).toMatchObject({ id: 'custom-provider-1', api: 'openai-responses', models: [catalogModel('custom-model-2')], credential: { hint: 'aaaa' } })
    // 不带新密钥：保留原 Credential，不清缓存。
    expect(invalidated).toEqual([])
    expect(Array.from((await store.providers.getCredentialCiphertext('custom-provider-1')) ?? [])).toEqual([1])
    const replaced = await service.save(
      'update',
      request({ api: 'openai-responses', baseUrl: 'http://127.0.0.1:9/v1', models: [catalogModel('custom-model-2')] }),
      credential([5, 6], 'cccc'),
    )
    expect(replaced.credential).toEqual({ hint: 'cccc' })
    expect(invalidated).toEqual(['custom-provider-1'])
    expect(registry.models.getModels('custom-provider-1').map((m) => [m.id, m.api, m.baseUrl, m.name])).toEqual([
      ['custom-model-2', 'openai-responses', 'http://127.0.0.1:9/v1', 'custom-model-2'],
    ])
  })
})

describe('删除 Provider', () => {
  it('默认模型指向它时在同一事务中改为 null：用相同 ID 重新创建也不会重新成为默认；指向别的 Provider 或不是模型时不变', async () => {
    const { store, service, registry, invalidated } = setup()
    await service.save('create', request(), credential([1], 'aaaa'))
    await service.save('create', request({ id: 'custom-provider-2' }))
    await store.settings.set('defaultModel', { providerId: 'custom-provider-1', modelId: 'custom-model-1' }, 0)
    await service.delete('custom-provider-1')
    expect(await store.settings.get('defaultModel')).toMatchObject({ value: null, revision: 2 })
    expect(registry.models.getProviders().map((p) => p.id)).toEqual(['custom-provider-2'])
    expect(invalidated).toContain('custom-provider-1')
    await service.save('create', request())
    expect((await store.settings.get('defaultModel'))?.value).toBeNull()

    await store.settings.set('defaultModel', { providerId: 'custom-provider-2', modelId: 'custom-model-1' }, 2)
    await service.delete('custom-provider-1')
    expect(await store.settings.get('defaultModel')).toMatchObject({ value: { providerId: 'custom-provider-2' }, revision: 3 })
    await store.settings.set('defaultModel', 'custom-provider-2', 3)
    await service.delete('custom-provider-2')
    expect(await store.settings.get('defaultModel')).toMatchObject({ value: 'custom-provider-2', revision: 4 })
    await expect(service.delete('custom-provider-2')).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('provider.save 控制消息', () => {
  /** 假控制通道：注入 main 的消息，记录 Sidecar 的回答。 */
  function channel() {
    const sent: SidecarToMainMessage[] = []
    let listener: ((message: MainToSidecarMessage) => void) | undefined
    return {
      sent,
      control: {
        send: async (message: SidecarToMainMessage) => void sent.push(message),
        onMessage: (l: (message: MainToSidecarMessage) => void) => {
          listener = l
          return () => (listener = undefined)
        },
      },
      deliver: (message: MainToSidecarMessage) => listener?.(message),
    }
  }

  it('成功回 ok 与保存后的 Provider；失败按协议错误码回答并带 details；其他消息不处理', async () => {
    const { service } = setup()
    const { control, sent, deliver } = channel()
    serveProviderSave({ control, providers: service })
    deliver({ type: 'provider.save', requestId: 1, mode: 'create', provider: request() })
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ type: 'provider.save.result', requestId: 1, ok: true, provider: { id: 'custom-provider-1', credential: null } })
    deliver({ type: 'provider.save', requestId: 2, mode: 'create', provider: request() })
    deliver({ type: 'provider.save', requestId: 3, mode: 'update', provider: request({ id: 'custom-provider-9' }) })
    deliver({ type: 'provider.save', requestId: 4, mode: 'create', provider: request({ id: 'custom-provider-2', baseUrl: 'ftp://gateway.example' }) })
    deliver({ type: 'shutdown' })
    await expect.poll(() => sent.length).toBe(4)
    const byId = Object.fromEntries(sent.map((m) => [(m as { requestId: number }).requestId, m]))
    expect(byId[2]).toEqual({
      type: 'provider.save.result',
      requestId: 2,
      ok: false,
      error: { code: 'already-exists', message: 'Provider ID custom-provider-1 is already in use', details: { field: 'id', id: 'custom-provider-1' } },
    })
    expect(byId[3]).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(byId[3]).not.toHaveProperty('error.details')
    expect(byId[4]).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('意外错误回 internal，不带原文', async () => {
    const { service } = setup()
    const { control, sent, deliver } = channel()
    serveProviderSave({ control, providers: { save: async () => Promise.reject(new Error('disk on fire /secret/path')) } as unknown as typeof service })
    deliver({ type: 'provider.save', requestId: 5, mode: 'create', provider: request() })
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]).toEqual({ type: 'provider.save.result', requestId: 5, ok: false, error: { code: 'internal', message: 'Internal error' } })
  })
})

describe('ProviderService.upsertFromConfig：无界面运行的启动配置（ADR 0019）', () => {
  const second = (extra: Partial<ProviderFields> = {}) => request({ id: 'second', name: 'Second', baseUrl: 'https://second.example', ...extra })

  it('新建与更新一起写入并注册；defaultModel 写入设置；库中没有密钥', async () => {
    const { store, registry, service } = setup()
    await service.save('create', request({ name: 'old' }))
    const result = await service.upsertFromConfig({ providers: [request({ name: 'new' }), second()], defaultModel: 'second/custom-model-1' })
    expect(result).toEqual({ created: ['second'], updated: ['custom-provider-1'], defaultModel: { providerId: 'second', modelId: 'custom-model-1' } })
    expect((await service.list()).map((p) => [p.id, p.name, p.credential])).toEqual([
      ['custom-provider-1', 'new', null],
      ['second', 'Second', null],
    ])
    expect(registry.models.getModel('second', 'custom-model-1')).toBeDefined()
    expect((await store.settings.get(DEFAULT_MODEL_SETTING))?.value).toEqual({ providerId: 'second', modelId: 'custom-model-1' })
    expect(await store.providers.getCredentialCiphertext('second')).toBeUndefined()
  })

  it('第二个 Provider 的配置无效时整个文件都不写入：库中没有任何 Provider，registry 不变', async () => {
    const { registry, service } = setup()
    const error = await service
      .upsertFromConfig({ providers: [request(), second({ models: [catalogModel('m', { maxTokens: 999_999, contextWindow: 1000 })] })] })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'bad-request' })
    expect(await service.list()).toEqual([])
    expect(registry.models.getProviders().map((p) => p.id)).toEqual([])
  })

  it('写入中途失败时已写入的回滚（新建的删除、更新的恢复）', async () => {
    const { store, service } = setup()
    await service.save('create', request({ name: 'before' }))
    const original = store.providers.create.bind(store.providers)
    store.providers.create = async (input, credential) => {
      if (input.id === 'third') throw new Error('disk full')
      return original(input, credential)
    }
    const error = await service.upsertFromConfig({ providers: [request({ name: 'after' }), second(), second({ id: 'third' })] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((await service.list()).map((p) => [p.id, p.name])).toEqual([['custom-provider-1', 'before']])
  })

  it.each([
    ['顶层 apiKey', { providers: [{ ...request(), apiKey: 'sk-should-not-be-here' }] }],
    ['嵌套 api_key', { providers: [request({ models: [{ ...catalogModel('m'), api_key: 'x' } as CatalogModel] })] }],
    ['token', { providers: [{ ...request(), token: 'x' }] }],
  ])('配置中带密钥字段（%s）：bad-request 带 reason secret-in-config，不写入，消息不含值', async (_name, config) => {
    const { service } = setup()
    const error = (await service.upsertFromConfig(config as never).catch((e: unknown) => e)) as Error & { code?: string; details?: unknown }
    expect([error.code, error.details]).toEqual(['bad-request', expect.objectContaining({ reason: 'secret-in-config' })])
    expect(error.message).not.toContain('sk-should-not-be-here')
    expect(await service.list()).toEqual([])
  })

  it('不合 schema 或 defaultModel 指向不存在的模型：bad-request，不写入', async () => {
    const { service } = setup()
    expect(await service.upsertFromConfig({ providers: [{ ...request(), api: 'nope' }] } as never).catch((e: unknown) => e)).toMatchObject({
      code: 'bad-request',
    })
    expect(await service.upsertFromConfig({ providers: [request()], defaultModel: 'custom-provider-1/missing' }).catch((e: unknown) => e)).toMatchObject({
      code: 'bad-request',
    })
    expect(await service.list()).toEqual([])
  })
})

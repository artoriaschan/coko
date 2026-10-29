import { describe, expect, it } from 'vitest'
import { catalogModel, customProvider, fakeSettingsBackend } from '../testing/fake-settings.ts'
import { createSettingsStore, type ProviderDraft } from './settings-store.ts'

const draft = (extra: Partial<ProviderDraft> = {}): ProviderDraft => ({
  id: 'custom-provider-1',
  isNew: true,
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'http://x/v1',
  models: [catalogModel('m')],
  secret: '',
  ...extra,
})

describe('设置 store', () => {
  it('load 读取设置、Provider 与可用模型', async () => {
    const backend = fakeSettingsBackend()
    backend.externalWrite('theme', 'dark')
    const store = createSettingsStore({ api: backend.api })
    await store.getState().load()
    expect(store.getState()).toMatchObject({
      status: 'ready',
      values: { theme: { value: 'dark', revision: 1 } },
      providers: [],
      models: [],
      defaultModel: null,
    })
    expect(store.getState()).not.toHaveProperty('presets')
  })

  it('revision 冲突：返回 conflict 并读回服务端的 revision；再次保存成功', async () => {
    const backend = fakeSettingsBackend()
    const store = createSettingsStore({ api: backend.api })
    await store.getState().load()
    backend.externalWrite('theme', 'light')
    expect(await store.getState().saveSetting('theme', 'dark')).toEqual({ status: 'conflict' })
    expect(store.getState().values.theme).toEqual({ value: 'light', revision: 1 })
    expect(await store.getState().saveSetting('theme', 'dark')).toEqual({ status: 'saved' })
    expect(backend.settings.get('theme')).toMatchObject({ value: 'dark', revision: 2 })
  })

  it('同一键的连续保存按顺序提交，不会与自己冲突', async () => {
    const backend = fakeSettingsBackend()
    const store = createSettingsStore({ api: backend.api })
    await store.getState().load()
    const results = await Promise.all([
      store.getState().saveSetting('theme', 'dark'),
      store.getState().saveSetting('theme', 'light'),
      store.getState().saveSetting('theme', 'dark'),
    ])
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved', 'saved'])
    expect(backend.settings.get('theme')).toMatchObject({ value: 'dark', revision: 3 })
  })

  it('保存 Provider：草稿经 bridge 一次提交（配置、目录与 Key），成功后读回列表与可用模型', async () => {
    const backend = fakeSettingsBackend()
    const store = createSettingsStore({ api: backend.api, saveProvider: backend.saveProvider })
    await store.getState().load()
    const models = [catalogModel('custom-model-1', { contextWindow: 1_000_000, input: ['text', 'image'] })]
    const result = await store.getState().saveProvider(draft({ api: 'openai-responses', models, secret: 'sk-abcdef-1234' }))
    expect(result).toMatchObject({ ok: true, provider: { id: 'custom-provider-1', credential: { hint: '1234' } } })
    expect(backend.saveProvider).toHaveBeenCalledTimes(1)
    expect(backend.saveProvider).toHaveBeenCalledWith({
      mode: 'create',
      provider: { id: 'custom-provider-1', name: '自定义供应商一', api: 'openai-responses', baseUrl: 'http://x/v1', models },
      secret: 'sk-abcdef-1234',
    })
    expect(store.getState().providers).toMatchObject([{ id: 'custom-provider-1', credential: { hint: '1234' } }])
    expect(store.getState().models.map((m) => m.modelId)).toEqual(['custom-model-1'])

    // 编辑时 Key 留空：提交不带 secret，表示保留原 Credential。
    backend.saveProvider.mockClear()
    await store.getState().saveProvider(draft({ isNew: false, name: 'DS', api: 'anthropic-messages', models }))
    expect(backend.saveProvider).toHaveBeenCalledWith({
      mode: 'update',
      provider: { id: 'custom-provider-1', name: 'DS', api: 'anthropic-messages', baseUrl: 'http://x/v1', models },
    })
    expect(store.getState().providers[0]).toMatchObject({ name: 'DS', api: 'anthropic-messages', credential: { hint: '1234' } })
  })

  it('提交失败（加密不可用、ID 重复、配置无效）时原样返回错误码，列表不变；没有 bridge 时视为 Sidecar 不可用', async () => {
    const backend = fakeSettingsBackend()
    backend.seedProvider(customProvider('custom-provider-1', ['m']), 'sk-existing-0000')
    const store = createSettingsStore({ api: backend.api, saveProvider: backend.saveProvider })
    await store.getState().load()
    const before = store.getState().providers

    backend.saveProvider.mockResolvedValueOnce({ ok: false, code: 'encryption-unavailable', message: 'no keychain' })
    expect(await store.getState().saveProvider(draft({ id: 'custom-provider-2', secret: 'sk-abcdef-1234' }))).toEqual({
      ok: false,
      code: 'encryption-unavailable',
      message: 'no keychain',
    })
    expect(await store.getState().saveProvider(draft({ secret: 'sk-abcdef-1234' }))).toMatchObject({ ok: false, code: 'already-exists' })
    backend.saveProvider.mockResolvedValueOnce({ ok: false, code: 'bad-request', message: 'needs an http or https baseUrl' })
    expect(await store.getState().saveProvider(draft({ id: 'custom-provider-3', baseUrl: 'ftp://x', secret: 'sk-abcdef-1234' }))).toMatchObject({
      ok: false,
      code: 'bad-request',
    })
    backend.saveProvider.mockRejectedValueOnce(new Error('IPC channel closed'))
    expect(await store.getState().saveProvider(draft({ id: 'custom-provider-4', secret: 'sk-abcdef-1234' }))).toMatchObject({
      ok: false,
      code: 'sidecar-unavailable',
    })
    expect(store.getState().providers).toEqual(before)
    expect(backend.providers.map((p) => p.id)).toEqual(['custom-provider-1'])

    const noBridge = createSettingsStore({ api: fakeSettingsBackend().api })
    expect(await noBridge.getState().saveProvider(draft({ secret: 'sk-abcdef-1234' }))).toMatchObject({ ok: false, code: 'sidecar-unavailable' })
  })

  it('删除后列表与模型更新', async () => {
    const backend = fakeSettingsBackend()
    backend.seedProvider(customProvider('custom-provider-1', ['m']))
    const store = createSettingsStore({ api: backend.api, saveProvider: backend.saveProvider })
    await store.getState().load()
    expect(store.getState().models).toHaveLength(1)
    expect(await store.getState().deleteProvider('custom-provider-1')).toBe(true)
    expect(store.getState()).toMatchObject({ providers: [], models: [], defaultModel: null })
  })
})

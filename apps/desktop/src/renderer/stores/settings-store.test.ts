import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../client/api.ts'
import type { SetCredentialResult } from '../../shared/bridge.ts'
import { fakeSettingsBackend } from '../testing/fake-settings.ts'
import { createSettingsStore } from './settings-store.ts'

describe('设置 store', () => {
  it('load 读取设置、Provider、预设与可用模型', async () => {
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
    expect(store.getState().presets.map((p) => p.kind)).toEqual(['deepseek'])
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

  it('保存 Provider：先建配置再经 bridge 设置 Credential，读回列表与可用模型', async () => {
    const backend = fakeSettingsBackend()
    const store = createSettingsStore({ api: backend.api, setCredential: backend.setCredential })
    await store.getState().load()
    const result = await store
      .getState()
      .saveProvider({ kind: 'deepseek', name: 'DeepSeek', baseUrl: '', models: ['deepseek-flash'], secret: 'sk-abcdef-1234' })
    expect(result).toMatchObject({ ok: true, provider: { id: 'p1' } })
    // 预设 kind 留空地址时不发送 baseUrl。
    expect(backend.raw.createProvider).toHaveBeenCalledWith({ kind: 'deepseek', name: 'DeepSeek', models: ['deepseek-flash'] })
    expect(backend.setCredential).toHaveBeenCalledWith('p1', 'sk-abcdef-1234')
    expect(store.getState().providers).toMatchObject([{ id: 'p1', credential: { hint: '1234' } }])
    expect(store.getState().models.map((m) => m.modelId)).toEqual(['deepseek-flash'])

    // 编辑时密钥留空：只改配置，不动 Credential。
    backend.setCredential.mockClear()
    await store.getState().saveProvider({ id: 'p1', kind: 'deepseek', name: 'DS', baseUrl: '', models: ['deepseek-flash'], secret: '' })
    expect(backend.raw.updateProvider).toHaveBeenCalledWith('p1', { name: 'DS', baseUrl: '', models: ['deepseek-flash'] })
    expect(backend.setCredential).not.toHaveBeenCalled()
    expect(store.getState().providers[0]).toMatchObject({ name: 'DS', credential: { hint: '1234' } })
  })

  it('Credential 失败时返回已创建的 Provider，便于界面转为编辑并保留输入；没有 bridge 时视为不可用', async () => {
    const backend = fakeSettingsBackend()
    const failing = vi.fn<() => Promise<SetCredentialResult>>(async () => ({ ok: false, code: 'encryption-unavailable', message: 'no keychain' }))
    const store = createSettingsStore({ api: backend.api, setCredential: failing })
    const result = await store
      .getState()
      .saveProvider({ kind: 'openai-compatible', name: 'Local', baseUrl: 'http://x/v1', models: ['m'], secret: 'sk-abcdef-1234' })
    expect(result).toMatchObject({ ok: false, stage: 'credential', code: 'encryption-unavailable', provider: { id: 'p1' } })
    expect(store.getState().providers).toHaveLength(1)

    const noBridge = createSettingsStore({ api: fakeSettingsBackend().api })
    expect(
      await noBridge.getState().saveProvider({ kind: 'openai-compatible', name: 'L', baseUrl: 'http://x/v1', models: ['m'], secret: 'sk-abcdef-1234' }),
    ).toMatchObject({
      ok: false,
      stage: 'credential',
      code: 'sidecar-unavailable',
    })
  })

  it('配置被拒绝时不设置 Credential；删除后列表与模型更新', async () => {
    const backend = fakeSettingsBackend()
    backend.raw.createProvider.mockRejectedValueOnce(new ApiError('bad-request', 'needs baseUrl', 400))
    const store = createSettingsStore({ api: backend.api, setCredential: backend.setCredential })
    const rejected = await store.getState().saveProvider({ kind: 'openai-compatible', name: 'L', baseUrl: '', models: ['m'], secret: 'sk-abcdef-1234' })
    expect(rejected).toMatchObject({ ok: false, stage: 'provider', error: { code: 'bad-request' } })
    expect(backend.setCredential).not.toHaveBeenCalled()

    await store.getState().saveProvider({ kind: 'openai-compatible', name: 'L', baseUrl: 'http://x/v1', models: ['m'], secret: '' })
    expect(store.getState().models).toHaveLength(1)
    expect(await store.getState().deleteProvider('p1')).toBe(true)
    expect(store.getState()).toMatchObject({ providers: [], models: [], defaultModel: null })
  })
})

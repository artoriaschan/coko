import { describe, expect, it } from 'vitest'
import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import type { ControlChannel } from '../control/channel.ts'
import { createEnvCredentialStore, createEnvSecretSource, createIpcSecretSource, credentialEnvName, secretEnvName } from './credentials.ts'

describe('Secret 来源（ADR 0007）', () => {
  it('无界面运行：只读 COKO_SECRET_<NAME>，不按名字读 Sidecar 自身环境', async () => {
    const source = createEnvSecretSource({ COKO_SECRET_MY_SERVICE_DSN: 'postgres://u:p@h/db', MY_SERVICE_DSN: 'from-host-env', GITHUB_TOKEN: 'gh' })
    expect(secretEnvName('MY_SERVICE_DSN')).toBe('COKO_SECRET_MY_SERVICE_DSN')
    expect(await source.get('MY_SERVICE_DSN')).toBe('postgres://u:p@h/db')
    expect(await source.get('GITHUB_TOKEN')).toBeUndefined()
    expect(await source.list()).toEqual([{ name: 'MY_SERVICE_DSN', hint: 'h/db' }])
    expect(source.kind).toBe('environment')
  })

  it('IPC 模式：只解析库中登记的名字，经 secret.decrypt 取明文并只缓存在内存；未登记的名字不请求解密', async () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const sent: SidecarToMainMessage[] = []
    let deliver: (message: MainToSidecarMessage) => void = () => {}
    const control: ControlChannel = {
      mode: 'ipc',
      send: async (message) => {
        sent.push(message)
        if (message.type === 'secret.decrypt') {
          const plaintext = Buffer.from(message.ciphertext, 'base64').toString().split('').reverse().join('')
          queueMicrotask(() => deliver({ type: 'secret.decrypt.result', requestId: message.requestId, plaintext }))
        }
      },
      onMessage: (listener) => {
        deliver = listener
        return () => {}
      },
      onDisconnect: () => {},
      close: () => {},
    }
    const source = createIpcSecretSource({ control, secrets: store.secrets })
    expect(await source.get('MY_SERVICE_DSN')).toBeUndefined()
    expect(sent).toEqual([])
    await store.secrets.setCiphertext('MY_SERVICE_DSN', { ciphertext: Buffer.from('eulav'), hint: 'alue' })
    expect(await source.get('MY_SERVICE_DSN')).toBe('value')
    expect(await source.get('MY_SERVICE_DSN')).toBe('value')
    expect(sent.filter((m) => m.type === 'secret.decrypt')).toHaveLength(1)
    expect(source.cachedValues()).toEqual(['value'])
    source.invalidate('MY_SERVICE_DSN')
    expect(source.cachedValues()).toEqual([])
    expect(await source.list()).toEqual([expect.objectContaining({ name: 'MY_SERVICE_DSN', hint: 'alue' })])
  })
})

describe('Credential 明文作为按值脱敏来源（ADR 0004）', () => {
  it('无界面运行：只有 COKO_CREDENTIAL_* 在 cachedValues 中；按品牌命名的 *_API_KEY 不登记', () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const credentials = createEnvCredentialStore({
      env: {
        COKO_CREDENTIAL_LOCAL: 'local-key-value',
        DEEPSEEK_API_KEY: 'deepseek-key',
        OPENAI_API_KEY: 'openai-key',
        ANTHROPIC_API_KEY: 'anthropic-key',
        PATH: '/usr/bin',
        COKO_CREDENTIAL_EMPTY: '',
      },
      providers: store.providers,
    })
    expect(credentials.cachedValues()).toEqual(['local-key-value'])
  })
})

describe('独立运行的 Credential 来源（ADR 0010）', () => {
  it('只读 COKO_CREDENTIAL_<PROVIDER_ID>（大写、连字符换成下划线）；不按协议或旧 kind 回退到 *_API_KEY', async () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const model = { id: 'm', name: '', contextWindow: 1000, maxTokens: 100, input: ['text'], reasoning: false, thinkingLevels: [] }
    for (const [id, api] of [
      ['custom-provider-1', 'openai-completions'],
      ['deepseek', 'openai-completions'],
      ['openai', 'openai-responses'],
      ['anthropic', 'anthropic-messages'],
    ] as const) {
      await store.providers.create({ id, name: id, api, baseUrl: 'https://gateway.example/v1', models: [model] })
    }
    const credentials = createEnvCredentialStore({
      env: { COKO_CREDENTIAL_CUSTOM_PROVIDER_1: 'custom-key-value', DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' },
      providers: store.providers,
    })
    expect(credentialEnvName('custom-provider-1')).toBe('COKO_CREDENTIAL_CUSTOM_PROVIDER_1')
    expect(await credentials.read('custom-provider-1')).toEqual({ type: 'api_key', key: 'custom-key-value' })
    for (const id of ['deepseek', 'openai', 'anthropic']) expect(await credentials.read(id)).toBeUndefined()
    expect(await credentials.list()).toEqual([{ providerId: 'custom-provider-1', type: 'api_key' }])
  })
})

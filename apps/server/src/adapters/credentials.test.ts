import { describe, expect, it } from 'vitest'
import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import type { ControlChannel } from '../control/channel.ts'
import { createEnvSecretSource, createIpcSecretSource, secretEnvName } from './credentials.ts'

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

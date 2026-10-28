import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { createCredentialBridge, credentialHint, type CredentialChannel, type Encryption } from './credentials.ts'

/** 可逆的假 safeStorage：密文字节不含明文。 */
const fakeEncryption = (available = true): Encryption => ({
  isAvailable: () => available,
  encrypt: (plaintext) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)),
  decrypt: (ciphertext) => {
    if (ciphertext[0] === 0xff) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return Buffer.from([...ciphertext].map((b) => b ^ 0x5a)).toString()
  },
})

/** 假控制通道：记录 main 发出的消息，可注入 sidecar 的消息。 */
function fakeChannel(options: { ready?: boolean; answer?: (message: MainToSidecarMessage) => SidecarToMainMessage | undefined } = {}) {
  const sent: MainToSidecarMessage[] = []
  const listeners = new Set<(message: SidecarToMainMessage) => void>()
  const unavailableListeners = new Set<() => void>()
  const deliver = (message: SidecarToMainMessage) => {
    for (const listener of listeners) listener(message)
  }
  /** 模拟 Sidecar 意外退出。 */
  const exit = () => {
    for (const listener of unavailableListeners) listener()
  }
  const channel: CredentialChannel = {
    isReady: () => options.ready ?? true,
    send(message) {
      sent.push(message)
      const reply = options.answer?.(message)
      if (reply) queueMicrotask(() => deliver(reply))
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onUnavailable(listener) {
      unavailableListeners.add(listener)
      return () => unavailableListeners.delete(listener)
    },
  }
  return { channel, sent, deliver, exit }
}

const acceptStore = (message: MainToSidecarMessage): SidecarToMainMessage | undefined =>
  message.type === 'credential.store' ? { type: 'credential.store.result', requestId: message.requestId, ok: true } : undefined

describe('credentialHint', () => {
  it('取末四位；短于 8 个字符的密钥不给提示，避免泄露大半', () => {
    expect(credentialHint('sk-abcdef123456')).toBe('3456')
    expect(credentialHint('1234567')).toBe('')
  })
})

describe('Credential bridge', () => {
  it('设置：safeStorage 加密后发 credential.store（base64 密文、末四位），等 sidecar 确认后只回传提示', async () => {
    const secret = 'sk-test-0123456789abcd'
    const { channel, sent } = fakeChannel({ answer: acceptStore })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(), channel })
    expect(await bridge.set('p-1', `  ${secret}\n`)).toEqual({ ok: true, hint: 'abcd' })
    expect(sent).toHaveLength(1)
    const message = sent[0] as Extract<MainToSidecarMessage, { type: 'credential.store' }>
    expect(message).toMatchObject({ type: 'credential.store', providerId: 'p-1', hint: 'abcd' })
    expect(message.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(Buffer.from(message.ciphertext, 'base64').includes(secret)).toBe(false)
    expect(JSON.stringify(sent)).not.toContain(secret)
    // 去掉首尾空白后加密。
    expect(fakeEncryption().decrypt(Buffer.from(message.ciphertext, 'base64'))).toBe(secret)
  })

  it('safeStorage 不可用时拒绝保存，不发送任何消息', async () => {
    const { channel, sent } = fakeChannel({ answer: acceptStore })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(false), channel })
    expect(await bridge.set('p-1', 'sk-test-0123456789abcd')).toMatchObject({ ok: false, code: 'encryption-unavailable' })
    expect(sent).toEqual([])
  })

  it('输入不合要求、sidecar 未就绪、sidecar 拒绝或不回答时给出对应错误码', async () => {
    const encryption = fakeEncryption()
    const ok = fakeChannel({ answer: acceptStore }).channel
    const bridge = createCredentialBridge({ encryption, channel: ok })
    for (const [id, secret] of [
      ['', 'sk-valid-key-123'],
      ['p-1', '   '],
      ['p-1', 'x'.repeat(4097)],
      ['p-1', 'line\nbreak-key'],
      [42, 'sk-valid-key-123'],
    ] as const) {
      expect(await bridge.set(id as string, secret)).toMatchObject({ ok: false, code: 'invalid-input' })
    }

    const notReady = createCredentialBridge({ encryption, channel: fakeChannel({ ready: false }).channel })
    expect(await notReady.set('p-1', 'sk-valid-key-123')).toMatchObject({ ok: false, code: 'sidecar-unavailable' })

    const rejecting = createCredentialBridge({
      encryption,
      channel: fakeChannel({
        answer: (m) =>
          m.type === 'credential.store' ? { type: 'credential.store.result', requestId: m.requestId, ok: false, error: 'Provider p-1 not found' } : undefined,
      }).channel,
    })
    expect(await rejecting.set('p-1', 'sk-valid-key-123')).toEqual({ ok: false, code: 'rejected', message: 'Provider p-1 not found' })

    const silent = createCredentialBridge({ encryption, channel: fakeChannel().channel, timeoutMs: 50 })
    expect(await silent.set('p-1', 'sk-valid-key-123')).toMatchObject({ ok: false, code: 'timeout' })
  })

  it('Sidecar 在确认前退出时，挂起的 credential.store 立即以 sidecar-unavailable 结束，不等超时', async () => {
    const { channel, sent, deliver, exit } = fakeChannel()
    const bridge = createCredentialBridge({ encryption: fakeEncryption(), channel, timeoutMs: 60_000 })
    const pending = bridge.set('p-1', 'sk-valid-key-123')
    expect(sent).toHaveLength(1)
    const startedAt = performance.now()
    exit()
    expect(await pending).toMatchObject({ ok: false, code: 'sidecar-unavailable' })
    expect(performance.now() - startedAt).toBeLessThan(1000)
    // 迟到的确认不再影响已结束的请求；之后的请求照常等待确认。
    const { requestId } = sent[0] as Extract<MainToSidecarMessage, { type: 'credential.store' }>
    deliver({ type: 'credential.store.result', requestId, ok: true })
    const next = bridge.set('p-1', 'sk-valid-key-456')
    const second = sent[1] as Extract<MainToSidecarMessage, { type: 'credential.store' }>
    deliver({ type: 'credential.store.result', requestId: second.requestId, ok: true })
    expect(await next).toEqual({ ok: true, hint: '-456' })
  })

  it('解密：回答 credential.decrypt；safeStorage 失败或不可用时回答 error，不带明文', async () => {
    const encryption = fakeEncryption()
    const { channel, sent, deliver } = fakeChannel()
    createCredentialBridge({ encryption, channel })
    const ciphertext = Buffer.from(encryption.encrypt('sk-decrypt-me-0001')).toString('base64')
    deliver({ type: 'credential.decrypt', requestId: 3, ciphertext })
    deliver({ type: 'credential.decrypt', requestId: 4, ciphertext: Buffer.from([0xff, 1, 2]).toString('base64') })
    expect(sent).toEqual([
      { type: 'credential.decrypt.result', requestId: 3, plaintext: 'sk-decrypt-me-0001' },
      { type: 'credential.decrypt.result', requestId: 4, error: expect.stringContaining('decrypt') },
    ])

    const unavailable = fakeChannel()
    createCredentialBridge({ encryption: fakeEncryption(false), channel: unavailable.channel })
    unavailable.deliver({ type: 'credential.decrypt', requestId: 5, ciphertext })
    expect(unavailable.sent).toEqual([{ type: 'credential.decrypt.result', requestId: 5, error: expect.any(String) }])
  })
})

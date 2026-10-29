import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import type { CredentialChannel, Encryption } from './credentials.ts'
import { createSecretBridge } from './secrets.ts'

const fakeEncryption = (available = true): Encryption => ({
  isAvailable: () => available,
  encrypt: (plaintext) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)),
  decrypt: (ciphertext) => Buffer.from([...ciphertext].map((b) => b ^ 0x5a)).toString(),
})

function fakeChannel(answer?: (message: MainToSidecarMessage) => SidecarToMainMessage | undefined) {
  const sent: MainToSidecarMessage[] = []
  const listeners = new Set<(message: SidecarToMainMessage) => void>()
  const channel: CredentialChannel = {
    isReady: () => true,
    send(message) {
      sent.push(message)
      const reply = answer?.(message)
      if (reply) queueMicrotask(() => listeners.forEach((l) => l(reply)))
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onUnavailable: () => () => {},
  }
  return { channel, sent, deliver: (message: SidecarToMainMessage) => listeners.forEach((l) => l(message)) }
}

const accept = (message: MainToSidecarMessage): SidecarToMainMessage | undefined =>
  message.type === 'secret.store' ? { type: 'secret.store.result', requestId: message.requestId, ok: true } : undefined

describe('Secret bridge（ADR 0007）', () => {
  it('setSecret：safeStorage 加密后发 secret.store（名字、base64 密文、末四位），只回传提示', async () => {
    const value = 'postgres://u:p@db/app-0123'
    const { channel, sent } = fakeChannel(accept)
    const result = await createSecretBridge({ encryption: fakeEncryption(), channel }).set('MY_SERVICE_DSN', value)
    expect(result).toEqual({ ok: true, hint: '0123' })
    expect(sent).toHaveLength(1)
    const message = sent[0] as Extract<MainToSidecarMessage, { type: 'secret.store' }>
    expect(message).toMatchObject({ type: 'secret.store', name: 'MY_SERVICE_DSN', hint: '0123' })
    expect(JSON.stringify(message)).not.toContain(value)
    expect(fakeEncryption().decrypt(Buffer.from(message.ciphertext, 'base64'))).toBe(value)
  })

  it('名字不合规或值为空时 invalid-input；safeStorage 不可用时 encryption-unavailable，不发消息', async () => {
    const { channel, sent } = fakeChannel(accept)
    const bridge = createSecretBridge({ encryption: fakeEncryption(), channel })
    expect(await bridge.set('my-dsn', 'value')).toMatchObject({ ok: false, code: 'invalid-input' })
    expect(await bridge.set('DSN', '   ')).toMatchObject({ ok: false, code: 'invalid-input' })
    expect(await bridge.set('DSN', 42)).toMatchObject({ ok: false, code: 'invalid-input' })
    const unavailable = createSecretBridge({ encryption: fakeEncryption(false), channel })
    expect(await unavailable.set('DSN', 'value-1234')).toMatchObject({ ok: false, code: 'encryption-unavailable' })
    expect(sent).toEqual([])
  })

  it('secret.decrypt：回答明文；safeStorage 不可用时回答 error', async () => {
    const { channel, sent, deliver } = fakeChannel()
    createSecretBridge({ encryption: fakeEncryption(), channel })
    const ciphertext = Buffer.from(fakeEncryption().encrypt('plain')).toString('base64')
    deliver({ type: 'secret.decrypt', requestId: 3, ciphertext })
    expect(sent).toEqual([{ type: 'secret.decrypt.result', requestId: 3, plaintext: 'plain' }])
    const off = fakeChannel()
    createSecretBridge({ encryption: fakeEncryption(false), channel: off.channel })
    off.deliver({ type: 'secret.decrypt', requestId: 4, ciphertext })
    expect(off.sent).toEqual([{ type: 'secret.decrypt.result', requestId: 4, error: 'Encryption is not available on this system' }])
  })
})

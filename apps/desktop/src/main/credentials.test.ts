import type { MainToSidecarMessage, ProviderFields, SidecarToMainMessage } from '@coko/protocol'
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

const fields = {
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'https://gateway.example/v1',
  models: [{ id: 'custom-model-1', name: '', contextWindow: 128_000, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] }],
} satisfies ProviderFields
const saved = (credential: { hint: string } | null) => ({ ...fields, credential, createdAt: 1, updatedAt: 1 })

/** 模拟 sidecar 接受 provider.save，按是否带密文回答提示。 */
const acceptSave = (message: MainToSidecarMessage): SidecarToMainMessage | undefined =>
  message.type === 'provider.save'
    ? { type: 'provider.save.result', requestId: message.requestId, ok: true, provider: saved(message.credential ? { hint: message.credential.hint } : null) }
    : undefined

describe('credentialHint', () => {
  it('取末四位；短于 8 个字符的密钥不给提示，避免泄露大半', () => {
    expect(credentialHint('sk-abcdef123456')).toBe('3456')
    expect(credentialHint('1234567')).toBe('')
  })
})

describe('Provider 一次提交（ADR 0010）', () => {
  it('新建：safeStorage 加密后用一条 provider.save 发出配置、base64 密文与末四位；等 sidecar 确认后回传 Provider，不含密钥', async () => {
    const secret = 'sk-test-0123456789abcd'
    const { channel, sent } = fakeChannel({ answer: acceptSave })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(), channel })
    const result = await bridge.saveProvider({ mode: 'create', provider: fields, secret: `  ${secret}\n` })
    expect(result).toEqual({ ok: true, provider: saved({ hint: 'abcd' }) })
    expect(sent).toHaveLength(1)
    const message = sent[0] as Extract<MainToSidecarMessage, { type: 'provider.save' }>
    expect(message).toMatchObject({ type: 'provider.save', mode: 'create', provider: fields, credential: { hint: 'abcd' } })
    expect(message.credential!.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(JSON.stringify(sent)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(secret)
    // 去掉首尾空白后加密。
    expect(fakeEncryption().decrypt(Buffer.from(message.credential!.ciphertext, 'base64'))).toBe(secret)
  })

  it('编辑不带新 Key：消息不含 credential，表示保留原 Credential；此时不需要加密', async () => {
    const { channel, sent } = fakeChannel({ answer: acceptSave })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(false), channel })
    expect(await bridge.saveProvider({ mode: 'update', provider: fields })).toMatchObject({ ok: true })
    expect(sent).toEqual([{ type: 'provider.save', requestId: expect.any(Number), mode: 'update', provider: fields }])
  })

  it('加密不可用时拒绝整次提交，不发送任何消息', async () => {
    const { channel, sent } = fakeChannel({ answer: acceptSave })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(false), channel })
    expect(await bridge.saveProvider({ mode: 'create', provider: fields, secret: 'sk-test-0123456789abcd' })).toMatchObject({
      ok: false,
      code: 'encryption-unavailable',
    })
    expect(await bridge.saveProvider({ mode: 'update', provider: fields, secret: 'sk-test-0123456789abcd' })).toMatchObject({
      ok: false,
      code: 'encryption-unavailable',
    })
    const throwing = createCredentialBridge({
      encryption: {
        ...fakeEncryption(),
        encrypt: () => {
          throw new Error('keychain locked')
        },
      },
      channel,
    })
    expect(await throwing.saveProvider({ mode: 'create', provider: fields, secret: 'sk-test-0123456789abcd' })).toMatchObject({
      ok: false,
      code: 'encryption-unavailable',
    })
    expect(sent).toEqual([])
  })

  it('配置或 Key 不合要求时 invalid-input 且不发送：新建必须带 Key；配置按协议 schema 校验', async () => {
    const { channel, sent } = fakeChannel({ answer: acceptSave })
    const bridge = createCredentialBridge({ encryption: fakeEncryption(), channel })
    for (const input of [
      { mode: 'create', provider: fields },
      { mode: 'create', provider: fields, secret: '   ' },
      { mode: 'update', provider: fields, secret: 'x'.repeat(4097) },
      { mode: 'update', provider: fields, secret: 'line\nbreak-key' },
      { mode: 'update', provider: fields, secret: 42 },
      { mode: 'create', provider: { ...fields, id: 'Bad ID' }, secret: 'sk-valid-key-123' },
      { mode: 'create', provider: { ...fields, models: [] }, secret: 'sk-valid-key-123' },
      { mode: 'create', provider: { ...fields, kind: 'openai' }, secret: 'sk-valid-key-123' },
      { mode: 'upsert', provider: fields, secret: 'sk-valid-key-123' },
      null,
      'create',
    ]) {
      expect(await bridge.saveProvider(input)).toMatchObject({ ok: false, code: 'invalid-input' })
    }
    expect(sent).toEqual([])
  })

  it('sidecar 未就绪、拒绝或不回答时给出对应错误码；拒绝原样带回 sidecar 的错误码与 details', async () => {
    const encryption = fakeEncryption()
    const input = { mode: 'create', provider: fields, secret: 'sk-valid-key-123' }
    const notReady = createCredentialBridge({ encryption, channel: fakeChannel({ ready: false }).channel })
    expect(await notReady.saveProvider(input)).toMatchObject({ ok: false, code: 'sidecar-unavailable' })

    const rejecting = createCredentialBridge({
      encryption,
      channel: fakeChannel({
        answer: (m) =>
          m.type === 'provider.save'
            ? {
                type: 'provider.save.result',
                requestId: m.requestId,
                ok: false,
                error: {
                  code: 'already-exists',
                  message: 'Provider ID custom-provider-1 is already in use',
                  details: { field: 'id', id: 'custom-provider-1' },
                },
              }
            : undefined,
      }).channel,
    })
    expect(await rejecting.saveProvider(input)).toEqual({
      ok: false,
      code: 'already-exists',
      message: 'Provider ID custom-provider-1 is already in use',
      details: { field: 'id', id: 'custom-provider-1' },
    })

    const silent = createCredentialBridge({ encryption, channel: fakeChannel().channel, timeoutMs: 50 })
    expect(await silent.saveProvider(input)).toMatchObject({ ok: false, code: 'timeout' })
  })

  it('Sidecar 在确认前退出时，挂起的 provider.save 立即以 sidecar-unavailable 结束，不等超时', async () => {
    const { channel, sent, deliver, exit } = fakeChannel()
    const bridge = createCredentialBridge({ encryption: fakeEncryption(), channel, timeoutMs: 60_000 })
    const pending = bridge.saveProvider({ mode: 'create', provider: fields, secret: 'sk-valid-key-123' })
    expect(sent).toHaveLength(1)
    const startedAt = performance.now()
    exit()
    expect(await pending).toMatchObject({ ok: false, code: 'sidecar-unavailable' })
    expect(performance.now() - startedAt).toBeLessThan(1000)
    // 迟到的确认不再影响已结束的请求；之后的请求照常等待确认。
    const { requestId } = sent[0] as Extract<MainToSidecarMessage, { type: 'provider.save' }>
    deliver({ type: 'provider.save.result', requestId, ok: true, provider: saved({ hint: '-123' }) })
    const next = bridge.saveProvider({ mode: 'update', provider: fields, secret: 'sk-valid-key-456' })
    const second = sent[1] as Extract<MainToSidecarMessage, { type: 'provider.save' }>
    deliver({ type: 'provider.save.result', requestId: second.requestId, ok: true, provider: saved({ hint: '-456' }) })
    expect(await next).toEqual({ ok: true, provider: saved({ hint: '-456' }) })
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

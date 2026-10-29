import { createRequestTracker, RequestTimeoutError } from '@coko/protocol'
import type { SetSecretResult, SecretErrorCode } from '../shared/bridge.ts'
import { credentialHint, type CredentialChannel, type Encryption } from './credentials.ts'

// Secret 的 main 一侧（ADR 0007，沿用 ADR 0004 的通道）：renderer 经 preload 交来的值在这里用 safeStorage 加密，密文经控制 IPC
// secret.store 交给 Sidecar 存库；Sidecar 启动或连接 MCP Server 时经 secret.decrypt 请这里解密。明文不写日志、不回传 renderer。

export interface SecretBridge {
  set(name: unknown, value: unknown): Promise<SetSecretResult>
}

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const MAX_VALUE_LENGTH = 8192

const failure = (code: SecretErrorCode, message: string): SetSecretResult => ({ ok: false, code, message })

export function createSecretBridge(options: { encryption: Encryption; channel: CredentialChannel; timeoutMs?: number }): SecretBridge {
  const { encryption, channel } = options
  const stores = createRequestTracker<SetSecretResult | undefined>({
    timeoutMs: options.timeoutMs ?? 10_000,
    timeoutMessage: (ms) => `Sidecar did not confirm within ${ms} ms`,
  })
  channel.onUnavailable(() => stores.rejectAll(new Error('Sidecar exited before confirming')))
  channel.onMessage((message) => {
    if (message.type === 'secret.store.result') {
      stores.resolve(message.requestId, message.ok ? undefined : failure('rejected', message.error ?? 'Sidecar rejected the secret'))
      return
    }
    if (message.type !== 'secret.decrypt') return
    const { requestId } = message
    if (!encryption.isAvailable()) {
      channel.send({ type: 'secret.decrypt.result', requestId, error: 'Encryption is not available on this system' })
      return
    }
    try {
      const plaintext = encryption.decrypt(Buffer.from(message.ciphertext, 'base64'))
      if (plaintext === '') throw new Error('Decrypted secret is empty')
      channel.send({ type: 'secret.decrypt.result', requestId, plaintext })
    } catch (error) {
      // safeStorage 的错误信息不含明文或密文。
      channel.send({ type: 'secret.decrypt.result', requestId, error: error instanceof Error ? error.message : String(error) })
    }
  })

  return {
    async set(name, value) {
      if (typeof name !== 'string' || !NAME.test(name)) return failure('invalid-input', 'Secret names use A–Z, 0–9 and _ and start with a letter')
      if (typeof value !== 'string') return failure('invalid-input', 'Secret value must be a string')
      const secret = value.trim()
      if (secret === '' || secret.length > MAX_VALUE_LENGTH) return failure('invalid-input', `Secret value must be 1–${MAX_VALUE_LENGTH} characters`)
      if (!encryption.isAvailable()) return failure('encryption-unavailable', 'Encryption is not available on this system')
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')
      let ciphertext: string
      try {
        ciphertext = Buffer.from(encryption.encrypt(secret)).toString('base64')
      } catch (error) {
        return failure('encryption-unavailable', error instanceof Error ? error.message : String(error))
      }
      const hint = credentialHint(secret)
      try {
        const rejected = await stores.request((requestId) => channel.send({ type: 'secret.store', requestId, name, ciphertext, hint }))
        return rejected ?? { ok: true, hint }
      } catch (error) {
        if (error instanceof RequestTimeoutError) return failure('timeout', error.message)
        return failure('sidecar-unavailable', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

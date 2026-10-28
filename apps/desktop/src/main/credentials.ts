import { createRequestTracker, RequestTimeoutError, type MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'
import type { CredentialErrorCode, SetCredentialResult } from '../shared/bridge.ts'

// Credential 的 main 一侧（ADR 0004）：renderer 经 preload 交来的密钥在这里用 safeStorage 加密，
// 密文经控制 IPC 交给 Sidecar 存库；Sidecar 调用模型时经 credential.decrypt 请这里解密。
// 明文只在本进程内存中短暂存在，不写日志、不回传 renderer。

/** safeStorage 的最小接口，便于在测试中替换。 */
export interface Encryption {
  isAvailable(): boolean
  encrypt(plaintext: string): Uint8Array
  decrypt(ciphertext: Uint8Array): string
}

/** 与 Sidecar 的控制通道（SidecarProcess 提供）。 */
export interface CredentialChannel {
  isReady(): boolean
  send(message: MainToSidecarMessage): void
  onMessage(listener: (message: SidecarToMainMessage) => void): () => void
  /** 当前 Sidecar 意外退出；挂起的请求不会再得到回答。 */
  onUnavailable(listener: () => void): () => void
}

export interface CredentialBridge {
  set(providerId: unknown, secret: unknown): Promise<SetCredentialResult>
}

const MAX_SECRET_LENGTH = 4096
const MAX_PROVIDER_ID_LENGTH = 256
/** 提示只取末四位；更短的密钥露出四位就泄露了大半，不给提示。 */
const MIN_HINT_SOURCE = 8

export function credentialHint(secret: string): string {
  return secret.length >= MIN_HINT_SOURCE ? secret.slice(-4) : ''
}

const failure = (code: CredentialErrorCode, message: string): SetCredentialResult => ({ ok: false, code, message })

export function createCredentialBridge(options: { encryption: Encryption; channel: CredentialChannel; timeoutMs?: number }): CredentialBridge {
  const { encryption, channel } = options
  const timeoutMs = options.timeoutMs ?? 10_000
  /** 等待 credential.store.result；undefined 表示已保存。超时与 Sidecar 退出以拒绝结束，由 set 转成失败结果。 */
  const stores = createRequestTracker<SetCredentialResult | undefined>({ timeoutMs, timeoutMessage: (ms) => `Sidecar did not confirm within ${ms} ms` })

  channel.onUnavailable(() => stores.rejectAll(new Error('Sidecar exited before confirming')))
  channel.onMessage((message) => {
    if (message.type === 'credential.store.result') {
      stores.resolve(message.requestId, message.ok ? undefined : failure('rejected', message.error ?? 'Sidecar rejected the credential'))
      return
    }
    if (message.type !== 'credential.decrypt') return
    const { requestId } = message
    if (!encryption.isAvailable()) {
      channel.send({ type: 'credential.decrypt.result', requestId, error: 'Encryption is not available on this system' })
      return
    }
    try {
      const plaintext = encryption.decrypt(Buffer.from(message.ciphertext, 'base64'))
      if (plaintext === '') throw new Error('Decrypted credential is empty')
      channel.send({ type: 'credential.decrypt.result', requestId, plaintext })
    } catch (error) {
      // safeStorage 的错误信息不含明文或密文。
      channel.send({ type: 'credential.decrypt.result', requestId, error: error instanceof Error ? error.message : String(error) })
    }
  })

  return {
    async set(providerId, secret) {
      if (typeof providerId !== 'string' || providerId === '' || providerId.length > MAX_PROVIDER_ID_LENGTH)
        return failure('invalid-input', 'Invalid Provider id')
      if (typeof secret !== 'string') return failure('invalid-input', 'Credential must be a string')
      const key = secret.trim()
      if (key === '' || key.length > MAX_SECRET_LENGTH || /\s/.test(key))
        return failure('invalid-input', 'Credential must be 1–4096 characters without whitespace')
      if (!encryption.isAvailable()) return failure('encryption-unavailable', 'Encryption is not available on this system')
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')

      let ciphertext: string
      try {
        ciphertext = Buffer.from(encryption.encrypt(key)).toString('base64')
      } catch (error) {
        return failure('encryption-unavailable', error instanceof Error ? error.message : String(error))
      }
      const hint = credentialHint(key)
      try {
        const rejected = await stores.request((requestId) => channel.send({ type: 'credential.store', requestId, providerId, ciphertext, hint }))
        return rejected ?? { ok: true, hint }
      } catch (error) {
        if (error instanceof RequestTimeoutError) return failure('timeout', error.message)
        return failure('sidecar-unavailable', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

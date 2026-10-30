import { SECRET_NAME_PATTERN } from '@coko/protocol'
import type { SetSecretResult, SecretErrorCode } from '../shared/bridge.ts'
import type { SidecarControlChannel } from './control-channel.ts'
import { createEncryptingBridge, type Encryption } from './encrypting-bridge.ts'

// Secret 的 main 一侧（ADR 0007，沿用 ADR 0004 的通道）：renderer 经 preload 交来的值在这里用 safeStorage 加密，密文经控制 IPC
// secret.store 交给 Sidecar 存库；Sidecar 启动或连接 MCP Server 时经 secret.decrypt 请这里解密。明文不写日志、不回传 renderer。

export interface SecretBridge {
  set(name: unknown, value: unknown): Promise<SetSecretResult>
}

const NAME = new RegExp(SECRET_NAME_PATTERN)
const MAX_VALUE_LENGTH = 8192

const failure = (code: SecretErrorCode, message: string): SetSecretResult => ({ ok: false, code, message })

export function createSecretBridge(options: { encryption: Encryption; channel: SidecarControlChannel; timeoutMs?: number }): SecretBridge {
  const { encryption, channel } = options
  const bridge = createEncryptingBridge<SetSecretResult | undefined>({
    encryption,
    channel,
    decryptRequest: 'secret.decrypt',
    decryptResult: 'secret.decrypt.result',
    emptyMessage: 'Decrypted secret is empty',
    storeResult: (message) =>
      message.type === 'secret.store.result'
        ? { requestId: message.requestId, result: message.ok ? undefined : failure('rejected', message.error ?? 'Sidecar rejected the secret') }
        : undefined,
    failure,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  return {
    async set(name, value) {
      if (typeof name !== 'string' || !NAME.test(name)) return failure('invalid-input', 'Secret names use A–Z, 0–9 and _ and start with a letter')
      if (typeof value !== 'string') return failure('invalid-input', 'Secret value must be a string')
      const secret = value.trim()
      if (secret === '' || secret.length > MAX_VALUE_LENGTH) return failure('invalid-input', `Secret value must be 1–${MAX_VALUE_LENGTH} characters`)
      if (!encryption.isAvailable()) return failure('encryption-unavailable', 'Encryption is not available on this system')
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')
      const encrypted = bridge.encrypt(secret)
      if ('failed' in encrypted) return encrypted.failed!
      const { ciphertext, hint } = encrypted
      const rejected = await bridge.store((requestId) => channel.send({ type: 'secret.store', requestId, name, ciphertext, hint }))
      return rejected ?? { ok: true, hint }
    },
  }
}

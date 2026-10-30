import { Value } from 'typebox/value'
import { MAX_CREDENTIAL_LENGTH, ProviderFields, ProviderSaveMode, type MainProviderSave } from '@coko/protocol'
import type { ProviderSaveErrorCode, SaveProviderResult } from '../shared/bridge.ts'
import type { SidecarControlChannel } from './control-channel.ts'
import { createEncryptingBridge, type Encryption } from './encrypting-bridge.ts'

export { credentialHint, type Encryption } from './encrypting-bridge.ts'

// Provider 与 Credential 的 main 一侧（ADR 0004、0010）：renderer 经 preload 交来的草稿在这里校验，Key 用 safeStorage 加密，
// 配置与密文经一条 provider.save 控制消息交给 Sidecar 在一个事务中存库；Sidecar 调用模型时经 credential.decrypt 请这里解密。
// 明文只在本进程内存中短暂存在，不写日志、不回传 renderer。

export interface CredentialBridge {
  /** renderer 的输入未经信任：先按协议 schema 校验，再加密并发送。 */
  saveProvider(input: unknown): Promise<SaveProviderResult>
}

const failure = (code: ProviderSaveErrorCode, message: string, details?: Record<string, unknown>): SaveProviderResult => ({
  ok: false,
  code,
  message,
  ...(details ? { details } : {}),
})

/** 校验 renderer 交来的草稿；不合要求时给出失败结果。Key 去掉首尾空白。 */
function parseInput(input: unknown): { mode: ProviderSaveMode; provider: ProviderFields; secret: string | undefined } | SaveProviderResult {
  if (typeof input !== 'object' || input === null) return failure('invalid-input', 'Invalid Provider draft')
  const { mode, provider, secret } = input as Record<string, unknown>
  if (!Value.Check(ProviderSaveMode, mode) || !Value.Check(ProviderFields, provider)) return failure('invalid-input', 'Invalid Provider draft')
  if (secret === undefined) {
    if (mode === 'create') return failure('invalid-input', 'An API key is required for a new Provider')
    return { mode, provider, secret: undefined }
  }
  if (typeof secret !== 'string') return failure('invalid-input', 'API key must be a string')
  const key = secret.trim()
  if (key === '' || key.length > MAX_CREDENTIAL_LENGTH || /\s/.test(key))
    return failure('invalid-input', `API key must be 1–${MAX_CREDENTIAL_LENGTH} characters without whitespace`)
  return { mode, provider, secret: key }
}

export function createCredentialBridge(options: { encryption: Encryption; channel: SidecarControlChannel; timeoutMs?: number }): CredentialBridge {
  const { channel } = options
  // 等待 provider.save.result；超时与 Sidecar 退出转成失败结果。
  const bridge = createEncryptingBridge<SaveProviderResult>({
    encryption: options.encryption,
    channel,
    decryptRequest: 'credential.decrypt',
    decryptResult: 'credential.decrypt.result',
    emptyMessage: 'Decrypted credential is empty',
    storeResult: (message) =>
      message.type === 'provider.save.result'
        ? {
            requestId: message.requestId,
            result: message.ok ? { ok: true, provider: message.provider } : failure(message.error.code, message.error.message, message.error.details),
          }
        : undefined,
    failure: (code, message) => failure(code, message),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  return {
    async saveProvider(input) {
      const parsed = parseInput(input)
      if ('ok' in parsed) return parsed
      const { mode, provider, secret } = parsed
      // 加密在发送之前：不可用或失败时整次提交被拒绝，Sidecar 收不到任何消息。
      let credential: MainProviderSave['credential']
      if (secret !== undefined) {
        const encrypted = bridge.encrypt(secret)
        if ('failed' in encrypted) return encrypted.failed
        credential = encrypted
      }
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')
      return bridge.store((requestId) => channel.send({ type: 'provider.save', requestId, mode, provider, ...(credential ? { credential } : {}) }))
    },
  }
}

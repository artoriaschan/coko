import { Value } from 'typebox/value'
import { createRequestTracker, ProviderFields, ProviderSaveMode, RequestTimeoutError, type MainProviderSave } from '@coko/protocol'
import type { ProviderSaveErrorCode, SaveProviderResult } from '../shared/bridge.ts'
import type { SidecarControlChannel } from './control-channel.ts'

// Provider 与 Credential 的 main 一侧（ADR 0004、0010）：renderer 经 preload 交来的草稿在这里校验，Key 用 safeStorage 加密，
// 配置与密文经一条 provider.save 控制消息交给 Sidecar 在一个事务中存库；Sidecar 调用模型时经 credential.decrypt 请这里解密。
// 明文只在本进程内存中短暂存在，不写日志、不回传 renderer。

/** safeStorage 的最小接口，便于在测试中替换。 */
export interface Encryption {
  isAvailable(): boolean
  encrypt(plaintext: string): Uint8Array
  decrypt(ciphertext: Uint8Array): string
}

export interface CredentialBridge {
  /** renderer 的输入未经信任：先按协议 schema 校验，再加密并发送。 */
  saveProvider(input: unknown): Promise<SaveProviderResult>
}

const MAX_SECRET_LENGTH = 4096
/** 提示只取末四位；更短的密钥露出四位就泄露了大半，不给提示。 */
const MIN_HINT_SOURCE = 8

export function credentialHint(secret: string): string {
  return secret.length >= MIN_HINT_SOURCE ? secret.slice(-4) : ''
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
  if (key === '' || key.length > MAX_SECRET_LENGTH || /\s/.test(key)) return failure('invalid-input', 'API key must be 1–4096 characters without whitespace')
  return { mode, provider, secret: key }
}

export function createCredentialBridge(options: { encryption: Encryption; channel: SidecarControlChannel; timeoutMs?: number }): CredentialBridge {
  const { encryption, channel } = options
  const timeoutMs = options.timeoutMs ?? 10_000
  /** 等待 provider.save.result。超时与 Sidecar 退出以拒绝结束，由 saveProvider 转成失败结果。 */
  const saves = createRequestTracker<SaveProviderResult>({ timeoutMs, timeoutMessage: (ms) => `Sidecar did not confirm within ${ms} ms` })

  channel.onUnavailable(() => saves.rejectAll(new Error('Sidecar exited before confirming')))
  channel.onMessage((message) => {
    if (message.type === 'provider.save.result') {
      saves.resolve(
        message.requestId,
        message.ok ? { ok: true, provider: message.provider } : failure(message.error.code, message.error.message, message.error.details),
      )
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
    async saveProvider(input) {
      const parsed = parseInput(input)
      if ('ok' in parsed) return parsed
      const { mode, provider, secret } = parsed
      // 加密在发送之前：不可用或失败时整次提交被拒绝，Sidecar 收不到任何消息。
      let credential: MainProviderSave['credential']
      if (secret !== undefined) {
        if (!encryption.isAvailable()) return failure('encryption-unavailable', 'Encryption is not available on this system')
        try {
          credential = { ciphertext: Buffer.from(encryption.encrypt(secret)).toString('base64'), hint: credentialHint(secret) }
        } catch (error) {
          return failure('encryption-unavailable', error instanceof Error ? error.message : String(error))
        }
      }
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')
      try {
        return await saves.request((requestId) => channel.send({ type: 'provider.save', requestId, mode, provider, ...(credential ? { credential } : {}) }))
      } catch (error) {
        if (error instanceof RequestTimeoutError) return failure('timeout', error.message)
        return failure('sidecar-unavailable', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

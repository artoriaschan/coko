import { createRequestTracker, RequestTimeoutError, type MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'
import type { SidecarControlChannel } from './control-channel.ts'

// main 一侧的加密通道（Credential 与 Secret 共用，ADR 0004、0007）：用 safeStorage 加密 renderer 交来的值、等待 Sidecar 确认存库，
// 并回答 Sidecar 的解密请求。明文只在本进程内存中短暂存在，不写日志、不回传 renderer；safeStorage 的错误信息不含明文或密文。

/** safeStorage 的最小接口，便于在测试中替换。 */
export interface Encryption {
  isAvailable(): boolean
  encrypt(plaintext: string): Uint8Array
  decrypt(ciphertext: Uint8Array): string
}

/** 提示只取末四位；更短的密钥露出四位就泄露了大半，不给提示。 */
const MIN_HINT_SOURCE = 8

export function credentialHint(secret: string): string {
  return secret.length >= MIN_HINT_SOURCE ? secret.slice(-4) : ''
}

type DecryptRequest = Extract<SidecarToMainMessage, { type: 'credential.decrypt' | 'secret.decrypt' }>
type DecryptResult = Extract<MainToSidecarMessage, { type: 'credential.decrypt.result' | 'secret.decrypt.result' }>
type BridgeFailureCode = 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'

export interface EncryptingBridgeOptions<R> {
  encryption: Encryption
  channel: SidecarControlChannel
  /** Sidecar 的解密请求类型与回答类型。 */
  decryptRequest: DecryptRequest['type']
  decryptResult: DecryptResult['type']
  /** 解密结果为空时的错误文本。 */
  emptyMessage: string
  /** 存库请求的回答：消息属于本通道时返回结果（交付给等待中的请求），否则 undefined。 */
  storeResult(message: SidecarToMainMessage): { requestId: number; result: R } | undefined
  /** 通道自身的失败（加密不可用、Sidecar 不可用、超时）转为调用方的结果形状。 */
  failure(code: BridgeFailureCode, message: string): R
  timeoutMs?: number
}

export interface EncryptingBridge<R> {
  /** 加密一个值：返回 base64 密文与提示；不可用或失败时返回 failure。 */
  encrypt(plaintext: string): { ciphertext: string; hint: string } | { failed: R }
  /** 发送存库请求并等待 Sidecar 确认；超时与 Sidecar 退出转为 failure。 */
  store(send: (requestId: number) => void): Promise<R>
}

export function createEncryptingBridge<R>(options: EncryptingBridgeOptions<R>): EncryptingBridge<R> {
  const { encryption, channel, failure } = options
  const stores = createRequestTracker<R>({ timeoutMs: options.timeoutMs ?? 10_000, timeoutMessage: (ms) => `Sidecar did not confirm within ${ms} ms` })

  channel.onUnavailable(() => stores.rejectAll(new Error('Sidecar exited before confirming')))
  channel.onMessage((message) => {
    const stored = options.storeResult(message)
    if (stored) {
      stores.resolve(stored.requestId, stored.result)
      return
    }
    if (message.type !== options.decryptRequest) return
    const { requestId } = message
    const reply = (body: { plaintext: string } | { error: string }) => channel.send({ type: options.decryptResult, requestId, ...body } as DecryptResult)
    if (!encryption.isAvailable()) {
      reply({ error: 'Encryption is not available on this system' })
      return
    }
    try {
      const plaintext = encryption.decrypt(Buffer.from(message.ciphertext, 'base64'))
      if (plaintext === '') throw new Error(options.emptyMessage)
      reply({ plaintext })
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  return {
    encrypt(plaintext) {
      if (!encryption.isAvailable()) return { failed: failure('encryption-unavailable', 'Encryption is not available on this system') }
      try {
        return { ciphertext: Buffer.from(encryption.encrypt(plaintext)).toString('base64'), hint: credentialHint(plaintext) }
      } catch (error) {
        return { failed: failure('encryption-unavailable', error instanceof Error ? error.message : String(error)) }
      }
    },
    async store(send) {
      try {
        return await stores.request(send)
      } catch (error) {
        if (error instanceof RequestTimeoutError) return failure('timeout', error.message)
        return failure('sidecar-unavailable', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

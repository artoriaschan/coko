// 经控制 IPC 请 main 解密库中的密文（Credential 与 Secret 共用，ADR 0004、0007）：请求与回答按 requestId 配对，明文只缓存在进程内存。
import { createRequestTracker, type MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'
import type { ControlChannel } from '../control/channel.ts'

type DecryptRequest = Extract<SidecarToMainMessage, { type: 'credential.decrypt' | 'secret.decrypt' }>
type DecryptResult = Extract<MainToSidecarMessage, { type: 'credential.decrypt.result' | 'secret.decrypt.result' }>

export interface IpcDecryptorOptions {
  control: ControlChannel
  /** 发给 main 的请求类型。 */
  requestType: DecryptRequest['type']
  /** main 回答的消息类型。 */
  resultType: DecryptResult['type']
  /** 错误文本中的名称（Credential / Secret）。 */
  label: string
  /** 缺省 10 秒。 */
  timeoutMs?: number
}

export interface IpcDecryptor {
  /** 按 key 取明文：先查缓存，否则取密文（没有时 undefined）并请 main 解密。超时、中止与断开都拒绝。 */
  get(key: string, ciphertext: () => Promise<Uint8Array | undefined>, options?: { signal?: AbortSignal | undefined }): Promise<string | undefined>
  /** 当前在内存中的明文（按值脱敏的来源）。 */
  cachedValues(): string[]
  /** 清除某个 key 的明文缓存。 */
  invalidate(key: string): void
}

export function createIpcDecryptor(options: IpcDecryptorOptions): IpcDecryptor {
  const { control, requestType, resultType, label } = options
  const cache = new Map<string, string>()
  const decryptions = createRequestTracker<string>({
    timeoutMs: options.timeoutMs ?? 10_000,
    timeoutMessage: (ms) => `${label} decryption timed out after ${ms} ms`,
  })
  control.onMessage((message) => {
    if (message.type !== resultType) return
    const result = message as DecryptResult
    if ('plaintext' in result) decryptions.resolve(result.requestId, result.plaintext)
    else decryptions.reject(result.requestId, new Error(`${label} could not be decrypted: ${result.error}`))
  })
  control.onDisconnect(() => decryptions.rejectAll(new Error('Desktop app disconnected')))

  return {
    async get(key, ciphertext, getOptions) {
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const bytes = await ciphertext()
      if (!bytes) return undefined
      const plaintext = await decryptions.request(
        (requestId) => void control.send({ type: requestType, requestId, ciphertext: Buffer.from(bytes).toString('base64') }),
        { signal: getOptions?.signal },
      )
      cache.set(key, plaintext)
      return plaintext
    },
    cachedValues: () => [...cache.values()],
    invalidate: (key) => void cache.delete(key),
  }
}

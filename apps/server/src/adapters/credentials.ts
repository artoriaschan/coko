import type { Credential, CredentialInfo, CredentialStore } from '@coko/agent'
import type { ProviderRepository } from '@coko/session'
import type { ControlChannel } from '../control/channel.ts'

/** sidecar 不写 Credential：密钥由 main 加密后经 credential.store 进入库（ADR 0004）。 */
const readOnly = () => Promise.reject(new Error('Credentials are managed by the desktop app'))

export interface HostCredentialStore extends CredentialStore {
  /** 清除内存中的明文缓存。 */
  invalidate(providerId: string): void
}

/**
 * IPC 模式：需要明文时读库中的密文，经 credential.decrypt 请 main 解密，只缓存在进程内存。
 */
export function createIpcCredentialStore(options: { control: ControlChannel; providers: ProviderRepository; timeoutMs?: number }): HostCredentialStore {
  const { control, providers } = options
  const timeoutMs = options.timeoutMs ?? 10_000
  const cache = new Map<string, string>()
  const pending = new Map<number, { resolve: (plaintext: string) => void; reject: (error: Error) => void }>()
  let nextId = 1

  control.onMessage((message) => {
    if (message.type !== 'credential.decrypt.result') return
    const waiter = pending.get(message.requestId)
    pending.delete(message.requestId)
    if (!waiter) return
    if ('plaintext' in message) waiter.resolve(message.plaintext)
    else waiter.reject(new Error(`Credential could not be decrypted: ${message.error}`))
  })
  control.onDisconnect(() => {
    for (const waiter of pending.values()) waiter.reject(new Error('Desktop app disconnected'))
    pending.clear()
  })

  const decrypt = (ciphertext: Uint8Array, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const requestId = nextId++
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`Credential decryption timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          fn(value)
        }
      const onAbort = () => {
        pending.delete(requestId)
        settle(reject)(signal!.reason instanceof Error ? signal!.reason : new Error('Aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(requestId, { resolve: settle(resolve), reject: settle(reject) })
      void control.send({ type: 'credential.decrypt', requestId, ciphertext: Buffer.from(ciphertext).toString('base64') })
    })

  return {
    async read(providerId, readOptions) {
      readOptions?.signal?.throwIfAborted()
      const cached = cache.get(providerId)
      if (cached !== undefined) return { type: 'api_key', key: cached }
      const ciphertext = await providers.getCredentialCiphertext(providerId)
      if (!ciphertext) return undefined
      const plaintext = await decrypt(ciphertext, readOptions?.signal)
      cache.set(providerId, plaintext)
      return { type: 'api_key', key: plaintext } satisfies Credential
    },
    async list() {
      const all = await providers.list()
      return all.filter((p) => p.credential).map((p): CredentialInfo => ({ providerId: p.id, type: 'api_key' }))
    },
    modify: readOnly,
    delete: readOnly,
    invalidate: (providerId) => void cache.delete(providerId),
  }
}

const KIND_ENV: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

/** COKO_CREDENTIAL_<ID> 中 id 的写法：大写，非字母数字换成下划线。 */
export const credentialEnvName = (providerId: string) => `COKO_CREDENTIAL_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/**
 * 独立运行（无 IPC 父进程）：COKO_CREDENTIAL_<PROVIDER_ID> 优先，否则按 Provider kind 读
 * DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY。
 */
export function createEnvCredentialStore(options: { env: Readonly<Record<string, string | undefined>>; providers: ProviderRepository }): HostCredentialStore {
  const lookup = async (providerId: string) => {
    const explicit = options.env[credentialEnvName(providerId)]
    if (explicit) return explicit
    const provider = await options.providers.get(providerId)
    const name = provider ? KIND_ENV[provider.kind] : undefined
    return name ? options.env[name] || undefined : undefined
  }
  return {
    async read(providerId) {
      const key = await lookup(providerId)
      return key ? { type: 'api_key', key } : undefined
    },
    async list() {
      const result: CredentialInfo[] = []
      for (const provider of await options.providers.list()) if (await lookup(provider.id)) result.push({ providerId: provider.id, type: 'api_key' })
      return result
    },
    modify: readOnly,
    delete: readOnly,
    invalidate: () => {},
  }
}

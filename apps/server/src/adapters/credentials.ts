import { apiKeyEnvOf, PROVIDER_KINDS, type Credential, type CredentialInfo, type CredentialStore, type EnvExclusion, type SecretProvider } from '@coko/agent'
import { createRequestTracker } from '@coko/protocol'
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
  // 超时、中止与断开都拒绝；调用方（模型请求）把它当作取不到密钥。
  const decryptions = createRequestTracker<string>({ timeoutMs, timeoutMessage: (ms) => `Credential decryption timed out after ${ms} ms` })

  control.onMessage((message) => {
    if (message.type !== 'credential.decrypt.result') return
    if ('plaintext' in message) decryptions.resolve(message.requestId, message.plaintext)
    else decryptions.reject(message.requestId, new Error(`Credential could not be decrypted: ${message.error}`))
  })
  control.onDisconnect(() => decryptions.rejectAll(new Error('Desktop app disconnected')))

  const decrypt = (ciphertext: Uint8Array, signal?: AbortSignal) =>
    decryptions.request((requestId) => void control.send({ type: 'credential.decrypt', requestId, ciphertext: Buffer.from(ciphertext).toString('base64') }), {
      signal,
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

/**
 * 不传给 bash 等用户命令的 sidecar 环境变量：sidecar 自身配置（COKO_*，含 COKO_CREDENTIAL_*）、
 * 各 Provider kind 的密钥变量，以及名字带凭据形态的变量（*_API_KEY、*TOKEN*、*SECRET*、*PASSWORD* 等）。
 * PATH、HOME 等普通变量保留。
 */
export const HOST_ENV_EXCLUSIONS: readonly EnvExclusion[] = [
  /^COKO_/,
  ...PROVIDER_KINDS.flatMap((kind) => apiKeyEnvOf(kind) ?? []),
  /(^|_)API_?KEY($|_)/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSW(OR)?D/i,
  /(^|_)CREDENTIALS?($|_)/i,
  /(^|_)AUTH($|_)/i,
]

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
    const name = provider ? apiKeyEnvOf(provider.kind) : undefined
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

/**
 * 工具 Secrets（grilling B3）：按工具声明的变量名读 Sidecar 自身的环境。只有声明了该名字的工具在该次调用中拿到值；
 * bash 等用户命令的环境仍按 HOST_ENV_EXCLUSIONS 剔除。M3 的 MCP 接入真实使用者时再决定密钥来源与映射。
 */
export function createEnvSecretProvider(env: Readonly<Record<string, string | undefined>>): SecretProvider {
  return { get: (name) => env[name] || undefined }
}

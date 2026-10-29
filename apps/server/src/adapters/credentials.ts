import { apiKeyEnvOf, PROVIDER_KINDS, type Credential, type CredentialInfo, type CredentialStore, type EnvExclusion } from '@coko/agent'
import { createRequestTracker } from '@coko/protocol'
import type { ProviderRepository, SecretRepository } from '@coko/session'
import type { ControlChannel } from '../control/channel.ts'

/** sidecar 不写 Credential：密钥由 main 加密后经 credential.store 进入库（ADR 0004）。 */
const readOnly = () => Promise.reject(new Error('Credentials are managed by the desktop app'))

export interface HostCredentialStore extends CredentialStore {
  /** 清除内存中的明文缓存。 */
  invalidate(providerId: string): void
  /** 当前在内存中的明文（按值脱敏的来源，与 Secret 同一机制）。 */
  cachedValues(): string[]
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
    cachedValues: () => [...cache.values()],
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
    // 环境中的值启动时已知：COKO_CREDENTIAL_* 与各 Provider kind 的密钥变量全部登记，不必等到第一次读取。
    cachedValues: () =>
      Object.entries(options.env).flatMap(([key, value]) =>
        value && (key.startsWith('COKO_CREDENTIAL_') || PROVIDER_KINDS.some((kind) => apiKeyEnvOf(kind) === key)) ? [value] : [],
      ),
  }
}

// ---- Secrets（ADR 0007）：只来自登记条目 ----

/** 一个 Secret 来源：IPC 模式为库中登记的密文（经 main 解密），无界面运行为 COKO_SECRET_<NAME> 变量。 */
export interface SecretSource {
  readonly kind: 'stored' | 'environment'
  /** 登记的名字与末四位提示。 */
  list(): Promise<{ name: string; hint: string; updatedAt?: number }[]>
  /** 登记名字的明文；未登记时 undefined（不回退到进程环境）。 */
  get(name: string, options?: { signal?: AbortSignal }): Promise<string | undefined>
  /** 已解密、仍在内存中的值（脱敏用）。 */
  cachedValues(): string[]
  /** 清除某个名字的明文缓存（登记被替换或删除）。 */
  invalidate(name: string): void
}

const SECRET_ENV_PREFIX = 'COKO_SECRET_'
/** 无界面运行时 Secret <NAME> 的变量名；该前缀已被命令环境的 COKO_* 剔除规则覆盖。 */
export const secretEnvName = (name: string) => `${SECRET_ENV_PREFIX}${name}`
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
/** 与 Credential 相同：短于 8 个字符的值不给提示。 */
const hintOf = (value: string) => (value.length >= 8 ? value.slice(-4) : '')

/** IPC 模式：读库中的密文，经 secret.decrypt 请 main 解密，只缓存在进程内存。 */
export function createIpcSecretSource(options: { control: ControlChannel; secrets: SecretRepository; timeoutMs?: number }): SecretSource {
  const { control, secrets } = options
  const cache = new Map<string, string>()
  const decryptions = createRequestTracker<string>({
    timeoutMs: options.timeoutMs ?? 10_000,
    timeoutMessage: (ms) => `Secret decryption timed out after ${ms} ms`,
  })
  control.onMessage((message) => {
    if (message.type !== 'secret.decrypt.result') return
    if ('plaintext' in message) decryptions.resolve(message.requestId, message.plaintext)
    else decryptions.reject(message.requestId, new Error(`Secret could not be decrypted: ${message.error}`))
  })
  control.onDisconnect(() => decryptions.rejectAll(new Error('Desktop app disconnected')))
  return {
    kind: 'stored',
    list: async () => (await secrets.list()).map(({ name, hint, updatedAt }) => ({ name, hint, updatedAt })),
    async get(name, getOptions) {
      if (!SECRET_NAME.test(name)) return undefined
      const cached = cache.get(name)
      if (cached !== undefined) return cached
      const ciphertext = await secrets.getCiphertext(name)
      if (!ciphertext) return undefined
      const plaintext = await decryptions.request(
        (requestId) => void control.send({ type: 'secret.decrypt', requestId, ciphertext: Buffer.from(ciphertext).toString('base64') }),
        { signal: getOptions?.signal },
      )
      cache.set(name, plaintext)
      return plaintext
    },
    cachedValues: () => [...cache.values()],
    invalidate: (name) => void cache.delete(name),
  }
}

/** 无界面运行（测试、headless）：只读 COKO_SECRET_<NAME>；不能经接口登记或删除。 */
export function createEnvSecretSource(env: Readonly<Record<string, string | undefined>>): SecretSource {
  const names = () =>
    Object.keys(env)
      .filter((key) => key.startsWith(SECRET_ENV_PREFIX) && SECRET_NAME.test(key.slice(SECRET_ENV_PREFIX.length)) && env[key])
      .map((key) => key.slice(SECRET_ENV_PREFIX.length))
      .sort()
  const read = (name: string) => (SECRET_NAME.test(name) ? env[secretEnvName(name)] || undefined : undefined)
  return {
    kind: 'environment',
    list: async () => names().map((name) => ({ name, hint: hintOf(read(name)!) })),
    get: async (name) => read(name),
    cachedValues: () => names().map((name) => read(name)!),
    invalidate: () => {},
  }
}

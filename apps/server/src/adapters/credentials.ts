import { type Credential, type CredentialInfo, type CredentialStore, type EnvExclusion } from '@coko/agent'
import { SECRET_NAME_PATTERN } from '@coko/protocol'
import type { ProviderRepository, SecretRepository } from '@coko/session'
import type { ControlChannel } from '../control/channel.ts'
import { createIpcDecryptor } from './ipc-decryptor.ts'

/** sidecar 不经 CredentialStore 写 Credential：密钥由 main 加密后随 provider.save 一次进入库（ADR 0004、0010）。 */
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
  // 超时、中止与断开都拒绝；调用方（模型请求）把它当作取不到密钥。
  const decryptor = createIpcDecryptor({
    control,
    requestType: 'credential.decrypt',
    resultType: 'credential.decrypt.result',
    label: 'Credential',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  return {
    async read(providerId, readOptions) {
      readOptions?.signal?.throwIfAborted()
      const key = await decryptor.get(providerId, () => providers.getCredentialCiphertext(providerId), { signal: readOptions?.signal })
      return key === undefined ? undefined : ({ type: 'api_key', key } satisfies Credential)
    },
    async list() {
      const all = await providers.list()
      return all.filter((p) => p.credential).map((p): CredentialInfo => ({ providerId: p.id, type: 'api_key' }))
    },
    modify: readOnly,
    delete: readOnly,
    invalidate: (providerId) => decryptor.invalidate(providerId),
    cachedValues: () => decryptor.cachedValues(),
  }
}

/**
 * 不传给 bash 等用户命令的 sidecar 环境变量：sidecar 自身配置（COKO_*，含 COKO_CREDENTIAL_*）与名字带凭据形态的变量
 * （*_API_KEY、*TOKEN*、*SECRET*、*PASSWORD* 等）。PATH、HOME 等普通变量保留。
 */
export const HOST_ENV_EXCLUSIONS: readonly EnvExclusion[] = [
  /^COKO_/,
  /(^|_)API_?KEY($|_)/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSW(OR)?D/i,
  /(^|_)CREDENTIALS?($|_)/i,
  /(^|_)AUTH($|_)/i,
]

/** COKO_CREDENTIAL_<ID> 中 id 的写法：大写，非字母数字换成下划线。 */
export const credentialEnvName = (providerId: string) => `COKO_CREDENTIAL_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/** 独立运行（无 IPC 父进程）：只读 COKO_CREDENTIAL_<PROVIDER_ID>，不按品牌或协议回退到其他变量（ADR 0010）。 */
export function createEnvCredentialStore(options: { env: Readonly<Record<string, string | undefined>>; providers: ProviderRepository }): HostCredentialStore {
  const lookup = async (providerId: string) => options.env[credentialEnvName(providerId)] || undefined
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
    // 环境中的值启动时已知：COKO_CREDENTIAL_* 全部登记，不必等到第一次读取。
    cachedValues: () => Object.entries(options.env).flatMap(([key, value]) => (value && key.startsWith('COKO_CREDENTIAL_') ? [value] : [])),
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
const SECRET_NAME = new RegExp(SECRET_NAME_PATTERN)
/** 与 Credential 相同：短于 8 个字符的值不给提示。 */
const hintOf = (value: string) => (value.length >= 8 ? value.slice(-4) : '')

/** IPC 模式：读库中的密文，经 secret.decrypt 请 main 解密，只缓存在进程内存。 */
export function createIpcSecretSource(options: { control: ControlChannel; secrets: SecretRepository; timeoutMs?: number }): SecretSource {
  const { control, secrets } = options
  const decryptor = createIpcDecryptor({
    control,
    requestType: 'secret.decrypt',
    resultType: 'secret.decrypt.result',
    label: 'Secret',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  return {
    kind: 'stored',
    list: async () => (await secrets.list()).map(({ name, hint, updatedAt }) => ({ name, hint, updatedAt })),
    async get(name, getOptions) {
      if (!SECRET_NAME.test(name)) return undefined
      return decryptor.get(name, () => secrets.getCiphertext(name), { signal: getOptions?.signal })
    },
    cachedValues: () => decryptor.cachedValues(),
    invalidate: (name) => decryptor.invalidate(name),
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

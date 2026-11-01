import {
  createModelRegistry,
  InMemoryCredentialStore,
  ModelConfigError,
  selectableThinkingLevels,
  type ModelProtocol as AgentModelProtocol,
  type ModelRegistry,
  type ModelSpec,
  type ProviderConfig,
  type ThinkingLevel as AgentThinkingLevel,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import { DEFAULT_MODEL_SETTING, ProviderFields as ProviderFieldsSchema, SessionModel as SessionModelSchema } from '@coko/protocol'
import type {
  AvailableModel,
  CatalogModel,
  MainToSidecarMessage,
  ModelProtocol,
  Provider,
  ProviderFields,
  ProviderReferencesResponse,
  ProviderSaveMode,
  SessionModel,
  SidecarToMainMessage,
  ThinkingLevel,
} from '@coko/protocol'
import { Value } from 'typebox/value'
import {
  isStoreError,
  type CredentialRecord,
  type Provider as StoredProvider,
  type ProviderInput,
  type SessionStore,
  type ThinkingLevel as StoredThinkingLevel,
} from '@coko/session'
import { AppError, toAppError } from './errors.ts'

const log = getLogger(['application', 'providers'])

// 协议 schema 与 packages/agent 的协议表、档位表必须一致：任一侧增删而另一侧未跟上时，这里编译失败。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type ModelProtocolsAgree = Assert<Equal<ModelProtocol, AgentModelProtocol>>
export type ThinkingLevelsAgree = Assert<Equal<ThinkingLevel, AgentThinkingLevel>>
export type SessionThinkingLevelsAgree = Assert<Equal<ThinkingLevel, StoredThinkingLevel>>
// Model Catalog 的协议结构可以原样作为 registry 的模型配置。
export type CatalogMatchesModelSpec = Assert<Equal<CatalogModel, ModelSpec>>

/** 库中的 Model Catalog：写入前已按协议 schema 校验，读回原样使用。 */
export const catalogOf = (provider: Pick<StoredProvider, 'models'>): CatalogModel[] => provider.models as CatalogModel[]

export function toProviderConfig(provider: Pick<StoredProvider, 'id' | 'name' | 'api' | 'baseUrl' | 'models'>): ProviderConfig {
  return { id: provider.id, name: provider.name, api: provider.api as ModelProtocol, baseUrl: provider.baseUrl, models: catalogOf(provider) }
}

export function toProviderDto(provider: StoredProvider): Provider {
  return { ...provider, api: provider.api as ModelProtocol, models: catalogOf(provider) }
}

/** 存储层对 Provider 的拒绝转为协议错误：ID 已被使用为 already-exists，不存在为 not-found；其余原样抛出。 */
async function storeCall<T>(id: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (isStoreError(error, 'already-exists')) throw new AppError('already-exists', `Provider ID ${id} is already in use`, { field: 'id', id })
    if (isStoreError(error, 'not-found')) throw new AppError('not-found', `Provider ${id} not found`)
    throw error
  }
}

/** 先在临时 registry 中构造，配置无效时以 bad-request 拒绝，不写库。 */
function validate(config: ProviderConfig): void {
  try {
    createModelRegistry({ credentials: new InMemoryCredentialStore(), providers: [config] })
  } catch (error) {
    if (error instanceof ModelConfigError) throw new AppError('bad-request', error.message)
    throw error
  }
}

/**
 * 无界面运行的 Provider 配置文件（ADR 0019）：连接信息与 Model Catalog，不含密钥；defaultModel 为 `<providerId>/<modelId>`。
 * 字段在 upsertFromConfig 中校验（文件内容是不可信输入）。
 */
export interface ProviderConfigFile {
  providers: ProviderFields[]
  defaultModel?: string
}

export interface ProviderConfigResult {
  created: string[]
  updated: string[]
  defaultModel?: SessionModel
}

/** 密钥形态的字段名（任意深度）：配置文件只放连接信息，密钥只读 COKO_CREDENTIAL_<ID>。 */
const SECRET_FIELD = /^(?:api[-_]?key|apikey|secret|token|access[-_]?token|password|credentials?|authorization)$/i

function secretField(value: unknown, path: string): string | undefined {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = secretField(value[i], `${path}[${i}]`)
      if (found) return found
    }
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) return `${path}.${key}`
    const found = secretField(child, `${path}.${key}`)
    if (found) return found
  }
  return undefined
}

export interface ProviderServiceOptions {
  store: SessionStore
  registry: ModelRegistry
  /** Credential 变化或 Provider 删除时清除 sidecar 内存中的明文缓存。 */
  invalidateCredential: (providerId: string) => void
}

/** Provider 配置的增改删，并保持模型 registry 与库一致。密钥只以 main 加密的密文进入库。 */
export class ProviderService {
  readonly #options: ProviderServiceOptions

  constructor(options: ProviderServiceOptions) {
    this.#options = options
  }

  /** 启动时把库中的 Provider 注册到 registry；单个配置无效只记录警告。 */
  async load(): Promise<void> {
    for (const provider of await this.#options.store.providers.list()) {
      try {
        this.#options.registry.setProvider(toProviderConfig(provider))
      } catch (error) {
        log.warn('provider skipped: invalid configuration', { providerId: provider.id, error: String(error) })
      }
    }
  }

  async list(): Promise<Provider[]> {
    return (await this.#options.store.providers.list()).map(toProviderDto)
  }

  /** registry 中已注册的模型（含测试用 faux），按 Provider 登记顺序；各带会话中可选的 Thinking Level。 */
  models(): AvailableModel[] {
    const { models } = this.#options.registry
    return models.getProviders().flatMap((provider) =>
      models.getModels(provider.id).map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        name: model.name,
        thinkingLevels: selectableThinkingLevels(model),
      })),
    )
  }

  /**
   * 一次提交（ADR 0010）：配置与可选的 Credential 密文（main 加密，base64）在一个事务中写入。create 时 ID 已被使用为
   * already-exists；update 时 Provider 不存在为 not-found；配置无效为 bad-request。失败时配置与密文都不写入。
   * update 不带 credential 时保留原 Credential；带 credential 时替换并清除 sidecar 内存中的明文缓存。
   */
  async save(mode: ProviderSaveMode, fields: ProviderFields, credential?: { ciphertext: string; hint: string }): Promise<Provider> {
    const { id, name, api, baseUrl, models } = fields
    const record: ProviderInput = { id, name, api, baseUrl, models }
    const secret: CredentialRecord | undefined = credential && {
      ciphertext: new Uint8Array(Buffer.from(credential.ciphertext, 'base64')),
      hint: credential.hint,
    }
    validate(toProviderConfig(record))
    const { providers } = this.#options.store
    const saved = await storeCall(id, () =>
      mode === 'create' ? providers.create(record, secret) : providers.update(id, { name, api, baseUrl, models }, secret),
    )
    this.#options.registry.setProvider(toProviderConfig(saved))
    if (secret) this.#options.invalidateCredential(id)
    log.info('provider saved', { providerId: id, mode, api, credential: secret ? 'replaced' : 'kept' })
    return toProviderDto(saved)
  }

  /**
   * 无界面运行的启动配置（ADR 0019：ADR 0010 之外、只在 headless 装配中可用，不经 HTTP 与控制消息）：整份文件先校验（密钥形态的字段、
   * 协议 schema、registry 能否构造、defaultModel 是否指向文件或库中的模型），全部通过后才写入；写入中途失败时把已写入的新建删除、更新
   * 恢复原值，库中不留下半份配置。只写连接信息与 Model Catalog，已有的 Credential 不变；没有任何密钥进入库。
   */
  async upsertFromConfig(config: ProviderConfigFile): Promise<ProviderConfigResult> {
    if (typeof config !== 'object' || config === null || !Array.isArray(config.providers))
      throw new AppError('bad-request', 'The provider config must be an object with a providers array')
    const leaked = secretField(config, 'config')
    if (leaked)
      throw new AppError('bad-request', `The provider config must not contain secrets (${leaked}); pass keys in COKO_CREDENTIAL_<ID>`, {
        reason: 'secret-in-config',
        field: leaked,
      })
    const unknownKeys = Object.keys(config).filter((key) => key !== 'providers' && key !== 'defaultModel')
    if (unknownKeys.length > 0) throw new AppError('bad-request', `Unknown provider config field: ${unknownKeys[0]}`)
    const ids = new Set<string>()
    for (const [index, fields] of config.providers.entries()) {
      if (!Value.Check(ProviderFieldsSchema, fields)) {
        const first = [...Value.Errors(ProviderFieldsSchema, fields)][0]
        throw new AppError('bad-request', `providers[${index}] is invalid${first ? `: ${first.instancePath || '/'} ${first.message}` : ''}`)
      }
      if (ids.has(fields.id)) throw new AppError('bad-request', `Provider ${fields.id} appears twice in the config`)
      ids.add(fields.id)
      validate(toProviderConfig(fields))
    }
    const { providers, settings } = this.#options.store
    let defaultModel: SessionModel | undefined
    if (config.defaultModel !== undefined) {
      const [providerId, modelId, extra] = typeof config.defaultModel === 'string' ? config.defaultModel.split('/') : []
      const inFile = config.providers.find((p) => p.id === providerId)
      const models = inFile ? inFile.models : providerId ? ((await providers.get(providerId))?.models as CatalogModel[] | undefined) : undefined
      if (!providerId || !modelId || extra !== undefined || !models?.some((m) => m.id === modelId))
        throw new AppError('bad-request', 'defaultModel must be <providerId>/<modelId> of a configured model')
      defaultModel = { providerId, modelId }
    }

    const existing = new Map((await providers.list()).map((p) => [p.id, p]))
    const created: string[] = []
    const updated: StoredProvider[] = []
    const previousDefault = await settings.get(DEFAULT_MODEL_SETTING)
    try {
      for (const { id, name, api, baseUrl, models } of config.providers) {
        const before = existing.get(id)
        if (before) {
          await providers.update(id, { name, api, baseUrl, models })
          updated.push(before)
        } else {
          await providers.create({ id, name, api, baseUrl, models })
          created.push(id)
        }
      }
      if (defaultModel) await settings.set(DEFAULT_MODEL_SETTING, defaultModel, previousDefault?.revision ?? 0)
    } catch (error) {
      // 补偿：同一进程持有库的租约，没有并发写入方；按相反顺序撤销。
      for (const id of created.reverse()) await providers.delete(id).catch(() => undefined)
      for (const before of updated.reverse())
        await providers.update(before.id, { name: before.name, api: before.api, baseUrl: before.baseUrl, models: before.models }).catch(() => undefined)
      log.error('provider config rolled back', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    for (const fields of config.providers) this.#options.registry.setProvider(toProviderConfig(fields))
    log.info('provider config applied', { created, updated: updated.map((p) => p.id), ...(defaultModel ? { defaultModel } : {}) })
    return { created, updated: updated.map((p) => p.id), ...(defaultModel ? { defaultModel } : {}) }
  }

  /** 引用该 Provider 的 Session 数量；不存在时 not-found。 */
  references(id: string): Promise<ProviderReferencesResponse> {
    return storeCall(id, () => this.#options.store.providers.references(id))
  }

  /**
   * 删除 Provider 与其 Credential，并清除 sidecar 内存中的明文缓存。引用它的 Session 模型字段在同一事务中清空（下次运行前要求
   * 重新选择模型）；默认模型设置指向它时在同一事务中改为 null，默认模型因此回退为第一个可用模型（SessionService.defaultModel），
   * 以后用相同 ID 重新创建也不会接回。
   */
  async delete(id: string): Promise<void> {
    const pointsHere = (value: unknown) => Value.Check(SessionModelSchema, value) && value.providerId === id
    const deleted = await storeCall(id, () =>
      this.#options.store.providers.delete(id, { settings: [{ key: DEFAULT_MODEL_SETTING, when: pointsHere, value: null }] }),
    )
    this.#options.registry.deleteProvider(id)
    this.#options.invalidateCredential(id)
    log.info('provider deleted', { providerId: id, sessionsCleared: deleted.sessions, defaultModelCleared: deleted.settings.includes(DEFAULT_MODEL_SETTING) })
  }
}

/** 控制通道中本模块用到的部分。 */
export interface ProviderSaveChannel {
  send(message: SidecarToMainMessage): Promise<void>
  onMessage(listener: (message: MainToSidecarMessage) => void): () => void
}

/**
 * 回答 main 的 provider.save（ADR 0010：Provider 只经 main 的一次提交保存，HTTP 只提供列表与删除）。失败按协议错误码回答；
 * 意外错误为 internal（不带原文）并记录日志。
 */
export function serveProviderSave(options: { control: ProviderSaveChannel; providers: Pick<ProviderService, 'save'> }): void {
  const { control, providers } = options
  control.onMessage((msg) => {
    if (msg.type !== 'provider.save') return
    const { requestId } = msg
    providers.save(msg.mode, msg.provider, msg.credential).then(
      (provider) => control.send({ type: 'provider.save.result', requestId, ok: true, provider }),
      (error: unknown) => {
        const appError = toAppError(error)
        if (appError.code === 'internal' || appError.code === 'storage-unavailable')
          log.error('provider save failed', { error: error instanceof Error ? error.message : String(error) })
        return control.send({
          type: 'provider.save.result',
          requestId,
          ok: false,
          error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
        })
      },
    )
  })
}

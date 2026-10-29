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
import type {
  AvailableModel,
  CatalogModel,
  ModelProtocol,
  Provider,
  ProviderFields,
  ProviderReferencesResponse,
  ProviderSaveMode,
  ThinkingLevel,
} from '@coko/protocol'
import { isStoreError, type CredentialRecord, type Provider as StoredProvider, type ProviderInput, type SessionStore } from '@coko/session'
import { AppError } from './errors.ts'

const log = getLogger(['application', 'providers'])

// 协议 schema 与 packages/agent 的协议表、档位表必须一致：任一侧增删而另一侧未跟上时，这里编译失败。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type ModelProtocolsAgree = Assert<Equal<ModelProtocol, AgentModelProtocol>>
export type ThinkingLevelsAgree = Assert<Equal<ThinkingLevel, AgentThinkingLevel>>
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

  /** 引用该 Provider 的 Session 数量；不存在时 not-found。 */
  references(id: string): Promise<ProviderReferencesResponse> {
    return storeCall(id, () => this.#options.store.providers.references(id))
  }

  /**
   * 删除 Provider 与其 Credential，并清除 sidecar 内存中的明文缓存。引用它的 Session 模型字段在同一事务中清空（下次运行前要求
   * 重新选择模型），默认模型设置指向它时改为 null（回退为第一个可用模型）；以后用相同 ID 重新创建也不会接回。
   */
  async delete(id: string): Promise<void> {
    const cleared = await storeCall(id, () => this.#options.store.providers.delete(id))
    this.#options.registry.deleteProvider(id)
    this.#options.invalidateCredential(id)
    log.info('provider deleted', { providerId: id, sessionsCleared: cleared.sessions })
  }
}

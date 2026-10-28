import {
  createModelRegistry,
  InMemoryCredentialStore,
  ModelConfigError,
  protocolOf,
  providerPresets,
  type ModelProtocol as AgentModelProtocol,
  type ModelRegistry,
  type ProviderConfig,
  type ProviderKind as AgentProviderKind,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { AvailableModel, CreateProviderRequest, ModelProtocol, Provider, ProviderKind, ProviderPreset, UpdateProviderRequest } from '@coko/protocol'
import type { Provider as StoredProvider, ProviderInput, SessionStore } from '@coko/session'
import { AppError } from './errors.ts'

const log = getLogger(['application', 'providers'])

// 协议 schema 与 packages/agent 的 kind 表（PROVIDER_KINDS）必须一致：任一侧增删 kind 或协议而另一侧未跟上时，这里编译失败。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type ProviderKindsAgree = Assert<Equal<ProviderKind, AgentProviderKind>>
export type ModelProtocolsAgree = Assert<Equal<ModelProtocol, AgentModelProtocol>>

export function toProviderConfig(provider: Pick<StoredProvider, 'id' | 'name' | 'kind' | 'baseUrl' | 'models'>): ProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind as ProviderKind,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    models: provider.models.map((id) => ({ id })),
  }
}

export function toProviderDto(provider: StoredProvider): Provider {
  return { ...provider, kind: provider.kind as ProviderKind, api: provider.api as ModelProtocol }
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

  presets(): ProviderPreset[] {
    return providerPresets().map(({ kind, name, baseUrl, models }) => ({ kind, name, baseUrl, models }))
  }

  /** registry 中已注册的模型（含测试用 faux），按 Provider 登记顺序。 */
  models(): AvailableModel[] {
    const { models } = this.#options.registry
    return models
      .getProviders()
      .flatMap((provider) =>
        models.getModels(provider.id).map((model) => ({ providerId: provider.id, providerName: provider.name, modelId: model.id, name: model.name })),
      )
  }

  async create(input: CreateProviderRequest): Promise<Provider> {
    const baseUrl = input.baseUrl ?? ''
    if (input.kind === 'openai-compatible' && !baseUrl) throw new AppError('bad-request', 'openai-compatible Provider needs a baseUrl')
    const record: ProviderInput = { name: input.name, kind: input.kind, api: protocolOf(input.kind), baseUrl, models: input.models }
    validate(toProviderConfig({ id: 'validate', ...record }))
    const created = await this.#options.store.providers.create(record)
    this.#options.registry.setProvider(toProviderConfig(created))
    log.info('provider created', { providerId: created.id, kind: created.kind })
    return toProviderDto(created)
  }

  async update(id: string, patch: UpdateProviderRequest): Promise<Provider> {
    const current = await this.#options.store.providers.get(id)
    if (!current) throw new AppError('not-found', `Provider ${id} not found`)
    const next = { ...current, ...patch }
    if (next.kind === 'openai-compatible' && !next.baseUrl) throw new AppError('bad-request', 'openai-compatible Provider needs a baseUrl')
    validate(toProviderConfig(next))
    const updated = await this.#options.store.providers.update(id, patch)
    this.#options.registry.setProvider(toProviderConfig(updated))
    return toProviderDto(updated)
  }

  async delete(id: string): Promise<void> {
    if (!(await this.#options.store.providers.get(id))) throw new AppError('not-found', `Provider ${id} not found`)
    await this.#options.store.providers.delete(id)
    this.#options.registry.deleteProvider(id)
    this.#options.invalidateCredential(id)
    log.info('provider deleted', { providerId: id })
  }

  /** 保存 main 加密的密文（base64）与末四位提示。 */
  async storeCredential(id: string, ciphertext: string, hint: string): Promise<void> {
    if (!(await this.#options.store.providers.get(id))) throw new AppError('not-found', `Provider ${id} not found`)
    await this.#options.store.providers.setCredential(id, { ciphertext: new Uint8Array(Buffer.from(ciphertext, 'base64')), hint })
    this.#options.invalidateCredential(id)
    log.info('credential stored', { providerId: id })
  }
}

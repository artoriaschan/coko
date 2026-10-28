import {
  createModels,
  createProvider,
  type ApiKeyAuth,
  type CredentialStore,
  type Model,
  type MutableModels,
  type ProviderStreams,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'

/** Wire protocols Coko supports in M1. */
export type ModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

/** Provider kinds: the three presets plus a custom OpenAI-compatible endpoint. */
export type ProviderKind = 'deepseek' | 'openai' | 'anthropic' | 'openai-compatible'

export interface ModelSpec {
  id: string
  name?: string
  /** Required for models outside the preset catalog. */
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  input?: ('text' | 'image')[]
}

export interface ProviderConfig {
  /** Provider id; also the CredentialStore key. */
  id: string
  name?: string
  kind: ProviderKind
  /** Required for `openai-compatible`; overrides the preset address otherwise. */
  baseUrl?: string
  headers?: Record<string, string>
  models: ModelSpec[]
}

export class ModelConfigError extends Error {
  override readonly name = 'ModelConfigError'
}

interface Preset {
  name: string
  protocol: ModelProtocol
  baseUrl: string
  catalog: Readonly<Record<string, Model<any>>>
}

const PRESETS: Record<Exclude<ProviderKind, 'openai-compatible'>, Preset> = {
  deepseek: { name: 'DeepSeek', protocol: 'openai-completions', baseUrl: 'https://api.deepseek.com', catalog: DEEPSEEK_MODELS },
  openai: { name: 'OpenAI', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', catalog: OPENAI_MODELS },
  anthropic: { name: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', catalog: ANTHROPIC_MODELS },
}

const PROTOCOL_STREAMS: Record<ModelProtocol, () => ProviderStreams> = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
}

/** Api-key auth that reads only the CredentialStore entry; no environment fallback in the Sidecar. */
function storedApiKeyAuth(name: string): ApiKeyAuth {
  return {
    name: `${name} API key`,
    resolve: async ({ credential, signal }) => {
      signal.throwIfAborted()
      if (credential?.key) return { auth: { apiKey: credential.key }, source: 'stored credential' }
      return undefined
    },
  }
}

const OPENAI_COMPATIBLE_DEFAULTS = { contextWindow: 128_000, maxTokens: 16_384 }

function buildModel(config: ProviderConfig, spec: ModelSpec, baseUrl: string): Model<any> {
  const preset = config.kind === 'openai-compatible' ? undefined : PRESETS[config.kind]
  const catalogModel = preset?.catalog[spec.id]
  const overrides = {
    ...(spec.name === undefined ? {} : { name: spec.name }),
    ...(spec.contextWindow === undefined ? {} : { contextWindow: spec.contextWindow }),
    ...(spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens }),
    ...(spec.reasoning === undefined ? {} : { reasoning: spec.reasoning }),
    ...(spec.input === undefined ? {} : { input: spec.input }),
  }
  if (catalogModel) {
    return { ...catalogModel, ...overrides, provider: config.id, baseUrl, ...(config.headers ? { headers: config.headers } : {}) }
  }
  const defaults = preset ? undefined : OPENAI_COMPATIBLE_DEFAULTS
  const contextWindow = spec.contextWindow ?? defaults?.contextWindow
  const maxTokens = spec.maxTokens ?? defaults?.maxTokens
  if (contextWindow === undefined || maxTokens === undefined) {
    throw new ModelConfigError(`Model "${spec.id}" is not in the ${config.kind} catalog; set contextWindow and maxTokens`)
  }
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    api: preset?.protocol ?? 'openai-completions',
    provider: config.id,
    baseUrl,
    reasoning: spec.reasoning ?? false,
    input: spec.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    ...(config.headers ? { headers: config.headers } : {}),
  }
}

function buildProvider(config: ProviderConfig) {
  const preset = config.kind === 'openai-compatible' ? undefined : PRESETS[config.kind]
  const baseUrl = config.baseUrl ?? preset?.baseUrl
  if (!baseUrl) throw new ModelConfigError(`Provider "${config.id}" of kind openai-compatible needs a baseUrl`)
  const name = config.name ?? preset?.name ?? config.id
  const models = config.models.map((spec) => buildModel(config, spec, baseUrl))
  return createProvider({
    id: config.id,
    name,
    baseUrl,
    ...(config.headers ? { headers: config.headers } : {}),
    auth: { apiKey: storedApiKeyAuth(name) },
    models,
    api: Object.fromEntries(Object.entries(PROTOCOL_STREAMS).map(([protocol, streams]) => [protocol, streams()])),
  })
}

export interface ModelRegistry {
  /** pi-ai collection used for requests; Agent's stream function is `models.streamSimple`. */
  readonly models: MutableModels
  /** Add or replace a Provider from its configuration. */
  setProvider(config: ProviderConfig): void
  deleteProvider(id: string): void
}

export interface ModelRegistryOptions {
  credentials: CredentialStore
  providers?: ProviderConfig[]
}

export function createModelRegistry({ credentials, providers = [] }: ModelRegistryOptions): ModelRegistry {
  // No ambient environment: request auth only comes from the CredentialStore.
  const models = createModels({
    credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
    identity: { attribution: null },
  })
  const registry: ModelRegistry = {
    models,
    setProvider: (config) => models.setProvider(buildProvider(config)),
    deleteProvider: (id) => models.deleteProvider(id),
  }
  for (const config of providers) registry.setProvider(config)
  return registry
}

/** Look up a configured model; throws ModelConfigError when the Provider or model is unknown. */
export function resolveModel(registry: Pick<ModelRegistry, 'models'>, providerId: string, modelId: string): Model<any> {
  const model = registry.models.getModel(providerId, modelId)
  if (!model) throw new ModelConfigError(`Unknown model "${modelId}" for provider "${providerId}"`)
  return model
}

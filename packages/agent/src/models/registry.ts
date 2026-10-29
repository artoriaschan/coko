import {
  createModels,
  createProvider,
  getSupportedThinkingLevels,
  type ApiKeyAuth,
  type CredentialStore,
  type Model,
  type ModelThinkingLevel,
  type MutableModels,
  type ProviderStreams,
  type ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'

/** Wire protocols Coko supports; each Provider stores one of them. */
export const MODEL_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number]

/** The seven Thinking Levels in their fixed order (pi-ai's `MODEL_THINKING_LEVELS`). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly ModelThinkingLevel[]
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** A configured Thinking Level: `off` has no API value (each protocol sends its own default); the others send `value`. */
export type ThinkingLevelSpec = { level: 'off' } | { level: Exclude<ThinkingLevel, 'off'>; value: string }

/** One Model Catalog entry with its explicit capabilities; nothing comes from a built-in catalog. */
export interface ModelSpec {
  id: string
  /** Display name; empty means the model id. */
  name: string
  contextWindow: number
  maxTokens: number
  input: ('text' | 'image')[]
  /** Whether requests use the configured Thinking Levels. Levels stay configured while this is off. */
  reasoning: boolean
  thinkingLevels: ThinkingLevelSpec[]
}

export interface ProviderConfig {
  /** Provider id; also the CredentialStore key. */
  id: string
  name: string
  api: ModelProtocol
  baseUrl: string
  headers?: Record<string, string>
  models: ModelSpec[]
}

export class ModelConfigError extends Error {
  override readonly name = 'ModelConfigError'
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

/**
 * Configured levels map to their API value; unconfigured levels are null (unsupported). `off` is left out so each
 * protocol applies its default way of turning reasoning off.
 */
function thinkingLevelMap(levels: readonly ThinkingLevelSpec[]): ThinkingLevelMap {
  const map: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    if (level === 'off') continue
    const configured = levels.find((l) => l.level === level)
    map[level] = configured && 'value' in configured ? configured.value : null
  }
  return map
}

function checkBaseUrl(config: ProviderConfig): void {
  let protocol: string
  try {
    protocol = new URL(config.baseUrl).protocol
  } catch {
    protocol = ''
  }
  if (protocol !== 'http:' && protocol !== 'https:') throw new ModelConfigError(`Provider "${config.id}" needs an http or https baseUrl`)
}

function checkModel(config: ProviderConfig, spec: ModelSpec): void {
  if (!Number.isInteger(spec.contextWindow) || spec.contextWindow <= 0 || !Number.isInteger(spec.maxTokens) || spec.maxTokens <= 0) {
    throw new ModelConfigError(`Model "${spec.id}" of provider "${config.id}" needs positive integer contextWindow and maxTokens`)
  }
  if (spec.maxTokens > spec.contextWindow) throw new ModelConfigError(`Model "${spec.id}" has maxTokens above its contextWindow`)
  const levels = spec.thinkingLevels.map((l) => l.level)
  if (new Set(levels).size !== levels.length) throw new ModelConfigError(`Model "${spec.id}" has a duplicate thinking level`)
}

function buildModel(config: ProviderConfig, spec: ModelSpec): Model<any> {
  return {
    id: spec.id,
    name: spec.name || spec.id,
    api: config.api,
    provider: config.id,
    baseUrl: config.baseUrl,
    reasoning: spec.reasoning,
    thinkingLevelMap: thinkingLevelMap(spec.thinkingLevels),
    input: [...spec.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow,
    maxTokens: spec.maxTokens,
    ...(config.headers ? { headers: config.headers } : {}),
  }
}

/** Validates the whole configuration first, so an invalid Provider never reaches the collection. */
function buildProvider(config: ProviderConfig) {
  checkBaseUrl(config)
  if (config.models.length === 0) throw new ModelConfigError(`Provider "${config.id}" needs at least one model`)
  const ids = new Set<string>()
  for (const spec of config.models) {
    if (ids.has(spec.id)) throw new ModelConfigError(`Provider "${config.id}" has a duplicate model "${spec.id}"`)
    ids.add(spec.id)
    checkModel(config, spec)
  }
  const name = config.name || config.id
  return createProvider({
    id: config.id,
    name,
    baseUrl: config.baseUrl,
    ...(config.headers ? { headers: config.headers } : {}),
    auth: { apiKey: storedApiKeyAuth(name) },
    models: config.models.map((spec) => buildModel(config, spec)),
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

/**
 * Thinking Levels a Session can choose for this model, in the fixed order: always `off`; with reasoning on, also every
 * configured level (pi-ai's supported levels, where unconfigured levels are null).
 */
export function selectableThinkingLevels(model: Model<any>): ThinkingLevel[] {
  const supported = new Set<ModelThinkingLevel>(getSupportedThinkingLevels(model))
  return THINKING_LEVELS.filter((level) => level === 'off' || supported.has(level))
}

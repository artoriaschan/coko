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
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { withUsageReports } from './usage-report.ts'
import { isHttpUrl, normalizeModelBaseUrl } from './base-url.ts'

/** Wire protocols Coko supports; each Provider stores one of them. */
export const MODEL_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number]

const incrementalCompletionsModels = getBuiltinProviders()
  .flatMap<Model<any>>((provider) => getBuiltinModels(provider))
  .filter((model): model is Model<'openai-completions'> => model.api === 'openai-completions')
  .filter((model) => model.compat?.supportsMidConvoSystemMessages && model.compat.supportsMidConvoToolAdditions)

/** A Run freezes its transport choice after its on-demand catalog is known. */
export function withIncrementalTools(model: Model<any>, enabled: boolean): Model<any> {
  if (!enabled) return model
  if (model.api === 'anthropic-messages')
    return { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } }
  if (model.api === 'openai-responses') return { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } }
  if (
    model.api === 'openai-completions' &&
    incrementalCompletionsModels.some((entry) => entry.id === model.id && normalizeModelBaseUrl(entry.baseUrl) === normalizeModelBaseUrl(model.baseUrl))
  )
    return { ...model, compat: { ...model.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true } }
  return model
}

/** Whether this model snapshot actually selects a supported native tool transport. */
export function usesIncrementalTools(model: Model<any>): boolean {
  const compat = model.compat
  if (!compat || !('supportsMidConvoSystemMessages' in compat) || !compat.supportsMidConvoSystemMessages) return false
  if (model.api === 'anthropic-messages') return 'supportsMidConvoToolChanges' in compat && compat.supportsMidConvoToolChanges === true
  if (model.api === 'openai-responses') return 'supportsAdditionalTools' in compat && compat.supportsAdditionalTools === true
  return model.api === 'openai-completions' && 'supportsMidConvoToolAdditions' in compat && compat.supportsMidConvoToolAdditions === true
}

/** The seven Thinking Levels in their fixed order (pi-ai's `MODEL_THINKING_LEVELS`). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly ModelThinkingLevel[]
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** A configured Thinking Level: `off` has no API value (each protocol sends its own default); the others send `value`. */
export type ThinkingLevelSpec = { level: 'off' } | { level: Exclude<ThinkingLevel, 'off'>; value: string }

/** Price per million tokens (pi-ai's `model.cost` unit). Omitted cache prices are 0. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

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
  /** Omitted: unpriced (usage.cost stays 0 and a Goal cost limit cannot be checked). */
  price?: ModelPrice
}

export interface ProviderConfig {
  /** Provider id; also the CredentialStore key. */
  id: string
  name: string
  api: ModelProtocol
  baseUrl: string
  headers?: Record<string, string>
  incrementalTools?: boolean
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
  if (!isHttpUrl(config.baseUrl)) throw new ModelConfigError(`Provider "${config.id}" needs an http or https baseUrl`)
}

function checkModel(config: ProviderConfig, spec: ModelSpec): void {
  if (!Number.isInteger(spec.contextWindow) || spec.contextWindow <= 0 || !Number.isInteger(spec.maxTokens) || spec.maxTokens <= 0) {
    throw new ModelConfigError(`Model "${spec.id}" of provider "${config.id}" needs positive integer contextWindow and maxTokens`)
  }
  if (spec.maxTokens > spec.contextWindow) throw new ModelConfigError(`Model "${spec.id}" has maxTokens above its contextWindow`)
  const levels = spec.thinkingLevels.map((l) => l.level)
  if (new Set(levels).size !== levels.length) throw new ModelConfigError(`Model "${spec.id}" has a duplicate thinking level`)
  if (spec.price) {
    const { input, output, cacheRead = 0, cacheWrite = 0 } = spec.price
    if (![input, output, cacheRead, cacheWrite].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0))
      throw new ModelConfigError(`Model "${spec.id}" needs a non-negative price per million tokens`)
  }
}

const costOf = (price: ModelPrice | undefined) => ({
  input: price?.input ?? 0,
  output: price?.output ?? 0,
  cacheRead: price?.cacheRead ?? 0,
  cacheWrite: price?.cacheWrite ?? 0,
})

function buildModel(config: ProviderConfig, spec: ModelSpec): Model<any> {
  // Anthropic: pi-ai's budget-based thinking ignores the configured values, so request adaptive thinking whose effort
  // is the configured value of the chosen level.
  const anthropicEffort = config.api === 'anthropic-messages' && spec.reasoning
  return {
    id: spec.id,
    name: spec.name || spec.id,
    api: config.api,
    provider: config.id,
    baseUrl: config.baseUrl,
    reasoning: spec.reasoning,
    thinkingLevelMap: thinkingLevelMap(spec.thinkingLevels),
    input: [...spec.input],
    cost: costOf(spec.price),
    contextWindow: spec.contextWindow,
    maxTokens: spec.maxTokens,
    ...(config.headers ? { headers: config.headers } : {}),
    ...(anthropicEffort ? { compat: { forceAdaptiveThinking: true } } : {}),
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
    api: Object.fromEntries(Object.entries(PROTOCOL_STREAMS).map(([protocol, streams]) => [protocol, withUsageReports(streams())])),
  })
}

export interface ModelRegistry {
  /** pi-ai collection used for requests; Agent's stream function is `models.streamSimple`. */
  readonly models: MutableModels
  /** Add or replace a Provider from its configuration. */
  setProvider(config: ProviderConfig): void
  deleteProvider(id: string): void
  /**
   * Whether usage.cost of this model reflects a price: its catalog entry has a price (even an all-zero one), or — for a Provider
   * registered directly on `models` (the test faux provider) — its `cost` has a non-zero rate.
   */
  priced(model: Pick<Model<any>, 'provider' | 'id' | 'cost'>): boolean
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
  // Catalog entries with a price, per Provider (replaced on every setProvider).
  const pricedIds = new Map<string, Set<string>>()
  const registry: ModelRegistry = {
    models,
    setProvider: (config) => {
      models.setProvider(buildProvider(config))
      pricedIds.set(config.id, new Set(config.models.filter((spec) => spec.price).map((spec) => spec.id)))
    },
    deleteProvider: (id) => {
      models.deleteProvider(id)
      pricedIds.delete(id)
    },
    priced: (model) => {
      const configured = pricedIds.get(model.provider)
      if (configured) return configured.has(model.id)
      const { input, output, cacheRead, cacheWrite } = model.cost
      return input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
    },
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

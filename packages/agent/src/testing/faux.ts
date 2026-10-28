import { createModels, fauxProvider, type Model, type MutableModels, type RegisterFauxProviderOptions } from '@earendil-works/pi-ai'

export { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai'
export type { FauxProviderHandle, FauxResponseStep } from '@earendil-works/pi-ai'

/** pi-ai faux provider in its own Models collection; script replies with `faux.setResponses`. */
export function createFauxModels(options: RegisterFauxProviderOptions = {}): {
  faux: ReturnType<typeof fauxProvider>
  models: MutableModels
  model: Model<any>
} {
  const faux = fauxProvider(options)
  const models = createModels({ identity: { attribution: null } })
  models.setProvider(faux.provider)
  return { faux, models, model: faux.getModel() }
}

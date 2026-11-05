import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { createModelRegistry, resolveModel, withIncrementalTools } from './registry.ts'
import { normalizeModelBaseUrl } from './base-url.ts'

function model(baseUrl = 'https://API.MOONSHOT.AI/v1///', id = 'kimi-k3') {
  const registry = createModelRegistry({
    credentials: new InMemoryCredentialStore(),
    providers: [
      {
        id: 'custom',
        name: 'Custom',
        api: 'openai-completions',
        baseUrl,
        models: [{ id, name: '', contextWindow: 128000, maxTokens: 16000, input: ['text'], reasoning: false, thinkingLevels: [] }],
      },
    ],
  })
  return resolveModel(registry, 'custom', id)
}

describe('Completions incremental tools use the installed pi catalog', () => {
  it('matches catalog URL and ID despite host case and trailing slashes, without mutating the registered model', () => {
    const original = model()
    expect(withIncrementalTools(original, true).compat).toMatchObject({ supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true })
    expect(original.compat).toBeUndefined()
    expect(withIncrementalTools(original, false)).toBe(original)
  })

  it.each([
    ['https://gateway.example/v1', 'kimi-k3'],
    ['https://api.moonshot.ai/v2', 'kimi-k3'],
    ['https://api.moonshot.ai/V1', 'kimi-k3'],
    ['http://api.moonshot.ai/v1', 'kimi-k3'],
    ['https://api.moonshot.ai/v1', 'kimi-k2.5'],
  ])('leaves an unmarked URL/ID pair unchanged: %s %s', (baseUrl, id) => {
    const original = model(baseUrl, id)
    expect(withIncrementalTools(original, true)).toBe(original)
  })

  it.each([
    ['https://api.fireworks.ai/inference/v1', 'accounts/fireworks/models/kimi-k3'],
    ['https://api.fireworks.ai/inference/v1', 'accounts/fireworks/routers/kimi-k3-fast'],
    ['https://api.kimi.com/coding/v1', 'k3'],
    ['https://api.kimi.com/coding/v1', 'k3-256k'],
    ['https://api.kimi.com/coding/v1', 'kimi-for-coding'],
    ['https://api.moonshot.ai/v1', 'kimi-k3'],
    ['https://api.moonshot.cn/v1', 'kimi-k3'],
    ['https://opencode.ai/inference/v1', 'kimi-k3'],
    ['https://opencode.ai/inference/go/v1', 'kimi-k3'],
  ])('recognizes the pinned pi 1.4 catalog entry: %s %s', (baseUrl, id) => {
    const original = { ...model(baseUrl, id), compat: { supportsStrictMode: false } }
    expect(withIncrementalTools(original, true).compat).toEqual({
      supportsStrictMode: false,
      supportsMidConvoSystemMessages: true,
      supportsMidConvoToolAdditions: true,
    })
  })
})

it.each([
  ['https://API.EXAMPLE/v1///', 'https://api.example/v1'],
  ['https://API.EXAMPLE/UPPER/v1/', 'https://api.example/UPPER/v1'],
  ['https://API.EXAMPLE/', 'https://api.example'],
  ['https://API.EXAMPLE/v1/?q=path/', 'https://api.example/v1?q=path/'],
])('normalizes base URL %s', (input, expected) => {
  expect(normalizeModelBaseUrl(input)).toBe(expected)
})

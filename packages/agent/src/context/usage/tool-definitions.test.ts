import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model, Tool } from '@earendil-works/pi-ai'
import { createFauxModels } from '../../testing/faux.ts'
import { toolDefinitionChars } from './tool-definitions.ts'

const original = { name: 'sample', description: 'old', parameters: { type: 'object' } } satisfies Tool
const current = { ...original, description: 'new' }
// Canonical Coko tool JSON, independently maintained from the estimator.
const oldChars = '{"name":"sample","description":"old","parameters":{"type":"object"}}'.length
const newChars = '{"name":"sample","description":"new","parameters":{"type":"object"}}'.length
const history: AgentMessage[] = [
  { role: 'system', content: '', timestamp: 0, toolsAdded: [original] },
  { role: 'system', content: '', timestamp: 1, toolsRemoved: [{ name: 'sample' }], toolsAdded: [current] },
]
const model = (api: 'anthropic-messages' | 'openai-responses' | 'openai-completions', enabled: boolean): Model<any> => ({
  ...createFauxModels().model,
  api,
  compat: enabled
    ? { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true, supportsAdditionalTools: true, supportsMidConvoToolAdditions: true }
    : {},
})

describe('tool definition transport accounting', () => {
  it.each(['anthropic-messages', 'openai-responses'] as const)('retains earlier native definitions on removal and replacement (%s)', (api) => {
    expect(toolDefinitionChars(model(api, true), [current], history)).toBe(oldChars + newChars)
    expect(toolDefinitionChars(model(api, true), [], history)).toBe(oldChars + newChars)
  })
  it('Completions folds replacements and removals before later additions', () => {
    expect(toolDefinitionChars(model('openai-completions', true), [current], history)).toBe(newChars)
    expect(toolDefinitionChars(model('openai-completions', true), [], history)).toBe(0)
  })
  it('full-list transport counts only the current definition once', () => {
    expect(toolDefinitionChars(model('anthropic-messages', false), [current], history)).toBe(newChars)
  })
  it('previews pending declarations and reconstructs a missing unpersisted baseline', () => {
    expect(toolDefinitionChars(model('openai-responses', true), [current], history.slice(0, 1))).toBe(oldChars + newChars)
    expect(toolDefinitionChars(model('openai-responses', true), [current], [])).toBe(newChars)
  })
})

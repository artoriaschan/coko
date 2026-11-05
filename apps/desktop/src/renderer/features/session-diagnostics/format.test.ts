// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
/** Type-specific row previews preserve the original payload data. */

import { expect, it } from 'vitest'
import { diagnosticPreview } from './format.ts'

it('bounds a primitive preview as well as object summaries to 240 characters', () => {
  expect(diagnosticPreview(10n ** 300n)).toHaveLength(240)
})

it('shows only tool-call argument deltas without mutating the raw chunk', () => {
  const chunk = Object.freeze({ type: 'assistant_delta', kind: 'toolcall', contentIndex: 3, delta: '{"command":' })
  expect(diagnosticPreview(chunk)).toBe('{"command":')
  expect(chunk).toEqual({ type: 'assistant_delta', kind: 'toolcall', contentIndex: 3, delta: '{"command":' })
})

it('hides the reasoning index without changing other delta types', () => {
  expect(diagnosticPreview({ type: 'assistant_delta', kind: 'thinking', contentIndex: 7, delta: 'thinking' })).toBe('thinking')
  expect(diagnosticPreview({ type: 'tool_update', toolCallId: 'x', partialResult: 'answer' })).toBe('toolCallId: x · partialResult: answer')
})

it('applies delta field selection to nested data while hiding generic type and sequence fields', () => {
  expect(diagnosticPreview({ type: 'event', seq: 1, sequence: 2, data: { type: 'assistant_delta', kind: 'toolcall', contentIndex: 0, delta: '}' } })).toBe('}')
})

it.each([
  [{ role: 'assistant' }, 'assistant'],
  [{ count: 0 }, '0'],
  [{ enabled: false }, 'false'],
  [{ value: null }, 'null'],
  [{ text: '' }, ''],
])('omits the field name from a single-field object %j', (value, expected) => {
  expect(diagnosticPreview(value)).toBe(expected)
})

it('keeps field names when more than one field remains', () => {
  expect(diagnosticPreview({ type: 'message', role: 'assistant', content: 'answer' })).toBe('role: assistant · content: answer')
})

it('hides top-level time without removing nested time values', () => {
  expect(diagnosticPreview({ time: 123, text: 'message' })).toBe('message')
  expect(diagnosticPreview({ Time: 123, role: 'assistant' })).toBe('assistant')
  expect(diagnosticPreview({ time: 123, data: { time: 456, text: 'nested' } })).toBe('time: 456 · text: nested')
})

it('omits Chat identity columns from previews without hiding nested business keys', () => {
  const node = { key: 'assistant:1', kind: 'assistant', data: { key: 'payload-key', kind: 'payload-kind' } }
  expect(diagnosticPreview(node, ['key', 'kind'])).toBe('key: payload-key · kind: payload-kind')
  expect(diagnosticPreview({ key: 'log-key', kind: 'log-kind' })).toBe('key: log-key · kind: log-kind')
  expect(node.key).toBe('assistant:1')
  expect(node.kind).toBe('assistant')
})

it('bounds nested arrays by their length instead of enumerating their elements', () => {
  expect(diagnosticPreview({ data: { values: [1, 2, 3] } })).toBe('[3]')
})

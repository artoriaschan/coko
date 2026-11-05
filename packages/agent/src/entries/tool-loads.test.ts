import { expect, it } from 'vitest'
import { loadedToolNames } from './tool-loads.ts'

it('derives loads across compaction but excludes conversation rewinds', () => {
  const entries = [
    { seq: 1, kind: 'tool_load', payload: { names: ['A'], source: 'search', toolCallId: 'a' } },
    { seq: 2, kind: 'compaction', payload: { firstKeptSeq: 3, summary: 'summary' } },
    { seq: 3, kind: 'tool_load', payload: { names: ['B'], source: 'search', toolCallId: 'b' } },
  ]
  expect([...loadedToolNames(entries)]).toEqual(['A', 'B'])
  expect([...loadedToolNames([...entries, { seq: 4, kind: 'rewind', payload: { targetSeq: 3, scope: 'conversation' } }])]).toEqual(['A'])
})

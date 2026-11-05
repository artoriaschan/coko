import { expect, it } from 'vitest'
import type { SessionEntryRecord } from '@coko/protocol'
import { buildProgressRecords, createProgressState, receiveDiagnosticProgress, settleDiagnosticProgress } from './progress-model.ts'

const entry = (seq: number, kind: string, payload: unknown, runId = 'r'): SessionEntryRecord => ({
  sessionId: 's',
  seq,
  kind,
  payload,
  runId,
  payloadVersion: 1,
  createdAt: seq,
})
const start = entry(1, 'run_start', {})
it('groups interleaved content blocks and tools in arrival order, keeps offset discontinuities out of previews, and transfers committed blocks collapsed', () => {
  let state = createProgressState([start])
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'thinking', contentIndex: 0, delta: 'Think ', offset: 0 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'toolcall', contentIndex: 2, delta: '{"a":', offset: 0 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'thinking', contentIndex: 0, delta: 'well', offset: 6 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'thinking', contentIndex: 0, delta: 'well', offset: 6 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'toolcall', contentIndex: 2, delta: '1}', offset: 5 })
  let model = buildProgressRecords([start], state, 'Live progress')
  expect(model.rows.map((row) => model.records.get(row.key)?.type)).toEqual([
    'run_start',
    'Live progress',
    'assistant_delta/thinking',
    'assistant_delta',
    'assistant_delta',
    'assistant_delta',
    'assistant_delta/toolcall',
    'assistant_delta',
    'assistant_delta',
  ])
  expect([...model.records.values()].filter((record) => record.collapsedSummary).map((record) => record.collapsedSummary)).toEqual(['Think well', '{"a":1}'])
  const assistant = entry(2, 'message', { role: 'assistant' })
  state = settleDiagnosticProgress(state, [start, assistant])
  model = buildProgressRecords([start, assistant], state, 'Live progress')
  expect(model.rows.find((row) => row.key === 'entry:2')?.disclosure).toBe('closed')
  expect(model.rows.filter((row) => model.records.get(row.key)?.type === 'assistant_delta/thinking')[0]?.parent).toBe('entry:2')
  expect(model.rows.filter((row) => row.key.startsWith('progress:')).every((row) => model.records.get(row.key)?.time === undefined)).toBe(true)
})

it('late tool, Run and compaction endings settle against committed entries while unmatched progress remains live', () => {
  let state = createProgressState([start])
  state = receiveDiagnosticProgress(state, 'r', { type: 'tool_start', toolCallId: 't1', toolName: 'bash', args: {} })
  state = receiveDiagnosticProgress(state, 'r', { type: 'tool_update', toolCallId: 't1', toolName: 'bash', partialResult: 'first' })
  state = receiveDiagnosticProgress(state, 'r', { type: 'retry', attempt: 1, maxRetries: 2, delayMs: 1, errorMessage: 'retry' })
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_start', trigger: 'manual' })
  const entries = [start, entry(2, 'message', { role: 'toolResult', toolCallId: 't1' }), entry(3, 'compaction', {}), entry(4, 'run_end', {})]
  state = settleDiagnosticProgress(state, entries)
  state = receiveDiagnosticProgress(state, 'r', { type: 'tool_end', toolCallId: 't1', toolName: 'bash', isError: false, result: 'done' })
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_end', trigger: 'manual', tokensBefore: 10, tokensAfter: 5 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'run_end', status: 'completed' })
  const model = buildProgressRecords(entries, state, 'Live progress')
  const frameParent = (type: string) => model.rows.find((row) => model.records.get(row.key)?.type === type)?.parent
  expect(frameParent('tool')).toBe('entry:2')
  expect(frameParent('compaction_start')).toBe('entry:3')
  expect(frameParent('compaction_end')).toBe('entry:3')
  expect(frameParent('run_end')).toBe('entry:1') // the committed Entry itself remains under Run
  const endFrame = model.rows.filter((row) => model.records.get(row.key)?.type === 'run_end').at(-1)!
  expect(endFrame.parent).toBe('entry:4')
  expect(frameParent('retry')).toBe('progress:live:r')
  expect(model.rows.find((row) => row.key === 'entry:2')?.disclosure).toBe('closed')
})
it('does not replay historical Runs or detached progress, and never joins gaps or conflicting offsets', () => {
  let state = createProgressState([start, entry(2, 'run_end', {})])
  state = receiveDiagnosticProgress(state, 'r', { type: 'run_end', status: 'completed' })
  state = receiveDiagnosticProgress(state, 'other', { type: 'lsp_update', servers: [] })
  expect(state.groups).toHaveLength(0)
  state = receiveDiagnosticProgress(state, 'next', { type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: 'missing prefix', offset: 10 })
  expect([...buildProgressRecords([start], state, 'Live progress').records.values()].some((record) => record.collapsedSummary !== undefined)).toBe(false)
})
it('reuses contentIndex only until the next assistant commit and keeps Run identities separate', () => {
  let state = receiveDiagnosticProgress(createProgressState([start]), 'r', {
    type: 'assistant_delta',
    contentIndex: 0,
    kind: 'text',
    delta: 'first',
    offset: 0,
  })
  const entries = [start, entry(2, 'message', { role: 'assistant' })]
  state = settleDiagnosticProgress(state, entries)
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', contentIndex: 0, kind: 'text', delta: 'second', offset: 0 })
  state = receiveDiagnosticProgress(state, 'another', { type: 'assistant_delta', contentIndex: 0, kind: 'text', delta: 'third', offset: 0 })
  const model = buildProgressRecords(entries, state, 'Live progress')
  expect(model.rows.filter((row) => model.records.get(row.key)?.type === 'assistant_delta/text').map((row) => row.parent)).toEqual([
    'entry:2',
    'progress:live:r',
    'progress:live:another',
  ])
})

it('settling run_start never collapses the Run that owns currently generating progress', () => {
  let state = receiveDiagnosticProgress(createProgressState([]), 'r', { type: 'run_start' })
  state = settleDiagnosticProgress(state, [start])
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', kind: 'thinking', contentIndex: 0, delta: 'live', offset: 0 })
  const model = buildProgressRecords([start], state, 'Live progress')
  expect(model.rows.find((row) => row.key === 'entry:1')?.disclosure).toBe('open')
  expect(model.rows.find((row) => model.records.get(row.key)?.type === 'progress/run_start')?.disclosure).toBe('closed')
})

it('pairs repeated compactions with their own committed Entries and handles overlapping UTF-16 offsets without duplicating text', () => {
  let state = createProgressState([start])
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_start', trigger: 'auto' })
  const first = [start, entry(2, 'compaction', {})]
  state = settleDiagnosticProgress(state, first)
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_end', trigger: 'auto', tokensBefore: 10 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_start', trigger: 'manual' })
  const both = [...first, entry(3, 'compaction', {})]
  state = settleDiagnosticProgress(state, both)
  state = receiveDiagnosticProgress(state, 'r', { type: 'compaction_end', trigger: 'manual', tokensBefore: 20 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: '🦜 hello', offset: 0 })
  state = receiveDiagnosticProgress(state, 'r', { type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: 'lo world', offset: 6 })
  const model = buildProgressRecords(both, state, 'Live progress')
  expect(model.rows.filter((row) => model.records.get(row.key)?.type === 'compaction_end').map((row) => row.parent)).toEqual(['entry:2', 'entry:3'])
  expect([...model.records.values()].find((record) => record.type === 'assistant_delta/thinking')?.collapsedSummary).toBe('🦜 hello world')
})

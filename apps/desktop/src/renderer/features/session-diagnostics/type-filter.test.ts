// Worked examples adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import { expect, it } from 'vitest'
import { DiagnosticTypeFilter } from './type-filter.ts'
import { DiagnosticTableHierarchy, type DiagnosticRow } from './table-model.ts'

const rows: readonly DiagnosticRow[] = [
  { key: 'run', depth: 0, disclosure: 'closed' },
  { key: 'block', parent: 'run', depth: 1, disclosure: 'closed' },
  { key: 'delta', parent: 'block', depth: 2 },
  { key: 'other', parent: 'run', depth: 1 },
  { key: 'root', depth: 0 },
]
const types = new Map([
  ['run', 'run_start'],
  ['block', 'thinking'],
  ['delta', 'assistant_delta'],
  ['other', 'message/user'],
  ['root', 'tool_end'],
])

it('contains matching ignores case and only optional edge stars, retaining open ancestor context without counting it', () => {
  const filter = new DiagnosticTypeFilter(' **DeLtA** ')
  const result = filter.apply(rows, (key) => types.get(key))
  expect(filter.query).toBe('DeLtA')
  expect([...result.matches]).toEqual(['delta'])
  expect(result.rows).toEqual([
    { key: 'run', depth: 0, disclosure: 'open' },
    { key: 'block', parent: 'run', depth: 1, disclosure: 'open' },
    { key: 'delta', parent: 'block', depth: 2 },
  ])
  expect(new DiagnosticTableHierarchy(result.rows, new Map()).rows.map((row) => row.key)).toEqual(['run', 'block', 'delta'])
  expect(new DiagnosticTypeFilter('assistant*delta').matches('assistant_delta')).toBe(false)
  expect(new DiagnosticTypeFilter(' *** ').apply(rows, (key) => types.get(key)).rows).toBe(rows)
})

it.each(['', '   ', '***', ' * * '])('keeps the complete hierarchy and count when %j clears the restriction', (query) => {
  const filter = new DiagnosticTypeFilter(query)
  expect(filter.active).toBe(false)
  expect(filter.apply(rows, (key) => types.get(key))).toEqual({ rows, matches: new Set(['run', 'block', 'delta', 'other', 'root']) })
})

it('removes disclosure from matching leaves and excludes unrelated siblings, including absent types', () => {
  const result = new DiagnosticTypeFilter('thinking').apply(rows, (key) => types.get(key))
  expect(result.rows).toEqual([
    { key: 'run', depth: 0, disclosure: 'open' },
    { key: 'block', parent: 'run', depth: 1 },
  ])
  expect(new DiagnosticTypeFilter('absent').apply(rows, (key) => types.get(key))).toEqual({ rows: [], matches: new Set() })
  expect(new DiagnosticTypeFilter('delta').matches(undefined)).toBe(false)
  expect(rows[1]?.disclosure).toBe('closed')
})

it('suggests asynchronously from current complete loaded types regardless of closed ancestors, deduplicating and sorting', async () => {
  const current = new Map(types)
  const pending = new DiagnosticTypeFilter('delta').suggest(rows, (key) => current.get(key))
  current.set('other', 'tool_delta')
  expect(await pending).toEqual(['assistant_delta', 'tool_delta'])
  expect(
    await new DiagnosticTypeFilter('').suggest([...rows, { key: 'duplicate', depth: 0 }], (key) => (key === 'duplicate' ? 'run_start' : current.get(key))),
  ).toEqual(['assistant_delta', 'run_start', 'thinking', 'tool_delta', 'tool_end'])
})

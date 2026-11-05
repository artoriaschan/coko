// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
/** Automatic closure preserves the visible parent and reserves blank space only after all rows. */

import { expect, it } from 'vitest'
import { DiagnosticTableHierarchy, type DiagnosticRow } from './table-model.ts'
import { DiagnosticTableLayout } from './table-layout.ts'

const open: readonly DiagnosticRow[] = [
  { key: 'assistant', depth: 0 },
  { key: 'block', parent: 'assistant', depth: 1, disclosure: 'open' },
  { key: 'delta-1', parent: 'block', depth: 2 },
  { key: 'delta-2', parent: 'block', depth: 2 },
]
const closed = open.map((row) => (row.key === 'block' ? { ...row, disclosure: 'closed' as const } : row))
const hierarchy = (rows: readonly DiagnosticRow[]) => new DiagnosticTableHierarchy(rows, new Map())
it('keeps rows contiguous, anchors their parent, and fills trailing blank space with new rows', () => {
  const before = new DiagnosticTableLayout(hierarchy(open))
  const after = new DiagnosticTableLayout(hierarchy(closed), before, { offset: 90, height: 300 })
  expect(after.preservedCollapse).toBe(true)
  expect(after.scrollOffset).toBe(0)
  expect(after.items.map((item) => item.key)).toEqual(['assistant', 'block'])
  expect(after.bottomPadding).toBe(210)
  expect(after.stickyIndexes(1)).toEqual([0, 1])
  const appended = new DiagnosticTableLayout(hierarchy([...closed, { key: 'next', depth: 0 }]), after)
  expect(appended.bottomPadding).toBe(180)
  expect(appended.items.at(-1)).toMatchObject({ key: 'next' })
  expect(appended.preservedCollapse).toBe(false)
})

it('keeps existing closed history compact and resets spacing for manual disclosure changes', () => {
  const compact = new DiagnosticTableLayout(hierarchy(closed))
  expect(compact.items).toHaveLength(2)
  expect(compact.preservedCollapse).toBe(false)
  expect(compact.bottomPadding).toBe(0)
  const manual = new DiagnosticTableHierarchy(open, new Map([['block', { state: 'open' as const, collapsed: true }]]))
  expect(new DiagnosticTableLayout(manual).items).toHaveLength(2)
})

it('uses the current Turn below the table header instead of the preceding Turn hidden behind it', () => {
  const rows: DiagnosticRow[] = [
    { key: 'previous', depth: 0 },
    { key: 'previous-tail', parent: 'previous', depth: 1 },
    { key: 'current', depth: 0, disclosure: 'closed' },
    { key: 'current-body', parent: 'current', depth: 1 },
  ]
  const layout = new DiagnosticTableLayout(hierarchy(rows))
  expect(layout.stickyIndexesAtOffset(60)).toEqual([2])
  expect(layout.stickyIndexesAtOffset(59)).toEqual([0])
  expect(new DiagnosticTableLayout(hierarchy([])).stickyIndexesAtOffset(0)).toEqual([])
})

it('replaces each nested sticky header when the next Step reaches that level', () => {
  const rows: DiagnosticRow[] = [
    { key: 'turn', depth: 0 },
    { key: 'previous-step', parent: 'turn', depth: 1 },
    { key: 'previous-body', parent: 'previous-step', depth: 2 },
    { key: 'current-step', parent: 'turn', depth: 1, disclosure: 'closed' },
    { key: 'current-body', parent: 'current-step', depth: 2 },
    { key: 'next-turn', depth: 0, disclosure: 'closed' },
  ]
  const layout = new DiagnosticTableLayout(hierarchy(rows))
  expect(layout.stickyIndexesAtOffset(60)).toEqual([0, 3])
  expect(layout.stickyIndexesAtOffset(59)).toEqual([0, 1])
  expect(layout.stickyIndexesAtOffset(120)).toEqual([4])
})

it.each([30, 120])('retains a manually folded header at viewport top %i without inserting space above it', (top) => {
  const rows: DiagnosticRow[] = [
    ...Array.from({ length: 20 }, (_, i) => ({ key: `before-${i}`, depth: 0 })),
    { key: 'turn', depth: 0, disclosure: 'open' },
    ...Array.from({ length: 100 }, (_, i) => ({ key: `child-${i}`, parent: 'turn', depth: 1 })),
  ]
  const folded = new DiagnosticTableHierarchy(rows, new Map([['turn', { state: 'open', collapsed: true }]]))
  const layout = new DiagnosticTableLayout(folded, undefined, { offset: 2000, height: 300 }, { key: 'turn', top })
  expect(layout.scrollOffset).toBe(630 - top)
  expect(layout.bottomPadding).toBe(270 - top)
  expect(layout.items.map((item) => item.size)).toEqual(Array(21).fill(30))
  const appended = new DiagnosticTableLayout(hierarchy([...folded.rows, { key: 'next', depth: 0 }]), layout)
  expect(appended.bottomPadding).toBe(240 - top)
  expect(appended.scrollOffset).toBeUndefined()
})

it('keeps a manual anchor reachable without trailing space when enough later data remains', () => {
  const rows: DiagnosticRow[] = Array.from({ length: 100 }, (_, i) => ({ key: String(i), depth: 0 }))
  const layout = new DiagnosticTableLayout(hierarchy(rows), undefined, { offset: 400, height: 300 }, { key: '20', top: 180 })
  expect(layout.scrollOffset).toBe(450)
  expect(layout.bottomPadding).toBe(0)
  const removed = new DiagnosticTableLayout(hierarchy(rows), undefined, { offset: 400, height: 300 }, { key: 'removed', top: 30 })
  expect(removed.scrollOffset).toBeUndefined()
})

it('anchors a surviving later row when a preceding block closes', () => {
  const tail = [
    { key: 'tail-1', depth: 0 },
    { key: 'tail-2', depth: 0 },
  ]
  const before = new DiagnosticTableLayout(hierarchy([...open, ...tail]))
  const after = new DiagnosticTableLayout(hierarchy([...closed, ...tail]), before, { offset: 90, height: 300 })
  expect(after.scrollOffset).toBe(30)
  expect(after.items.at(-1)?.key).toBe('tail-2')
})

it('resets a removed viewport anchor when another retained block closes', () => {
  const before = new DiagnosticTableLayout(
    hierarchy([
      { key: 'removed-turn', depth: 0 },
      { key: 'removed-child', parent: 'removed-turn', depth: 1 },
      { key: 'block', depth: 0, disclosure: 'open' },
      { key: 'delta', parent: 'block', depth: 1 },
    ]),
  )
  const after = new DiagnosticTableLayout(
    hierarchy([
      { key: 'new-closed', depth: 0, disclosure: 'closed' },
      { key: 'block', depth: 0, disclosure: 'closed' },
    ]),
    before,
    { offset: 0, height: 300 },
  )
  expect(after.preservedCollapse).toBe(true)
  expect(after.scrollOffset).toBe(0)
})

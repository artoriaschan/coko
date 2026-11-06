// Turn/call folding adapted from DeepSeek Harness TrajectoryTable (MIT), Copyright (c) 2026 DeepSeek.
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'

export interface LedgerRow {
  key: string
  cell: TrajectoryCellProps
  turnStart: boolean
  turnEnd: boolean
  summary?: { kind: 'turn' | 'assistant' | 'tool'; text: string }
}

const callsSummary = (calls: readonly TrajectoryCellProps[], t: TrajectoryTranslate) => {
  const names = [...new Set(calls.map((call) => call.text).filter(Boolean))]
  const count = t(calls.length === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', { count: calls.length })
  return names.length === 0 ? count : `${count} · ${names.join(', ')}`
}

/** Keep the turn opener and SYSTEM updates; replace folded descendants with an actionable 20px summary. */
export function projectLedger(
  cells: readonly TrajectoryCellProps[],
  collapsedTurns: ReadonlySet<number>,
  collapsedAssistants: ReadonlySet<string>,
  collapsedTools: ReadonlySet<string>,
  matches: ReadonlySet<number> | null,
  t: TrajectoryTranslate,
): LedgerRow[] {
  const seen = new Set<number | null>()
  const base = cells
    .filter((cell) => matches === null || (cell.requestOnly !== true && matches.has(cell.index)))
    .map((cell) => {
      const turnStart = !seen.has(cell.turn) && cell.kind !== 'system' && cell.requestOnly !== true
      if (turnStart) seen.add(cell.turn)
      return { key: cell.id, cell, turnStart, turnEnd: false }
    })
  const rows: LedgerRow[] = []
  const hidden = new Set<string>()
  for (const row of base) {
    const { cell } = row
    if (hidden.has(cell.id)) continue
    rows.push(row)
    if (matches !== null) continue
    if (cell.turn !== null && collapsedTurns.has(cell.turn) && row.turnStart) {
      const rest = cells.filter((item) => item.turn === cell.turn && item.id !== cell.id && item.kind !== 'system' && item.requestOnly !== true)
      if (rest.length === 0) continue
      rest.forEach((item) => hidden.add(item.id))
      const steps = new Set(rest.flatMap((item) => (item.requestNumber === undefined ? [] : [item.requestNumber]))).size
      const calls = rest.filter((item) => item.kind === 'tool' || item.kind === 'subtool').length
      rows.push({
        ...row,
        key: `turn:${cell.turn}`,
        turnStart: false,
        summary: {
          kind: 'turn',
          text: [
            t(steps === 1 ? 'summary.steps.one' : 'summary.steps.other', { count: steps }),
            t(calls === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', { count: calls }),
          ].join(' · '),
        },
      })
    } else if ((cell.kind === 'message' && collapsedAssistants.has(cell.id)) || (cell.kind === 'tool' && collapsedTools.has(cell.id))) {
      const calls = cells.filter((item) => item.parentId === cell.id)
      if (calls.length === 0) continue
      calls.forEach((item) => hidden.add(item.id))
      rows.push({
        ...row,
        key: `calls:${cell.id}`,
        turnStart: false,
        summary: { kind: cell.kind === 'message' ? 'assistant' : 'tool', text: callsSummary(calls, t) },
      })
    }
  }
  rows.forEach((row, index) => {
    row.turnEnd = rows[index + 1]?.cell.turn !== row.cell.turn
  })
  return rows
}

export const ledgerRowHeight = (row: LedgerRow, terminal = false) => (row.summary ? 20 : row.cell.requestOnly ? (terminal ? 9 : 0) : 30)

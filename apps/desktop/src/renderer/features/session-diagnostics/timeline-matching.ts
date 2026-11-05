import type { DiagnosticTarget } from './grouping-model.ts'

/** Identity-only matching; candidates are in actual mounted timeline order. */
export function locateCandidate<T extends DiagnosticTarget>(target: DiagnosticTarget, candidates: readonly T[]): T | undefined {
  const exact =
    candidates.find((candidate) => target.identity !== undefined && candidate.identity === target.identity) ??
    candidates.find((candidate) => target.toolCallId !== undefined && candidate.toolCallId === target.toolCallId) ??
    candidates.find((candidate) => target.groupId !== undefined && target.identity === undefined && candidate.groupId === target.groupId) ??
    candidates.find((candidate) => target.seq !== undefined && candidate.seq === target.seq)
  if (exact) return exact
  const nearby = (rows: readonly T[]) =>
    target.seq === undefined ? rows[0] : [...rows].sort((a, b) => Math.abs((a.seq ?? Infinity) - target.seq!) - Math.abs((b.seq ?? Infinity) - target.seq!))[0]
  return nearby(candidates.filter((candidate) => target.runId !== undefined && candidate.runId === target.runId)) ?? nearby(candidates)
}

/** Picking never uses the locator's nearby fallback: an unmatched identity stays unmatched. */
export function pickRecord(target: DiagnosticTarget, records: ReadonlyMap<string, DiagnosticTarget>): string | undefined {
  const entries = [...records]
  return (
    entries.find(([, row]) => target.identity !== undefined && row.identity === target.identity)?.[0] ??
    entries.find(([, row]) => target.toolCallId !== undefined && row.toolCallId === target.toolCallId)?.[0] ??
    entries.find(([, row]) => target.groupId !== undefined && row.identity === undefined && row.groupId === target.groupId)?.[0] ??
    entries.find(([, row]) => target.seq !== undefined && (row.seq === target.seq || row.sourceSeqs?.includes(target.seq)))?.[0] ??
    (target.identity === undefined && target.groupId === undefined && target.toolCallId === undefined && target.seq === undefined
      ? entries.find(([, row]) => target.runId !== undefined && row.runId === target.runId)?.[0]
      : undefined)
  )
}

import type { SessionEntryRecord } from '@coko/protocol'
import type { DiagnosticTarget } from './grouping-model.ts'
import type { TimelineProjection } from '../conversation/timeline-projection.ts'
import type { DiagnosticProgressState } from './progress-model.ts'
import type { DiagnosticModel } from './table-model.ts'

/** Entry payload identity and actual progress coordinates, never summaries or text. */
export function rawTargets(
  entries: readonly SessionEntryRecord[],
  model: DiagnosticModel,
  projection?: TimelineProjection,
  progress?: DiagnosticProgressState,
): ReadonlyMap<string, DiagnosticTarget> {
  const targets = new Map<string, DiagnosticTarget>()
  for (const entry of entries) {
    const payload = entry.payload
    const toolCallId =
      entry.kind === 'message' && payload !== null && typeof payload === 'object' && 'toolCallId' in payload && typeof payload.toolCallId === 'string'
        ? payload.toolCallId
        : undefined
    targets.set(`entry:${entry.seq}`, { seq: entry.seq, ...(entry.runId ? { runId: entry.runId } : {}), ...(toolCallId ? { toolCallId } : {}) })
  }
  for (const group of progress?.groups ?? []) {
    const item =
      group.contentIndex === undefined
        ? undefined
        : projection?.items.find(
            (item) =>
              (item.kind === 'text' || item.kind === 'thinking') &&
              item.source?.runId === group.runId &&
              item.source.contentIndex === group.contentIndex &&
              (group.target === undefined ? item.streaming : item.origin?.seq === group.target),
          )
    const target: DiagnosticTarget = {
      runId: group.runId,
      ...(group.target === undefined ? {} : { seq: group.target }),
      ...(group.toolCallId === undefined ? {} : { toolCallId: group.toolCallId }),
      ...(item ? { identity: projection?.identities.get(item.key) ?? item.key } : {}),
    }
    if (model.records.has(group.key)) targets.set(group.key, target)
    group.events.forEach((_, index) => targets.set(`${group.key}:${index}`, target))
    targets.set(`progress:live:${group.runId}`, { runId: group.runId })
  }
  return targets
}

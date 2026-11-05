import type { SessionEntry } from '@coko/protocol'
import type { DisplayRun, ProcessSeat } from './process-groups.ts'
import type { TimelineItem } from './timeline.ts'

/** Opaque attributes added to existing semantic roots without inserting transcript nodes. */
export type TimelineRootAttributes = Readonly<Record<`data-${string}`, string | number | undefined>>

/** The exact values committed by the opted-in main timeline; diagnostics never recomputes them. */
export interface TimelineProjection {
  readonly sessionId: string
  readonly items: readonly TimelineItem[]
  readonly identities: ReadonlyMap<string, string>
  readonly seats: readonly ProcessSeat[]
  readonly runs: ReadonlyMap<string, DisplayRun>
  readonly entries: readonly SessionEntry[]
  /** Null-rendered boundaries remain in seats but have no independent diagnostic row. */
  readonly renderedKeys: ReadonlySet<string>
}
const projections = new Map<string, { owner: object; value: TimelineProjection }>()
const listeners = new Set<() => void>()
/** Subscribe to committed main-timeline changes. */
export function subscribeTimelineProjection(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** Read the last mounted main projection for this Session. */
export function timelineProjection(sessionId: string | null) {
  return sessionId === null ? undefined : projections.get(sessionId)?.value
}
/** Called only after commit by the main TimelineView's explicit owner. */
export function publishTimelineProjection(owner: object, value: TimelineProjection) {
  projections.set(value.sessionId, { owner, value })
  for (const listener of listeners) listener()
}
/** Release only this mount; a stale cleanup cannot erase a newer owner. */
export function releaseTimelineProjection(owner: object, sessionId: string) {
  if (projections.get(sessionId)?.owner !== owner) return
  projections.delete(sessionId)
  for (const listener of listeners) listener()
}

/** Provenance shared by diagnostic table navigation and the timeline locator. */
export interface TimelineTarget {
  readonly identity?: string
  readonly groupId?: string
  readonly runId?: string
  readonly seq?: number
  readonly sourceSeqs?: readonly number[]
  readonly toolCallId?: string
  readonly kind?: TimelineItem['kind']
}

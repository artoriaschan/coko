import type { TimelineProjection } from '../conversation/timeline-projection.ts'
import type { TimelineItem } from '../conversation/timeline.ts'
import type { DiagnosticModel, DiagnosticRecord, DiagnosticRow } from './table-model.ts'
import { InspectorObjectValue } from './object-value.ts'

import type { TimelineTarget as DiagnosticTarget } from '../conversation/timeline-projection.ts'
export type { TimelineTarget as DiagnosticTarget } from '../conversation/timeline-projection.ts'

export interface ObjectReference {
  readonly key: string
  readonly kind: 'run' | 'group' | 'row' | 'entry'
  readonly identity: string
  readonly value: object
  readonly rowKey?: string
  readonly target?: DiagnosticTarget
}
/** Original values indexed by identity, never serialized or cloned. */
export interface GroupingModel extends DiagnosticModel {
  readonly references: ReadonlyMap<string, ObjectReference>
  readonly objects: WeakMap<object, ObjectReference>
  readonly related: ReadonlyMap<string, readonly string[]>
  readonly targets: ReadonlyMap<string, DiagnosticTarget>
  readonly revision: object
}
const empty: GroupingModel = {
  rows: [],
  records: new Map(),
  references: new Map(),
  objects: new WeakMap(),
  related: new Map(),
  targets: new Map(),
  revision: {},
}
/** Read the actual mounted seats; suppressed renderer boundaries have no table position. */
export function buildGroupingModel(projection: TimelineProjection | undefined): GroupingModel {
  if (!projection) return empty
  const rows: DiagnosticRow[] = []
  const records = new Map<string, DiagnosticRecord>()
  const references = new Map<string, ObjectReference>()
  const objects = new WeakMap<object, ObjectReference>()
  const related = new Map<string, string[]>()
  const targets = new Map<string, DiagnosticTarget>()
  const ordinal = new Map<string, string>()
  for (const entry of projection.entries) if (entry.runId && !ordinal.has(entry.runId)) ordinal.set(entry.runId, String(ordinal.size + 1))
  for (const id of projection.runs.keys()) if (!ordinal.has(id)) ordinal.set(id, String(ordinal.size + 1))
  const addRef = (ref: ObjectReference) => {
    references.set(ref.key, ref)
    objects.set(ref.value, ref)
  }
  const link = (key: string, other: string) => {
    const links = related.get(key) ?? []
    if (!links.includes(other)) links.push(other)
    related.set(key, links)
  }
  for (const entry of projection.entries) {
    const key = `source:${entry.seq}`
    addRef({
      key,
      kind: 'entry',
      identity: String(entry.seq),
      value: entry,
      target: {
        seq: entry.seq,
        ...(entry.runId ? { runId: entry.runId } : {}),
        ...(entry.kind === 'message' && entry.payload.role === 'toolResult' ? { toolCallId: entry.payload.toolCallId } : {}),
      },
    })
    if (entry.runId) {
      link(key, `run:${entry.runId}`)
      link(`run:${entry.runId}`, key)
    }
  }
  for (const [id, run] of projection.runs) addRef({ key: `run:${id}`, kind: 'run', identity: id, value: run, target: { runId: id } })
  const addItem = (item: TimelineItem, parent?: string) => {
    if (!projection.renderedKeys.has(item.key)) return
    const identity = projection.identities.get(item.key) ?? item.key
    const runId = item.origin?.runId
    // Tool result is a separate committed source; origin remains the assistant call's seq.
    const sources = projection.entries.filter(
      (entry) =>
        entry.seq === item.origin?.seq ||
        (item.kind === 'tool' && entry.kind === 'message' && entry.payload.role === 'toolResult' && entry.payload.toolCallId === item.call.id),
    )
    const target: DiagnosticTarget = {
      identity,
      kind: item.kind,
      ...(parent ? { groupId: parent } : {}),
      ...(runId ? { runId } : {}),
      ...(item.origin?.seq !== undefined ? { seq: item.origin.seq } : {}),
      sourceSeqs: sources.map((entry) => entry.seq),
      ...(item.kind === 'tool' ? { toolCallId: item.call.id } : {}),
    }
    rows.push({ key: identity, depth: parent ? 1 : 0, ...(parent ? { parent } : {}) })
    records.set(identity, {
      type: item.kind,
      identity,
      location: runId ? (ordinal.get(runId) ?? '') : '',
      value: item,
      summary: item.kind === 'text' || item.kind === 'thinking' ? item.text.slice(0, 240) : item.kind === 'tool' ? item.call.name : runtimePreview(item),
    })
    targets.set(identity, target)
    addRef({ key: identity, kind: 'row', identity, value: item, rowKey: identity, target })
    if (parent) {
      link(identity, parent)
      link(parent, identity)
    }
    if (runId) {
      link(identity, `run:${runId}`)
      link(`run:${runId}`, identity)
    }
    for (const entry of sources) {
      link(identity, `source:${entry.seq}`)
      link(`source:${entry.seq}`, identity)
      if (parent) link(parent, `source:${entry.seq}`)
    }
  }
  for (const seat of projection.seats) {
    if (seat.kind === 'row') {
      addItem(seat.item)
      continue
    }
    rows.push({ key: seat.id, depth: 0, disclosure: 'open' })
    records.set(seat.id, { type: 'process', identity: seat.id, location: ordinal.get(seat.runId) ?? '', value: seat, summary: `${seat.members.length}` })
    const target = { groupId: seat.id, runId: seat.runId }
    targets.set(seat.id, target)
    addRef({ key: seat.id, kind: 'group', identity: seat.id, value: seat, rowKey: seat.id, target })
    link(seat.id, `run:${seat.runId}`)
    link(`run:${seat.runId}`, seat.id)
    for (const member of seat.members) addItem(member, seat.id)
  }
  return { rows, records, references, objects, related, targets, revision: projection }
}

/** Bounded shallow summaries also avoid evaluating accessors on runtime values. */
function runtimePreview(value: object): string {
  const fields: string[] = []
  for (const entry of new InspectorObjectValue(value).entries()) {
    if (['key', 'kind', 'origin', 'source', 'runId'].includes(entry.name)) continue
    let label: string
    try {
      label = entry.accessor ? '[Getter/Setter]' : new InspectorObjectValue(entry.value).label
    } catch {
      label = '…'
    }
    fields.push(`${entry.name}: ${label.slice(0, 180)}`)
    if (fields.length === 5) break
  }
  return fields.join(', ').slice(0, 240)
}

/** Descriptor-only comparison ignores newly allocated provenance wrappers and process seats. */
export function sameGroupingValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.getOwnPropertyDescriptors(a),
    right = Object.getOwnPropertyDescriptors(b)
  const keys = Reflect.ownKeys(left)
  if (keys.length !== Reflect.ownKeys(right).length) return false
  return keys.every((key) => {
    const x = Reflect.getOwnPropertyDescriptor(a, key),
      y = Reflect.getOwnPropertyDescriptor(b, key)
    if (!x || !y || x.get !== y.get || x.set !== y.set) return false
    if (!('value' in x) || !('value' in y)) return true
    if (key === 'origin' || key === 'source' || key === 'call' || key === 'result' || key === 'live' || key === 'approval')
      return sameGroupingValue(x.value, y.value)
    if (key === 'members')
      return (
        Array.isArray(x.value) &&
        Array.isArray(y.value) &&
        x.value.length === y.value.length &&
        x.value.every((value: unknown, index: number) => sameGroupingValue(value, y.value[index]))
      )
    if (key === 'identities')
      return (
        Array.isArray(x.value) &&
        Array.isArray(y.value) &&
        x.value.length === y.value.length &&
        x.value.every((value: unknown, index: number) => value === y.value[index])
      )
    return Object.is(x.value, y.value)
  })
}

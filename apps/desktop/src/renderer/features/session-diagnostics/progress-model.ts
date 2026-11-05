import { isDetachedProgress, type ProgressEvent, type SessionEntryRecord } from '@coko/protocol'
import { buildRawRecords } from './raw-model.ts'
import { diagnosticPreview } from './format.ts'
import type { DiagnosticModel, DiagnosticRow } from './table-model.ts'

interface ProgressGroup {
  readonly key: string
  readonly runId: string
  readonly type: string
  readonly events: readonly ProgressEvent[]
  readonly target?: number
  readonly contentIndex?: number
  readonly toolCallId?: string
}
/** A diagnostic-tab lifetime only; initial history never manufactures transient frames. */
export interface DiagnosticProgressState {
  readonly groups: readonly ProgressGroup[]
  readonly entries: readonly SessionEntryRecord[]
  readonly historicalRuns: ReadonlySet<string>
  readonly nextId: number
}
export function createProgressState(entries: readonly SessionEntryRecord[]): DiagnosticProgressState {
  return {
    groups: [],
    entries,
    historicalRuns: new Set(entries.filter((entry) => entry.kind === 'run_end' && entry.runId).map((entry) => entry.runId!)),
    nextId: 1,
  }
}
const role = (entry: SessionEntryRecord, value: string) =>
  entry.kind === 'message' && entry.payload !== null && typeof entry.payload === 'object' && 'role' in entry.payload && entry.payload.role === value
const toolMatches = (entry: SessionEntryRecord, id: string) =>
  role(entry, 'toolResult') && 'toolCallId' in (entry.payload as object) && (entry.payload as { toolCallId: unknown }).toolCallId === id

/** Reconcile every newly committed Entry before accepting subsequent progress on the same stream. */
export function settleDiagnosticProgress(state: DiagnosticProgressState, entries: readonly SessionEntryRecord[]): DiagnosticProgressState {
  if (entries === state.entries) return state
  const known = new Set(state.entries.map((entry) => entry.seq))
  let groups = state.groups
  for (const entry of entries) {
    if (known.has(entry.seq) || !entry.runId) continue
    groups = groups.map((group) => {
      if (group.target !== undefined || group.runId !== entry.runId) return group
      const matched = group.type.startsWith('assistant_delta/')
        ? role(entry, 'assistant')
        : group.toolCallId !== undefined
          ? toolMatches(entry, group.toolCallId)
          : group.type === 'compaction'
            ? entry.kind === 'compaction'
            : (group.type === 'run_start' || group.type === 'run_end') && entry.kind === group.type
      return matched ? { ...group, target: entry.seq } : group
    })
  }
  return { ...state, entries, groups }
}

/** Preserve frames in arrival order; only Run progress belongs in the raw diagnostic model. */
export function receiveDiagnosticProgress(state: DiagnosticProgressState, runId: string, event: ProgressEvent): DiagnosticProgressState {
  if (!runId || isDetachedProgress(event) || state.historicalRuns.has(runId)) return state
  const type =
    event.type === 'assistant_delta'
      ? `assistant_delta/${event.kind}`
      : event.type.startsWith('tool_')
        ? 'tool'
        : event.type.startsWith('compaction_') && event.type !== 'compaction_failed'
          ? 'compaction'
          : event.type
  const contentIndex = event.type === 'assistant_delta' ? event.contentIndex : undefined
  const toolCallId = 'toolCallId' in event ? event.toolCallId : undefined
  // A content index restarts after assistant commit. Tool ids remain stable for their entire Run.
  const index = state.groups.findLastIndex(
    (group) =>
      group.runId === runId &&
      group.type === type &&
      (contentIndex !== undefined
        ? group.contentIndex === contentIndex && group.target === undefined
        : toolCallId !== undefined
          ? group.toolCallId === toolCallId
          : type === 'compaction' && event.type === 'compaction_end'),
  )
  if (index >= 0) return { ...state, groups: state.groups.map((group, at) => (at === index ? { ...group, events: [...group.events, event] } : group)) }
  const committed = [...state.entries]
    .reverse()
    .find(
      (entry) =>
        entry.runId === runId &&
        (toolCallId !== undefined
          ? toolMatches(entry, toolCallId)
          : type === 'compaction' && event.type === 'compaction_end'
            ? entry.kind === 'compaction'
            : (type === 'run_start' || type === 'run_end') && entry.kind === type),
    )
  const group: ProgressGroup = {
    key: `progress:group:${state.nextId}`,
    runId,
    type,
    events: [event],
    ...(contentIndex === undefined ? {} : { contentIndex }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(committed ? { target: committed.seq } : {}),
  }
  return { ...state, groups: [...state.groups, group], nextId: state.nextId + 1 }
}

/** Offset is a UTF-16 position, never an append instruction. Gaps/conflicting replay have no joined preview. */
function blockPreview(events: readonly ProgressEvent[]): string | undefined {
  let text = ''
  for (const event of events) {
    if (event.type !== 'assistant_delta') continue
    const offset = event.offset ?? text.length
    if (
      offset > text.length ||
      text.slice(offset, Math.min(text.length, offset + event.delta.length)) !== event.delta.slice(0, Math.max(0, text.length - offset))
    )
      return undefined
    text += event.delta.slice(text.length - offset)
  }
  return text.slice(0, 240)
}

/** Add live and settled transient children without altering or requesting Session data. */
export function buildProgressRecords(entries: readonly SessionEntryRecord[], state: DiagnosticProgressState, liveLabel: string): DiagnosticModel {
  const raw = buildRawRecords(entries)
  const rows: DiagnosticRow[] = []
  const records = new Map(raw.records)
  const ordinals = new Map<string, string>()
  for (const entry of entries) if (entry.runId) ordinals.set(entry.runId, raw.records.get(`entry:${entry.seq}`)!.location)
  const addGroup = (group: ProgressGroup, parent: string, depth: number) => {
    const runStart = group.type === 'run_start' && group.target !== undefined
    const grouped = group.contentIndex !== undefined || group.toolCallId !== undefined || runStart
    const header = grouped ? group.key : undefined
    if (header) {
      rows.push({ key: header, parent, depth, disclosure: group.target === undefined ? 'open' : 'closed' })
      const preview = group.contentIndex !== undefined ? blockPreview(group.events) : undefined
      records.set(header, {
        identity: header.slice('progress:'.length),
        type: runStart ? 'progress/run_start' : group.type,
        location: ordinals.get(group.runId) ?? '',
        value: group.events,
        summary: group.toolCallId ?? (group.contentIndex === undefined ? '' : String(group.contentIndex)),
        ...(preview === undefined ? {} : { collapsedSummary: preview }),
      })
    }
    group.events.forEach((event, index) => {
      const key = `${group.key}:${index}`
      rows.push({ key, parent: header ?? parent, depth: grouped ? depth + 1 : depth })
      records.set(key, {
        identity: key.slice('progress:'.length),
        type: event.type,
        location: ordinals.get(group.runId) ?? '',
        value: event,
        summary: diagnosticPreview(event, ['type']),
      })
    })
  }
  const pending = new Map<string, ProgressGroup[]>()
  for (const group of state.groups) if (group.target === undefined) pending.set(group.runId, [...(pending.get(group.runId) ?? []), group])
  const appendLive = (runId: string, parent: string, depth: number) => {
    const groups = pending.get(runId)
    if (!groups?.length) return
    const key = `progress:live:${runId}`
    rows.push({ key, parent, depth, disclosure: 'open' })
    records.set(key, { identity: '', type: liveLabel, location: ordinals.get(runId) ?? '', value: groups.flatMap((group) => group.events), summary: '' })
    for (const group of groups) addGroup(group, key, depth + 1)
    pending.delete(runId)
  }
  raw.rows.forEach((row, index) => {
    const groups = state.groups.filter((group) => row.key === `entry:${group.target}`)
    rows.push(groups.length && records.get(row.key)?.type !== 'run_start' ? { ...row, disclosure: 'closed' } : row)
    for (const group of groups) addGroup(group, row.key, row.depth + 1)
    const next = raw.rows[index + 1]
    const root = row.parent ?? row.key
    if (!next || (next.parent ?? next.key) !== root) {
      const entry = entries.find((entry) => root === `entry:${entry.seq}`)
      if (entry?.kind === 'run_start' && entry.runId) appendLive(entry.runId, root, 1)
    }
  })
  // A missing run_start never fabricates an Entry; progress still belongs to its real Run.
  for (const [runId, groups] of pending) {
    const key = `progress:live:${runId}`
    rows.push({ key, depth: 0, disclosure: 'open' })
    records.set(key, { identity: '', type: liveLabel, location: ordinals.get(runId) ?? '', value: groups.flatMap((group) => group.events), summary: '' })
    for (const group of groups) addGroup(group, key, 1)
  }
  return { rows, records }
}

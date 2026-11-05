// State Update provenance and delivery planning; browser-safe and independent of domain storage.
import { effectiveEntries } from './derive.ts'
import { todoResultText } from './todo-text.ts'
import type { EntryLike } from './types.ts'

export const STATE_UPDATE_NAMES = ['date', 'goal', 'todo_list', 'team'] as const
export type StateUpdateName = (typeof STATE_UPDATE_NAMES)[number]
export type StateValues = Partial<Record<StateUpdateName, unknown>>
export interface StateSnapshotPayload {
  name: StateUpdateName
  value: unknown
}
export interface StateUpdateDelivery {
  blocks: { type: 'text'; text: string }[]
  entries: { kind: 'state_update'; payload: StateSnapshotPayload }[]
}
export interface PairedStateUpdate<E extends EntryLike = EntryLike> {
  entry: E
  blockIndex: number
  payload: StateSnapshotPayload
}

/** Match only leading blocks to preceding entries in the same Run, stopping at the first user message. */
export function pairedStateUpdates<E extends EntryLike>(entries: readonly E[]): Map<number, PairedStateUpdate<E>[]> {
  const result = new Map<number, PairedStateUpdate<E>[]>()
  let pending: E[] = []
  for (const entry of entries) {
    if (entry.kind === 'run_start' || entry.kind === 'run_end') pending = []
    if (entry.kind === 'state_update') pending.push(entry)
    if (entry.kind !== 'message' || (entry.payload as { role?: string }).role !== 'user') continue
    const content = (entry.payload as { content?: unknown }).content
    const blocks = Array.isArray(content) ? content : []
    const paired: PairedStateUpdate<E>[] = []
    for (let index = 0; index < pending.length; index++) {
      const update = pending[index]!
      const payload = update.payload as StateSnapshotPayload
      const block = blocks[index] as { type?: string; text?: string } | undefined
      if (
        update.runId !== entry.runId ||
        !STATE_UPDATE_NAMES.includes(payload.name) ||
        block?.type !== 'text' ||
        !block.text?.startsWith(`<state_update name="${payload.name}">\n`) ||
        !block.text.endsWith('\n</state_update>')
      )
        break
      paired.push({ entry: update, blockIndex: index, payload })
    }
    if (paired.length > 0) result.set(entry.seq, paired)
    pending = []
  }
  return result
}

const normalized = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  )

/** Domain values must already have registered plaintext replaced, so comparisons use persisted values. */
export function planStateUpdates(values: StateValues, entries: readonly EntryLike[]): StateUpdateDelivery | undefined {
  const latest = new Map<StateUpdateName, unknown>()
  for (const pairs of pairedStateUpdates(effectiveEntries(entries, { compacted: true })).values())
    for (const pair of pairs) latest.set(pair.payload.name, pair.payload.value)
  const delivery: StateUpdateDelivery = { blocks: [], entries: [] }
  for (const name of STATE_UPDATE_NAMES) {
    if (!Object.hasOwn(values, name)) continue
    const value = values[name]
    if (value === undefined || (!latest.has(name) && value === null) || (latest.has(name) && normalized(value) === normalized(latest.get(name)))) continue
    delivery.entries.push({ kind: 'state_update', payload: { name, value } })
    const text = value === null ? 'This item currently has no content. Previous updates with this name no longer apply.' : renderStateValue(name, value)
    delivery.blocks.push({ type: 'text', text: `<state_update name="${name}">\n${text}\n</state_update>` })
  }
  return delivery.entries.length > 0 ? delivery : undefined
}

function renderStateValue(name: StateUpdateName, value: unknown): string {
  if (name === 'todo_list' && value && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) {
    const items = value.items as { id: string; content: string; status: string; blockedBy?: string[]; result?: string }[]
    return todoResultText(items)
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

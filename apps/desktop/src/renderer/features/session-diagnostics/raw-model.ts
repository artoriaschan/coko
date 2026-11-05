import type { SessionEntryRecord } from '@coko/protocol'
import { diagnosticPreview } from './format.ts'
import type { DiagnosticModel, DiagnosticRecord, DiagnosticRow } from './table-model.ts'

export type { DiagnosticModel } from './table-model.ts'

/** 只投影当前已加载条目；Run 组占其真实 run_start 的位置，不补造缺失记录。 */
export function buildRawRecords(entries: readonly SessionEntryRecord[]): DiagnosticModel {
  const ordered = [...entries].sort((left, right) => left.seq - right.seq)
  const starts = new Map(ordered.filter((entry) => entry.kind === 'run_start' && entry.runId).map((entry) => [entry.runId!, entry]))
  const ordinals = new Map<string, number>()
  for (const entry of ordered) if (entry.runId && !ordinals.has(entry.runId)) ordinals.set(entry.runId, ordinals.size + 1)
  const members = new Map<string, SessionEntryRecord[]>()
  for (const entry of ordered) {
    if (!entry.runId) continue
    let group = members.get(entry.runId)
    if (!group) members.set(entry.runId, (group = []))
    group.push(entry)
  }
  const rows: DiagnosticRow[] = []
  const records = new Map<string, DiagnosticRecord>()
  const add = (entry: SessionEntryRecord, parent?: string) => {
    const key = `entry:${entry.seq}`
    rows.push({ key, depth: parent ? 1 : 0, ...(parent ? { parent } : {}), ...(entry.kind === 'run_start' ? { disclosure: 'open' as const } : {}) })
    const payload = entry.payload
    const role = entry.kind === 'message' && payload !== null && typeof payload === 'object' && 'role' in payload ? `/${String(payload.role)}` : ''
    records.set(key, {
      identity: String(entry.seq),
      type: entry.kind + role,
      location: entry.runId ? String(ordinals.get(entry.runId)) : '',
      time: entry.createdAt,
      value: entry,
      summary: diagnosticPreview(payload, ['role']),
    })
  }
  for (const entry of ordered) {
    if (entry.kind === 'run_start' && entry.runId) {
      add(entry)
      for (const member of members.get(entry.runId) ?? []) if (member !== entry) add(member, `entry:${entry.seq}`)
    } else if (!entry.runId || !starts.has(entry.runId)) add(entry)
  }
  return { rows, records }
}

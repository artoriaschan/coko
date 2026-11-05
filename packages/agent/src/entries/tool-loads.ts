import { effectiveEntries } from './derive.ts'
import type { EntryLike } from './types.ts'

/** Rewind applies, compaction does not: tool loads survive summaries. */
export function loadedToolNames(entries: readonly EntryLike[]): Set<string> {
  const names = new Set<string>()
  for (const entry of effectiveEntries(entries)) {
    if (entry.kind !== 'tool_load') continue
    for (const name of (entry.payload as { names: string[] }).names) names.add(name)
  }
  return names
}

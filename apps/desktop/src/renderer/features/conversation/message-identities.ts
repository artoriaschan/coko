import { useState } from 'react'
import type { TimelineItem } from './timeline.ts'

const isAssistantBlock = (item: TimelineItem): item is Extract<TimelineItem, { kind: 'text' | 'thinking' }> => item.kind === 'text' || item.kind === 'thinking'

/**
 * Committed seq keys never depend on how much history is loaded. Only the
 * newly committed block inherits its preceding live block's render identity.
 * Ambiguous/missing Run associations keep independent identities.
 */
export function useMessageIdentities(items: TimelineItem[], sessionId: string | undefined): ReadonlyMap<string, string> {
  const [previous, setPrevious] = useState({ items, sessionId, keys: new Map<string, string>() })
  if (previous.items === items && previous.sessionId === sessionId) return previous.keys

  const keys = new Map<string, string>()
  const sameSession = previous.sessionId === sessionId
  const oldItems = sameSession ? previous.items : []
  const oldKeys = new Set(oldItems.map((item) => item.key))
  for (const item of items) {
    if (!isAssistantBlock(item)) continue
    let identity = (sameSession ? previous.keys.get(item.key) : undefined) ?? item.key
    if (!oldKeys.has(item.key) && item.source?.runId) {
      const matches = oldItems.filter(
        (old) =>
          isAssistantBlock(old) &&
          old.streaming &&
          old.kind === item.kind &&
          old.source?.runId === item.source!.runId &&
          old.source?.sessionId === item.source!.sessionId &&
          old.source?.contentIndex === item.source!.contentIndex,
      )
      const candidates = items.filter(
        (candidate) =>
          isAssistantBlock(candidate) &&
          !oldKeys.has(candidate.key) &&
          candidate.kind === item.kind &&
          candidate.streaming === item.streaming &&
          candidate.source?.runId === item.source!.runId &&
          candidate.source?.sessionId === item.source!.sessionId &&
          candidate.source?.contentIndex === item.source!.contentIndex,
      )
      if (matches.length === 1 && candidates.length === 1) identity = previous.keys.get(matches[0]!.key) ?? matches[0]!.key
    }
    keys.set(item.key, identity)
  }
  setPrevious({ items, sessionId, keys })
  return keys
}

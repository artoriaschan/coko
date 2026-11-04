import { effectiveEntries } from '@coko/agent/entries'
import type { ForkMessageOrigin, SessionEntry } from '@coko/protocol'
import type { CompletedReply } from './assistant-footer.tsx'
import type { TimelineItem } from './timeline.ts'
import { assistantMarkdown } from './message-text.ts'

/** Copied envelopes are new writes; only origin metadata can attest the original submission time. */
export function originalMessageTime(entries: readonly SessionEntry[], entry: SessionEntry): number | undefined {
  if (entry.kind !== 'message' || entry.runId !== null) return entry.createdAt
  const origin = entries.find((item) => item.kind === 'fork_origin')
  if (!origin || origin.kind !== 'fork_origin') return entry.createdAt
  return origin.payload.messages?.find((message) => message.seq === entry.seq)?.createdAt
}

/** Source-owned usage facts are read through the same counter, never committed as the new Session's requests. */
function usageEntries(source: string, reply: NonNullable<ForkMessageOrigin['reply']>): SessionEntry[] {
  const envelope = (index: number) => ({ sessionId: source, seq: index + 1, runId: reply.runId, createdAt: reply.endedAt ?? 0, payloadVersion: 1 })
  return [
    ...reply.requests.map((payload, index): SessionEntry => ({ ...envelope(index), kind: 'model_request', payload })),
    ...reply.legacy.map((value, index): SessionEntry => ({
      ...envelope(reply.requests.length + index),
      kind: 'message',
      payload: { role: 'assistant', content: [], stopReason: 'stop', ...value },
    })),
    // Presence of reply provenance attests successful completion; this read-only projection
    // never becomes a new Run and does not supply the footer's timestamp.
    { ...envelope(reply.requests.length + reply.legacy.length), kind: 'run_end', payload: { status: 'completed' } },
  ]
}

/** Only persisted successful-final provenance supplies actions for copied history, independent of active Run status. */
export function copiedReplyFooters(items: TimelineItem[], entries: readonly SessionEntry[]): Map<string, CompletedReply> {
  const result = new Map<string, CompletedReply>()
  const effective = effectiveEntries(entries)
  for (const origin of effective) {
    if (origin.kind !== 'fork_origin') continue
    for (const message of origin.payload.messages ?? []) {
      const reply = message.reply
      const entry = effective.find((item) => item.seq === message.seq)
      if (!reply || !entry || entry.kind !== 'message' || entry.payload.role !== 'assistant' || !Array.isArray(entry.payload.content)) continue
      const text = assistantMarkdown(entry)
      const seat = items.findLast((item) => item.kind === 'text' && !item.streaming && item.origin?.seq === message.seq)
      if (seat && text.trim())
        result.set(seat.key, {
          runId: reply.runId,
          seq: message.seq,
          text,
          endedAt: reply.endedAt,
          usageEntries: usageEntries(origin.payload.sessionId, reply),
        })
    }
  }
  return result
}

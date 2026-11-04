import type { SessionEntryRecord } from '@coko/protocol'
import type { Translator } from '@coko/i18n'

export interface SessionStatistics {
  rounds: number
  steps: number
  modelMs: number
  toolMs: number
  ttftMs?: number
  tokensPerSecond?: number
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/** Main-loop attempts retain their elapsed time, but retries belong to the preceding logical step. */
export function sessionStatistics(entries: readonly SessionEntryRecord[]): SessionStatistics {
  const rounds = new Set<string>()
  const requests = new Set<string>()
  const calls = new Map<string, number>()
  const results = new Set<string>()
  const stats: SessionStatistics = { rounds: 0, steps: 0, modelMs: 0, toolMs: 0 }
  let ttftTotal = 0
  let ttftCount = 0
  let output = 0
  let generationMs = 0
  for (const entry of entries) {
    if (!entry.runId) continue
    const payload = record(entry.payload)
    if (!payload) continue
    if (entry.kind === 'model_request' && payload.purpose === 'turn') {
      const id = `${entry.runId}:${typeof payload.requestId === 'string' ? payload.requestId : entry.seq}`
      if (requests.has(id)) continue
      requests.add(id)
      if (!rounds.has(entry.runId) || count(payload.retries) === 0) stats.steps++
      rounds.add(entry.runId)
      const duration = count(payload.durationMs)
      stats.modelMs += duration
      if (typeof payload.ttftMs === 'number' && payload.ttftMs >= 0 && payload.ttftMs <= duration) {
        ttftTotal += payload.ttftMs
        ttftCount++
        const report = record(payload.usageReport)
        const outputKnown = report === undefined || (Array.isArray(report.known) && report.known.includes('output'))
        if (duration > payload.ttftMs && outputKnown) {
          output += count(record(payload.usage)?.output)
          generationMs += duration - payload.ttftMs
        }
      }
    } else if (entry.kind === 'message') {
      if (payload.role === 'assistant' && Array.isArray(payload.content)) {
        for (const content of payload.content) {
          const block = record(content)
          if (block?.type === 'toolCall' && typeof block.id === 'string' && !calls.has(block.id)) calls.set(block.id, entry.createdAt)
        }
      } else if (payload.role === 'toolResult' && typeof payload.toolCallId === 'string') {
        const started = calls.get(payload.toolCallId)
        if (started !== undefined && !results.has(payload.toolCallId)) {
          results.add(payload.toolCallId)
          stats.toolMs += Math.max(0, entry.createdAt - started)
        }
      }
    }
  }
  stats.rounds = rounds.size
  if (ttftCount > 0) stats.ttftMs = ttftTotal / ttftCount
  if (generationMs > 0 && output > 0) stats.tokensPerSecond = output / (generationMs / 1000)
  return stats
}

export function formatStatisticsDuration(milliseconds: number, t: Translator): string {
  if (milliseconds < 60_000) return t('usage.statistics.seconds', { value: (milliseconds / 1000).toFixed(1) })
  const seconds = Math.round(milliseconds / 1000)
  return t('usage.statistics.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

export function formatStatisticsSpeed(tokensPerSecond: number): string {
  return tokensPerSecond >= 10 ? String(Math.round(tokensPerSecond)) : tokensPerSecond.toFixed(1)
}

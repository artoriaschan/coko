import { describe, expect, it } from 'vitest'
import type { SessionEntryRecord } from '@coko/protocol'
import { createTranslator } from '@coko/i18n'
import { formatStatisticsDuration, formatStatisticsSpeed, sessionStatistics } from './session-statistics.ts'

const request = (seq: number, runId: string, extra = {}): SessionEntryRecord => ({
  sessionId: 's',
  payloadVersion: 1,
  seq,
  kind: 'model_request',
  runId,
  createdAt: seq,
  payload: {
    runId,
    requestId: `request-${seq}`,
    purpose: 'turn',
    retries: 0,
    durationMs: 1000,
    ttftMs: 200,
    usage: { input: 100, output: 80, cacheRead: 0, cacheWrite: 0, total: 180 },
    ...extra,
  },
})
describe('Session statistics from committed entries', () => {
  it('counts logical main-loop calls once while keeping retry time and excluding auxiliary requests', () => {
    const first = request(1, 'user', { stopReason: 'error', durationMs: 500, ttftMs: undefined, usage: { output: 0 } })
    const stats = sessionStatistics([
      first,
      request(2, 'user', { retries: 1 }),
      request(3, 'user', { durationMs: 2000, ttftMs: 400, usage: { output: 160 } }),
      request(4, 'goal'),
      request(5, 'compact', { purpose: 'compaction' }),
      request(6, 'handoff', { purpose: 'summary' }),
      request(7, 'title', { purpose: 'title' }),
      first,
    ])
    expect(stats).toEqual({ rounds: 2, steps: 3, modelMs: 4500, toolMs: 0, ttftMs: 800 / 3, tokensPerSecond: 100 })
  })
  it('pairs tool results once and includes approval waiting in elapsed time', () => {
    const call: SessionEntryRecord = {
      sessionId: 's',
      payloadVersion: 1,
      seq: 1,
      kind: 'message',
      runId: 'r',
      createdAt: 1000,
      payload: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tool', name: 'bash' },
          { type: 'toolCall', id: 'unfinished', name: 'bash' },
        ],
      },
    }
    const result: SessionEntryRecord = {
      sessionId: 's',
      payloadVersion: 1,
      seq: 4,
      kind: 'message',
      runId: 'r',
      createdAt: 5500,
      payload: { role: 'toolResult', toolCallId: 'tool' },
    }
    expect(
      sessionStatistics([
        call,
        {
          sessionId: 's',
          payloadVersion: 1,
          seq: 2,
          kind: 'approval_request',
          runId: 'r',
          createdAt: 1100,
          payload: { requestId: 'approval', toolCallId: 'tool' },
        },
        {
          sessionId: 's',
          payloadVersion: 1,
          seq: 3,
          kind: 'approval_decision',
          runId: 'r',
          createdAt: 5000,
          payload: { requestId: 'approval', outcome: 'allowed' },
        },
        result,
        result,
      ]),
    ).toEqual({ rounds: 0, steps: 0, modelMs: 0, toolMs: 4500 })
  })
  it('does not invent TTFT or speed for old, missing or zero measurements', () => {
    expect(sessionStatistics([])).toEqual({ rounds: 0, steps: 0, modelMs: 0, toolMs: 0 })
    expect(sessionStatistics([request(1, 'r', { ttftMs: undefined })])).toEqual({ rounds: 1, steps: 1, modelMs: 1000, toolMs: 0 })
    expect(sessionStatistics([request(1, 'r', { durationMs: 0, ttftMs: 0 })])).toEqual({ rounds: 1, steps: 1, modelMs: 0, toolMs: 0, ttftMs: 0 })
    expect(sessionStatistics([request(1, 'r', { durationMs: 1000, ttftMs: undefined, usage: { output: 900 } }), request(2, 'r')]).tokensPerSecond).toBe(100)
  })
  it('formats durations and rates at the specified boundaries in both locales', () => {
    const zh = createTranslator('zh')
    const en = createTranslator('en')
    expect(formatStatisticsDuration(45200, zh)).toBe('45.2秒')
    expect(formatStatisticsDuration(162000, zh)).toBe('2分42秒')
    expect(formatStatisticsDuration(60000, en)).toBe('1m 0s')
    expect(formatStatisticsSpeed(9.84)).toBe('9.8')
    expect(formatStatisticsSpeed(10.4)).toBe('10')
  })
  it('uses only paired timing and reported output samples for speed', () => {
    expect(
      sessionStatistics([request(1, 'r', { usage: { output: 800 }, usageReport: { complete: false, known: ['input'] } }), request(2, 'r')]).tokensPerSecond,
    ).toBe(100)
  })
})

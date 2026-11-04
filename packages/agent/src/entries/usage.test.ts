// 按 Run 汇总：canonical 请求优先、消息/压缩/交接回退、旧来源与请求配对、完整性与数值校验。
import { describe, expect, it } from 'vitest'
import type { EntryLike } from './types.ts'
import { aggregateUsageByRun } from './usage.ts'

let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = 'r1'): EntryLike => ({ seq: ++seq, kind, runId, payload })
const counts = (input = 70, cacheRead = 30, cacheWrite = 0, output = 20) => ({ input, cacheRead, cacheWrite, output })
const total = (value = counts()) => value.input + value.cacheRead + value.cacheWrite + value.output
const request = (
  runId: string,
  usage = counts(),
  report: { complete: boolean; known: string[] } = { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
) =>
  entry(
    'model_request',
    { runId, requestId: `req-${seq + 1}`, purpose: 'turn', provider: 'p', model: 'm', usage: { ...usage, total: total(usage) }, usageReport: report },
    runId,
  )
const message = (runId: string, usage = counts(), report?: { complete: boolean; known: string[] }) =>
  entry(
    'message',
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      stopReason: 'stop',
      provider: 'p',
      model: 'm',
      usage: { ...usage, totalTokens: total(usage), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...(report ? { report } : {}) },
    },
    runId,
  )
const ended = (runId = 'r1', status = 'completed') => entry('run_end', { status }, runId)

describe('aggregateUsageByRun', () => {
  it('counts a canonical request once and pairs its identical assistant message without duplicating it', () => {
    const entries = [request('r1'), message('r1'), ended()]
    const { session, byRun } = aggregateUsageByRun(entries)
    expect(byRun.get('r1')).toMatchObject({ requests: 1, complete: true, totals: counts(), reported: counts() })
    expect(session).toMatchObject({ requests: 1, complete: true, totals: counts() })
  })

  it('marks a run incomplete when a skipped legacy source cannot be paired with any recorded request', () => {
    const entries = [request('r1'), message('r1', counts(10, 0, 0, 5)), ended()]
    const run = aggregateUsageByRun(entries).byRun.get('r1')!
    expect(run.complete).toBe(false)
    expect(run.known).toEqual([])
    expect(run.totals).toEqual(counts(70, 30, 0, 20))
  })

  it('falls back to a legacy assistant message when the run has no canonical request', () => {
    const entries = [message('r1', counts(10, 0, 0, 5)), ended()]
    const run = aggregateUsageByRun(entries).byRun.get('r1')!
    expect(run).toMatchObject({ requests: 1, complete: false, totals: counts(10, 0, 0, 5), reported: counts(10, 0, 0, 5) })
    expect(run.known).toEqual(['input', 'cacheRead', 'cacheWrite', 'output'])
  })

  it('falls back to compaction and handoff usage when no canonical request exists', () => {
    const entries = [
      entry('compaction', {
        summary: 's',
        firstKeptSeq: 1,
        usage: { ...counts(5, 0, 0, 1), totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }),
      entry('handoff', {
        targetSessionId: 's2',
        instructions: 'i',
        summary: 's',
        target: 'current',
        usage: { ...counts(7, 0, 0, 2), totalTokens: 9, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }),
      ended(),
    ]
    expect(aggregateUsageByRun(entries).byRun.get('r1')).toMatchObject({ requests: 2, totals: counts(12, 0, 0, 3) })
  })

  it('requires a completed run_end and clears known buckets when the run ended interrupted', () => {
    const entries = [request('r1'), message('r1'), ended('r1', 'interrupted')]
    const run = aggregateUsageByRun(entries).byRun.get('r1')!
    expect(run.complete).toBe(false)
    expect(run.known).toEqual([])
  })

  it('includes title requests in the session but never in a run or when includeTitle is false', () => {
    const title = entry(
      'model_request',
      {
        requestId: 'title-1',
        purpose: 'title',
        provider: 'p',
        model: 'm',
        usage: { ...counts(3, 0, 0, 1), total: 4 },
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      },
      null,
    )
    const entries = [title, request('r1'), message('r1'), ended()]
    expect(aggregateUsageByRun(entries).session).toMatchObject({ requests: 2, totals: counts(73, 30, 0, 21) })
    expect(aggregateUsageByRun(entries).byRun.get('r1')?.requests).toBe(1)
    expect(aggregateUsageByRun(entries, { includeTitle: false }).session.requests).toBe(1)
  })

  it('deduplicates repeated request records and rejects a declared total below the bucket sum', () => {
    const duplicate = request('r1')
    const contradictory = entry('model_request', {
      runId: 'r1',
      requestId: 'bad-1',
      purpose: 'turn',
      usage: { ...counts(70, 30, 0, 20), total: 50 },
      usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
    })
    const entries = [duplicate, { ...duplicate, seq: duplicate.seq + 100 }, ended()]
    expect(aggregateUsageByRun(entries).byRun.get('r1')).toMatchObject({ requests: 1, complete: true })
    const invalid = aggregateUsageByRun([contradictory, message('r1'), ended()]).byRun.get('r1')!
    expect(invalid.complete).toBe(false)
    expect(invalid.known).toEqual([])
  })
})

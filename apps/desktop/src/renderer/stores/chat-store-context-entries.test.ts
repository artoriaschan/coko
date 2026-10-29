// M3 预先声明的条目与进度：renderer 接收 command / compaction 条目与 context_usage、compaction_* 进度时不报错；compaction 显示为分隔条（票 11），进度不改变对话的临时显示状态。
import type { ProgressEvent, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { buildTimeline } from '../features/conversation/timeline.ts'
import { reduceProgress, type Conversation } from './chat-store.ts'
import { SessionEntry } from '@coko/protocol'
import { Value } from 'typebox/value'

const record = (seq: number, kind: string, payload: unknown, runId = 'r1'): SessionEntryRecord => ({
  sessionId: 's1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})

describe('M3 预先声明的条目与进度', () => {
  it('command 与 compaction 条目通过信任边界校验，时间线照常渲染其余条目', () => {
    const records = [
      record(1, 'run_start', { trigger: 'submit' }),
      record(2, 'command', { name: 'review', args: 'src', source: 'project' }),
      record(3, 'message', { role: 'user', content: 'expanded', timestamp: 0 }),
      record(4, 'compaction', { summary: 's', firstKeptSeq: 3, tokensBefore: 10, trigger: 'manual', readFiles: [], modifiedFiles: [] }),
      record(5, 'run_end', { status: 'completed' }),
    ]
    const entries = records.filter((r) => Value.Check(SessionEntry, r)) as SessionEntry[]
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    const conversation: Conversation = { status: 'ready', entries, lastSeq: 5, running: false, live: null }
    // compaction 显示为分隔条（票 11）。
    expect(buildTimeline(conversation).map((i) => i.kind)).toEqual(['user', 'compaction'])
  })

  it('context_usage 与 compaction_* 进度不改变临时显示状态', () => {
    const live = reduceProgress(null, 'r1', { type: 'run_start' })
    const events: Exclude<ProgressEvent, { type: 'run_end' }>[] = [
      { type: 'context_usage', tokens: 10, contextWindow: 100 },
      { type: 'compaction_start', trigger: 'auto' },
      { type: 'compaction_end', trigger: 'auto', tokensBefore: 10, tokensAfter: 2 },
      { type: 'compaction_failed', trigger: 'auto', message: 'x', consecutiveFailures: 1 },
    ]
    for (const event of events) expect(reduceProgress(live, 'r1', event)).toBe(live)
  })
})

// 分叉复制的条目种类：M4 的 Goal、Todo、计划与后台任务状态不随分叉复制（它们属于原 Session）。
import { describe, expect, it } from 'vitest'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'
import { forkEntries } from './fork.ts'

let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = 'r1') =>
  ({ sessionId: 's', seq: ++seq, kind, payload, runId }) as unknown as CheckpointEntry
const user = (text: string) => entry('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 0 })

const M4_KINDS: [string, unknown][] = [
  ['goal', { id: 'g1', revision: 1, objective: 'o', criteria: [{ id: 'c1', text: 'c' }], budget: {}, phase: 'running', resumedAtRound: 0, source: 'model' }],
  ['todo_list', { items: [{ id: 't1', content: 'x', status: 'pending' }] }],
  ['plan', { planId: 'p1', revision: 1, markdown: '# P', status: 'proposed' }],
  ['job_start', { jobId: 'j1', kind: 'bash', label: 'l', command: 'c', toolCallId: 't', logPath: '/l' }],
  ['job_end', { jobId: 'j1', status: 'completed', exitCode: 0, outputBytes: 0, truncated: false }],
  ['job_notification', { jobIds: ['j1'] }],
]

describe('forkEntries 不复制 M4 条目', () => {
  it.each(M4_KINDS)('%s 不出现在分叉后的条目中；消息与权限条目照常复制', (kind, payload) => {
    seq = 0
    const entries = [entry('permission_mode', { mode: 'default' }, null), user('one'), entry(kind, payload), user('two')]
    const forked = forkEntries(entries, 's', 4)
    expect(forked.entries.map((e) => e.kind)).toEqual(['fork_origin', 'permission_mode', 'message'])
  })
})

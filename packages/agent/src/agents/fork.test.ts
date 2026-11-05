// 分叉复制的条目种类：M4 的 Goal、Todo、计划与后台任务状态，M5 的 Hook、子代理、定时任务与 Handoff 记录不随分叉复制（它们属于原 Session）。
import { describe, expect, it } from 'vitest'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'
import { forkEntries } from './fork.ts'
import { planStateUpdates } from '../entries/index.ts'

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

/** M5 的条目（Hook、子代理、定时任务、Handoff）属于原 Session，分叉不复制。 */
const M5_KINDS: [string, unknown][] = [
  [
    'hook_run',
    {
      event: 'PreToolUse',
      hookId: 'global:PreToolUse:0:0',
      source: 'global',
      command: 'check.sh',
      outcome: 'blocked',
      exitCode: 2,
      durationMs: 12,
      message: 'no',
    },
  ],
  [
    'agent_start',
    {
      agentId: 's2',
      agentType: 'explore',
      description: 'find',
      background: true,
      toolCallId: 't',
      goalId: 'g1',
      isolation: { worktreeId: 'w', path: '/r/.coko-worktrees/a', branch: 'coko/a' },
    },
  ],
  [
    'agent_end',
    {
      agentId: 's2',
      status: 'max-turns',
      usage: { turns: 3, toolCalls: 4, tokens: 100, cost: 0.1, durationMs: 50 },
      resultChars: 10,
      worktree: { kept: true, path: '/p', branch: 'coko/a' },
    },
  ],
  ['agent_notification', { agentIds: ['s2'] }],
  [
    'subagent_origin',
    {
      parentSessionId: 's1',
      parentRunId: 'r1',
      toolCallId: 't',
      definition: { name: 'explore', source: 'builtin', tools: ['read'], permissionMode: 'read-only', maxTurns: 50 },
    },
  ],
  ['schedule_fire', { scheduleId: 'sc1', occurrence: 1000, status: 'skipped', reason: 'budget', missed: 3 }],
  ['handoff', { targetSessionId: 's3', instructions: 'next', summary: '## Task', target: 'worktree' }],
  ['handoff_origin', { sessionId: 's1', seq: 9 }],
]

const M6_KINDS: [string, unknown][] = [
  ['team_task', { taskId: 't1', revision: 1, subject: 's', description: '', status: 'pending', blockedBy: [], writeScopes: [], by: 'lead' }],
  ['team_message', { messageId: 'm1', from: 'alice', to: 'lead' }],
  [
    'model_request',
    {
      runId: 'r1',
      provider: 'faux',
      model: 'm',
      startedAt: 0,
      durationMs: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      stopReason: 'stop',
      retries: 0,
      purpose: 'turn',
    },
  ],
]

describe('forkEntries 不复制 M4、M5 与 M6 条目', () => {
  it('压缩分叉保留首条消息之前的更新来源，后续规划不重复发送同值', () => {
    seq = 0
    const update = entry('state_update', { name: 'date', value: '2026-11-05' })
    const input = entry('message', {
      role: 'user',
      content: [
        { type: 'text', text: '<state_update name="date">\n2026-11-05\n</state_update>' },
        { type: 'text', text: 'one' },
      ],
      timestamp: 0,
    })
    const compact = entry('compaction', { firstKeptSeq: update.seq, summary: 'earlier history' })
    const target = user('two')
    const forked = forkEntries([update, input, compact, target], 's', target.seq)
    expect(forked.entries.map((entry) => entry.kind)).toEqual(['fork_origin', 'compaction', 'state_update', 'message'])
    expect(forked.entries[1]!.payload).toMatchObject({ firstKeptSeq: 3 })
    const copied = forked.entries.map((entry, index) => ({ ...entry, seq: index + 1, runId: null }))
    expect(planStateUpdates({ date: '2026-11-05' }, copied)).toBeUndefined()
  })

  it('仅随保留的用户消息复制配对的 State Update，目标消息之前的孤立更新不复制', () => {
    seq = 0
    const date = entry('state_update', { name: 'date', value: '2026-11-05' })
    const first = entry('message', {
      role: 'user',
      content: [
        { type: 'text', text: '<state_update name="date">\n2026-11-05\n</state_update>' },
        { type: 'text', text: 'one' },
      ],
      timestamp: 0,
    })
    const omitted = entry('state_update', { name: 'todo_list', value: { items: [] } })
    const target = entry('message', {
      role: 'user',
      content: [
        { type: 'text', text: '<state_update name="todo_list">\nempty\n</state_update>' },
        { type: 'text', text: 'two' },
      ],
      timestamp: 1,
    })
    const forked = forkEntries([date, first, omitted, target], 's', target.seq)
    expect(forked.entries).toEqual([
      { kind: 'fork_origin', payload: { sessionId: 's', seq: target.seq } },
      { kind: 'state_update', payload: { name: 'date', value: '2026-11-05' } },
      { kind: 'message', payload: first.payload },
    ])
  })

  it.each([...M4_KINDS, ...M5_KINDS, ...M6_KINDS])('%s 不出现在分叉后的条目中；消息与权限条目照常复制', (kind, payload) => {
    seq = 0
    const entries = [entry('permission_mode', { mode: 'default' }, null), user('one'), entry(kind, payload), user('two')]
    const forked = forkEntries(entries, 's', 4)
    expect(forked.entries.map((e) => e.kind)).toEqual(['fork_origin', 'permission_mode', 'message'])
  })
})

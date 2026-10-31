// 交接的提示、准入与目标条目推导：权限条目的复制与"从此分叉"同一规则；M4 与 M5 的会话状态条目不复制。
import { describe, expect, it } from 'vitest'
import type { CheckpointEntry } from '../checkpoints/tracker.ts'
import { forkEntries } from './fork.ts'
import { HANDOFF_SUMMARY_MAX_CHARS, handoffPrompt, handoffSummaryText, handoffTargetEntries, hasUserMessage } from './handoff.ts'

let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = 'r1') =>
  ({ sessionId: 's', seq: ++seq, kind, payload, runId }) as unknown as CheckpointEntry
const user = (text: string) => entry('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 0 })
const assistant = (text: string) => entry('message', { role: 'assistant', content: [{ type: 'text', text }], timestamp: 0 })
const rule = (op: 'add' | 'remove', tool: string) => entry('permission_rule', { op, rule: { behavior: 'allow', tool } }, null)

const STATE_KINDS: [string, unknown][] = [
  ['goal', { id: 'g1', revision: 1, objective: 'o', criteria: [{ id: 'c1', text: 'c' }], budget: {}, phase: 'running', resumedAtRound: 0, source: 'model' }],
  ['todo_list', { items: [{ id: 't1', content: 'x', status: 'pending' }] }],
  ['plan', { planId: 'p1', revision: 1, markdown: '# P', status: 'proposed' }],
  ['job_start', { jobId: 'j1', kind: 'bash', label: 'l', command: 'c', toolCallId: 't', logPath: '/l' }],
  ['schedule_fire', { scheduleId: 'sc1', occurrence: 1000, status: 'skipped', reason: 'budget', missed: 3 }],
  ['agent_notification', { agentIds: ['s2'] }],
  ['handoff', { targetSessionId: 's3', instructions: 'next', summary: '## Task', target: 'worktree' }],
  ['handoff_origin', { sessionId: 's0', seq: 2 }],
  ['team_task', { taskId: 't1', revision: 1, subject: 's', description: '', status: 'pending', blockedBy: [], writeScopes: [], by: 'lead' }],
  ['team_message', { messageId: 'm1', from: 'alice', to: 'lead' }],
  [
    'model_request',
    {
      runId: 'r1',
      provider: 'f',
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

describe('handoffTargetEntries', () => {
  it('首条 handoff_origin，之后是权限模式与 Session 规则（去掉 runId，顺序不变）；消息不复制', () => {
    seq = 0
    const entries = [
      entry('permission_mode', { mode: 'default' }, null),
      user('one'),
      assistant('a'),
      entry('permission_mode', { mode: 'plan' }, 'r1'),
      rule('add', 'Bash'),
    ]
    expect(handoffTargetEntries(entries, 'src', 9)).toEqual([
      { kind: 'handoff_origin', payload: { sessionId: 'src', seq: 9 } },
      { kind: 'permission_mode', payload: { mode: 'default' } },
      { kind: 'permission_mode', payload: { mode: 'plan' } },
      { kind: 'permission_rule', payload: { op: 'add', rule: { behavior: 'allow', tool: 'Bash' } } },
    ])
  })

  it.each(STATE_KINDS)('%s 不复制', (kind, payload) => {
    seq = 0
    const entries = [entry('permission_mode', { mode: 'default' }, null), user('one'), entry(kind, payload)]
    expect(handoffTargetEntries(entries, 's', 3).map((e) => e.kind)).toEqual(['handoff_origin', 'permission_mode'])
  })

  it('与 forkEntries 的权限条目相同（同一组条目，分叉到其后的一条用户消息）', () => {
    seq = 0
    const entries = [
      entry('permission_mode', { mode: 'default' }, null),
      user('one'),
      rule('add', 'Bash'),
      entry('permission_mode', { mode: 'accept-edits' }, null),
      ...STATE_KINDS.map(([kind, payload]) => entry(kind, payload)),
      rule('remove', 'Bash'),
      rule('add', 'Write'),
    ]
    const last = user('two')
    const forked = forkEntries([...entries, last], 's', last.seq).entries.filter((e) => e.kind !== 'fork_origin' && e.kind !== 'message')
    expect(handoffTargetEntries(entries, 's', 1).slice(1)).toEqual(forked)
  })

  it('被回退区间内的权限条目不复制（与有效上下文一致）', () => {
    seq = 0
    const mode = entry('permission_mode', { mode: 'default' }, null)
    const first = user('one')
    const entries = [
      mode,
      first,
      entry('permission_mode', { mode: 'full-access' }, null),
      entry('rewind', { targetSeq: first.seq, mode: 'conversation' }, null),
      user('again'),
    ]
    expect(handoffTargetEntries(entries, 's', 6).map((e) => e.payload)).toEqual([{ sessionId: 's', seq: 6 }, { mode: 'default' }])
  })
})

describe('hasUserMessage', () => {
  it('只有权限条目或 assistant 消息时 false；有用户消息时 true；用户消息全被回退时 false', () => {
    seq = 0
    expect(hasUserMessage([entry('permission_mode', { mode: 'default' }, null)])).toBe(false)
    expect(hasUserMessage([assistant('a')])).toBe(false)
    seq = 0
    const one = user('one')
    expect(hasUserMessage([one])).toBe(true)
    expect(hasUserMessage([one, entry('rewind', { targetSeq: one.seq, mode: 'conversation' }, null)])).toBe(false)
  })
})

describe('handoffPrompt 与 handoffSummaryText', () => {
  it('提示含四个小节、上限与下一步目标', () => {
    const prompt = handoffPrompt('  build the login page \n')
    for (const section of ['## Context', '## Files', '## Open items', '## Task']) expect(prompt).toContain(section)
    expect(prompt).toContain(String(HANDOFF_SUMMARY_MAX_CHARS))
    expect(prompt.endsWith('<next-goal>\nbuild the login page\n</next-goal>')).toBe(true)
  })

  it('摘要去掉首尾空白，超过上限时截断到上限', () => {
    expect(handoffSummaryText('  ## Task\nx \n')).toBe('## Task\nx')
    expect(handoffSummaryText('a'.repeat(HANDOFF_SUMMARY_MAX_CHARS + 50))).toHaveLength(HANDOFF_SUMMARY_MAX_CHARS)
  })
})

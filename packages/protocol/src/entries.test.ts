import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { SESSION_ENTRY_PAYLOAD_SCHEMAS, SessionEntry, SessionEntryRecord } from './entries.ts'

const base = { sessionId: 's1', seq: 1, payloadVersion: 1, runId: 'r1', createdAt: 1 }

describe('SessionEntry 按 kind 判别', () => {
  it('预先声明规格表中全部 M2–M6 kind', () => {
    expect(Object.keys(SESSION_ENTRY_PAYLOAD_SCHEMAS).toSorted()).toEqual(
      [
        'approval_decision',
        'approval_request',
        'confirmation_answer',
        'confirmation_request',
        'file_backup',
        'file_change',
        'fork_origin',
        'message',
        'permission_mode',
        'permission_rule',
        'rewind',
        'run_end',
        'run_start',
        'tool_exec',
        'command',
        'compaction',
        'goal',
        'todo_list',
        'plan',
        'job_start',
        'job_end',
        'job_notification',
        'hook_run',
        'agent_start',
        'agent_end',
        'agent_notification',
        'subagent_origin',
        'schedule_fire',
        'handoff',
        'handoff_failed',
        'handoff_origin',
        'team_task',
        'team_message',
        'model_request',
      ].toSorted(),
    )
  })

  it('payload 按各自 kind 的 schema 校验；信封只校验外层字段', () => {
    const accepted = [
      { kind: 'run_start', payload: { trigger: 'submit' } },
      { kind: 'run_end', payload: { status: 'interrupted', undeliveredSteering: ['x'] } },
      { kind: 'message', payload: { role: 'user', content: 'hi', timestamp: 0 } },
      { kind: 'message', payload: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', usage: {} } },
      { kind: 'approval_decision', payload: { requestId: 'q', outcome: 'allowed', scope: 'once' } },
      { kind: 'fork_origin', payload: { sessionId: 's0', seq: 4 } },
      { kind: 'run_start', payload: { trigger: 'schedule', schedule: { scheduleId: 'sc1', occurrence: 5 } } },
      { kind: 'approval_decision', payload: { requestId: 'q', outcome: 'allowed', by: 'hook' } },
      ...(
        [
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
          ['handoff_failed', { instructions: 'next', summary: '## Task', error: { code: 'worktree-exists', message: 'taken' } }],
          ['handoff_origin', { sessionId: 's1', seq: 9 }],
        ] as [string, unknown][]
      ).map(([kind, payload]) => ({ kind, payload })),
    ]
    const rejected = [
      { kind: 'run_end', payload: { status: 'done' } },
      { kind: 'run_start', payload: { trigger: 'submit', extra: 1 } },
      { kind: 'message', payload: { role: 'assistant', content: 'not blocks' } },
      { kind: 'message', payload: null },
      { kind: 'tool_exec', payload: { toolCallId: 't' } },
      { kind: 'unknown_kind', payload: {} },
      { kind: 'approval_decision', payload: { requestId: 'q', outcome: 'allowed', by: 'script' } },
      { kind: 'agent_notification', payload: { agentIds: [] } },
    ]
    const verdicts = (list: { kind: string; payload: unknown }[]) =>
      list.map((entry) => [entry.kind, Value.Check(SessionEntry, { ...base, ...entry }), Value.Check(SessionEntryRecord, { ...base, ...entry })])
    expect(verdicts(accepted)).toEqual(accepted.map((e) => [e.kind, true, true]))
    expect(verdicts(rejected)).toEqual(rejected.map((e) => [e.kind, false, true]))
  })
})

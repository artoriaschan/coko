import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { SESSION_ENTRY_PAYLOAD_SCHEMAS, SessionEntry, SessionEntryRecord } from './entries.ts'

const base = { sessionId: 's1', seq: 1, payloadVersion: 1, runId: 'r1', createdAt: 1 }

describe('SessionEntry 按 kind 判别', () => {
  it('预先声明规格表中全部 M2、M3 与 M4 kind', () => {
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
    ]
    const rejected = [
      { kind: 'run_end', payload: { status: 'done' } },
      { kind: 'run_start', payload: { trigger: 'submit', extra: 1 } },
      { kind: 'message', payload: { role: 'assistant', content: 'not blocks' } },
      { kind: 'message', payload: null },
      { kind: 'tool_exec', payload: { toolCallId: 't' } },
      { kind: 'unknown_kind', payload: {} },
    ]
    const verdicts = (list: { kind: string; payload: unknown }[]) =>
      list.map((entry) => [entry.kind, Value.Check(SessionEntry, { ...base, ...entry }), Value.Check(SessionEntryRecord, { ...base, ...entry })])
    expect(verdicts(accepted)).toEqual(accepted.map((e) => [e.kind, true, true]))
    expect(verdicts(rejected)).toEqual(rejected.map((e) => [e.kind, false, true]))
  })
})

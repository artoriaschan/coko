import { describe, expect, it } from 'vitest'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace } from '../testing/workspace.ts'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { SESSION_ENTRY_PAYLOADS, type EntryJson } from './index.ts'

const definition = (kind: string) => {
  const found = SESSION_ENTRY_PAYLOADS.find((d) => d.kind === kind)
  if (!found) throw new Error(`kind ${kind} is not defined`)
  return found
}
const check = (kind: string, payload: unknown) => definition(kind).versions.at(-1)!.check(payload)

describe('Session Entry payload 定义', () => {
  it('预先定义规格表中全部 M2–M5 kind，每个 kind 只出现一次', () => {
    expect(SESSION_ENTRY_PAYLOADS.map((d) => d.kind).toSorted()).toEqual(
      [
        'run_start',
        'message',
        'run_end',
        'permission_mode',
        'permission_rule',
        'approval_request',
        'approval_decision',
        'tool_exec',
        'confirmation_request',
        'confirmation_answer',
        'file_backup',
        'file_change',
        'rewind',
        'fork_origin',
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
        'handoff_origin',
      ].toSorted(),
    )
  })

  it('运行时提交的每个条目都合其 kind 的 schema（含工具调用、工具结果与模型错误）', async () => {
    const ws = await createTempWorkspace('coko-entries-')
    try {
      const { faux, models, model } = createFauxModels()
      const entries: RunEntry[] = []
      const runtime = createAgentRuntime({
        models,
        model,
        cwd: ws.dir,
        commit: async (entry) => void entries.push(entry),
        retry: { maxRetries: 0, baseDelayMs: 1 },
      })
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('read', { path: 'missing.txt' }, { id: 'r1' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Invalid API key' }),
        fauxAssistantMessage('recovered'),
      ])
      await runtime.run('read a missing file')
      await runtime.retry()
      expect(entries.map((e) => e.kind)).toEqual(['run_start', 'message', 'message', 'message', 'message', 'run_end', 'run_start', 'message', 'run_end'])
      const reasons = entries.map((entry) => [entry.kind, check(entry.kind, JSON.parse(JSON.stringify(entry.payload)))])
      expect(reasons).toEqual(entries.map((entry) => [entry.kind, undefined]))
    } finally {
      await ws.dispose()
    }
  })

  it('run_start v1 条目迁移为 v2（原样）；v2 接受 trigger goal 与 goal', () => {
    const versions = definition('run_start').versions
    for (const trigger of ['submit', 'retry', 'continue', 'compact']) {
      expect(versions[0]!.check({ trigger })).toBeUndefined()
      const migrated = versions[1]!.migrate!({ trigger })
      expect(migrated).toEqual({ trigger })
      expect(versions[1]!.check(migrated)).toBeUndefined()
    }
    expect(versions[0]!.check({ trigger: 'goal' })).toEqual(expect.any(String))
    expect(check('run_start', { trigger: 'goal', goal: { goalId: 'g1', round: 2 } })).toBeUndefined()
    expect(check('run_start', { trigger: 'goal', goal: { goalId: 'g1', round: 0 } })).toEqual(expect.any(String))
  })

  it('run_start v2 条目迁移为 v3（原样）；v3 接受 schedule / subagent / handoff 与 schedule 字段，v2 不接受', () => {
    const versions = definition('run_start').versions
    expect(versions).toHaveLength(3)
    for (const payload of [{ trigger: 'submit' }, { trigger: 'goal', goal: { goalId: 'g1', round: 2 } }] as EntryJson[]) {
      expect(versions[1]!.check(payload)).toBeUndefined()
      const migrated = versions[2]!.migrate!(payload)
      expect(migrated).toEqual(payload)
      expect(versions[2]!.check(migrated)).toBeUndefined()
    }
    for (const trigger of ['schedule', 'subagent', 'handoff']) {
      expect(versions[1]!.check({ trigger })).toEqual(expect.any(String))
      expect(check('run_start', { trigger })).toBeUndefined()
    }
    expect(check('run_start', { trigger: 'schedule', schedule: { scheduleId: 'sc1', occurrence: 1000 } })).toBeUndefined()
    expect(check('run_start', { trigger: 'schedule', schedule: { scheduleId: '', occurrence: 1000 } })).toEqual(expect.any(String))
  })

  it('approval_decision v1 条目迁移为 v2（原样）；v2 接受 by user / hook', () => {
    const versions = definition('approval_decision').versions
    expect(versions).toHaveLength(2)
    const v1 = { requestId: 'q', outcome: 'allowed', scope: 'session' }
    expect(versions[0]!.check(v1)).toBeUndefined()
    expect(versions[0]!.check({ ...v1, by: 'hook' })).toEqual(expect.any(String))
    expect(versions[1]!.migrate!(v1)).toEqual(v1)
    expect(check('approval_decision', v1)).toBeUndefined()
    expect(check('approval_decision', { ...v1, by: 'hook' })).toBeUndefined()
    expect(check('approval_decision', { ...v1, by: 'script' })).toEqual(expect.any(String))
  })

  it.each([
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
  ])('M5 kind %s 的示例 payload 合格，多余字段被拒绝', (kind, payload) => {
    expect(check(kind as string, payload)).toBeUndefined()
    expect(check(kind as string, { ...(payload as object), extra: 1 })).toEqual(expect.any(String))
  })

  it('M5 kind 越界的取值被拒绝', () => {
    expect(check('hook_run', { event: 'SessionStart', hookId: 'h', source: 'global', command: 'c', outcome: 'blocked', durationMs: 0 })).toEqual(
      expect.any(String),
    )
    expect(
      check('hook_run', { event: 'Stop', hookId: 'h', source: 'global', command: 'c', outcome: 'context', durationMs: 0, message: 'x'.repeat(2049) }),
    ).toEqual(expect.any(String))
    expect(check('agent_notification', { agentIds: [] })).toEqual(expect.any(String))
    expect(check('schedule_fire', { scheduleId: 's', occurrence: 1, status: 'skipped', reason: 'sleeping' })).toEqual(expect.any(String))
    expect(
      check('subagent_origin', {
        parentSessionId: 'p',
        parentRunId: 'r',
        toolCallId: 't',
        definition: { name: 'x', source: 'builtin', tools: [], permissionMode: 'plan', maxTurns: 1 },
      }),
    ).toEqual(expect.any(String))
  })

  it('M4 kind 的示例 payload 合格，越界的取值被拒绝', () => {
    const goal = {
      id: 'g1',
      revision: 1,
      objective: 'fix tests',
      criteria: [{ id: 'c1', text: 'tests pass' }],
      budget: { maxRounds: 50 },
      phase: 'running',
      resumedAtRound: 0,
      source: 'model',
    }
    expect(check('goal', goal)).toBeUndefined()
    expect(check('goal', { ...goal, criteria: [] })).toEqual(expect.any(String))
    expect(check('goal', { ...goal, phase: 'sleeping' })).toEqual(expect.any(String))
    expect(check('todo_list', { items: [{ id: 't1', content: 'a', status: 'in_progress', blockedBy: [] }] })).toBeUndefined()
    expect(check('todo_list', { items: [{ id: 't1', content: 'a', status: 'doing' }] })).toEqual(expect.any(String))
    expect(check('plan', { planId: 'p1', revision: 1, markdown: '# Plan', status: 'proposed' })).toBeUndefined()
    expect(
      check('job_start', { jobId: 'j1', kind: 'pty', label: 'npm run dev', command: 'npm run dev', toolCallId: 't', logPath: '/d/jobs/s/j1.log' }),
    ).toBeUndefined()
    expect(check('job_end', { jobId: 'j1', status: 'lost', outputBytes: 0, truncated: false })).toBeUndefined()
    expect(check('job_notification', { jobIds: [] })).toEqual(expect.any(String))
  })

  it('不合 schema 的 payload 给出不含值的原因', () => {
    const secretish = 'sk-should-not-be-echoed-0123456789'
    const reasons = [
      check('run_start', { trigger: secretish }),
      check('run_end', { status: 'completed', extra: secretish }),
      check('message', { role: secretish, content: [] }),
      check('approval_decision', { requestId: 'r', outcome: 'maybe' }),
      check('file_backup', { anchorSeq: 1, path: 'a', blob: 'not-a-hash' }),
      check('permission_mode', { mode: 'god' }),
    ]
    for (const reason of reasons) {
      expect(reason).toEqual(expect.any(String))
      expect(reason).not.toContain(secretish)
    }
    expect(check('run_end', { status: 'interrupted', undeliveredSteering: ['later'] })).toBeUndefined()
    expect(check('file_backup', { anchorSeq: 3, path: 'src/a.ts', absent: true })).toBeUndefined()
    expect(
      check('approval_request', {
        requestId: 'q',
        toolCallId: 't',
        toolName: 'bash',
        kind: 'escalation',
        subject: 'npm i',
        targetMode: 'danger-full-access',
        suggestions: [],
      }),
    ).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace } from '../testing/workspace.ts'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { SESSION_ENTRY_PAYLOADS } from './index.ts'

const definition = (kind: string) => {
  const found = SESSION_ENTRY_PAYLOADS.find((d) => d.kind === kind)
  if (!found) throw new Error(`kind ${kind} is not defined`)
  return found
}
const check = (kind: string, payload: unknown) => definition(kind).versions.at(-1)!.check(payload)

describe('Session Entry payload 定义', () => {
  it('预先定义规格表中全部 M2 kind，每个 kind 只出现一次', () => {
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

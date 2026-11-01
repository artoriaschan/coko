// 追踪、审计与导出的派生（docs/subsystems/tracing.md）：表驱动，条目按提交顺序构造（seq 与 createdAt 由 build 给出）。
import { describe, expect, it } from 'vitest'
import { deriveAudit } from './audit.ts'
import { loadExport } from './export.ts'
import { deriveTrace, traceTotals, type TraceEntry } from './trace.ts'

type Step = [kind: string, payload: unknown, runId: string | null, at: number]

/** 按顺序编号的条目。 */
const build = (steps: Step[]): TraceEntry[] => steps.map(([kind, payload, runId, at], i) => ({ seq: i + 1, kind, payload, runId, createdAt: at }))

const usage = (input: number, output: number, extra: { cacheRead?: number; cacheWrite?: number } = {}) => ({
  input,
  output,
  cacheRead: extra.cacheRead ?? 0,
  cacheWrite: extra.cacheWrite ?? 0,
  total: input + output + (extra.cacheRead ?? 0) + (extra.cacheWrite ?? 0),
})
const request = (runId: string, fields: Record<string, unknown> = {}) => ({
  runId,
  provider: 'faux',
  model: 'faux-1',
  startedAt: 0,
  durationMs: 100,
  usage: usage(10, 5),
  cost: 0.01,
  stopReason: 'stop',
  retries: 0,
  purpose: 'turn',
  ...fields,
})
const start = (trigger = 'submit') => ({ trigger })
const user = (text: string) => ({ role: 'user', content: text })
const callMessage = (...calls: [id: string, name: string][]) => ({
  role: 'assistant',
  content: calls.map(([id, name]) => ({ type: 'toolCall', id, name, arguments: {} })),
  stopReason: 'toolUse',
})
const text = (value: string) => ({ role: 'assistant', content: [{ type: 'text', text: value }], stopReason: 'stop' })
const result = (toolCallId: string, toolName = 'bash', isError = false) => ({ role: 'toolResult', toolCallId, toolName, content: [], isError })
const hook = (event: string, outcome = 'allowed', extra: Record<string, unknown> = {}) => ({
  event,
  hookId: 'global:' + event + ':0:0',
  source: 'global',
  command: 'check.sh',
  outcome,
  durationMs: 7,
  ...extra,
})
const approvalRequest = (requestId: string, toolCallId: string, subject = 'rm -rf build') => ({
  requestId,
  toolCallId,
  toolName: 'bash',
  kind: 'tool',
  subject,
  suggestions: [],
})

describe('deriveTrace', () => {
  const cases: { name: string; steps: Step[]; expected: unknown[] }[] = [
    {
      name: '多轮：每轮一个请求，工具耗时从调用所在的 assistant 消息起算，执行耗时从 tool_exec 起算',
      steps: [
        ['run_start', start(), 'r1', 1000],
        ['message', user('go'), 'r1', 1000],
        ['message', callMessage(['c1', 'bash']), 'r1', 1100],
        ['model_request', request('r1', { durationMs: 100, usage: usage(10, 5) }), 'r1', 1100],
        ['tool_exec', { toolCallId: 'c1', toolName: 'bash', idempotencyKey: 's:c1' }, 'r1', 1150],
        ['message', result('c1'), 'r1', 1300],
        ['message', text('done'), 'r1', 1400],
        ['model_request', request('r1', { durationMs: 90, usage: usage(20, 3, { cacheRead: 4 }), cost: 0.02 }), 'r1', 1400],
        ['run_end', { status: 'completed' }, 'r1', 1450],
      ],
      expected: [
        {
          runId: 'r1',
          trigger: 'submit',
          status: 'completed',
          startedAt: 1000,
          durationMs: 450,
          requests: [expect.objectContaining({ durationMs: 100 }), expect.objectContaining({ durationMs: 90 })],
          tools: [{ toolCallId: 'c1', name: 'bash', startedAt: 1100, durationMs: 200, execMs: 150, isError: false, hooks: [] }],
          hooks: [],
          usage: { input: 30, output: 8, cacheRead: 4, cacheWrite: 0, total: 42 },
          tokens: 42,
          cost: 0.03,
        },
      ],
    },
    {
      name: '重试：请求的 retries 原样保留；错误结束的 Run 带错误码',
      steps: [
        ['run_start', start('retry'), 'r1', 0],
        ['message', { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'overloaded' }, 'r1', 50],
        ['model_request', request('r1', { retries: 2, stopReason: 'error', errorCode: 'model_error', usage: usage(0, 0), cost: undefined }), 'r1', 50],
        ['run_end', { status: 'error', error: { code: 'model_error', message: 'overloaded' } }, 'r1', 60],
      ],
      expected: [
        expect.objectContaining({
          trigger: 'retry',
          status: 'error',
          errorCode: 'model_error',
          requests: [expect.objectContaining({ retries: 2, errorCode: 'model_error' })],
          tokens: 0,
          cost: 0,
        }),
      ],
    },
    {
      name: '压缩与交接的摘要请求计入所在 Run 的用量',
      steps: [
        ['run_start', start('compact'), 'r1', 0],
        ['model_request', request('r1', { purpose: 'compaction', usage: usage(100, 20), cost: 0.1 }), 'r1', 10],
        ['run_end', { status: 'completed' }, 'r1', 20],
        ['run_start', start('handoff'), 'r2', 30],
        ['model_request', request('r2', { purpose: 'summary', usage: usage(50, 10), cost: 0.05 }), 'r2', 40],
        ['run_end', { status: 'completed' }, 'r2', 45],
      ],
      expected: [
        expect.objectContaining({ runId: 'r1', trigger: 'compact', tokens: 120, cost: 0.1, requests: [expect.objectContaining({ purpose: 'compaction' })] }),
        expect.objectContaining({ runId: 'r2', trigger: 'handoff', tokens: 60, cost: 0.05, requests: [expect.objectContaining({ purpose: 'summary' })] }),
      ],
    },
    {
      name: '工具并行：同一批的结果一起提交；多个调用未结束时的工具 Hook 无法归属，记在 Run 上',
      steps: [
        ['run_start', start(), 'r1', 0],
        ['message', callMessage(['c1', 'read'], ['c2', 'bash']), 'r1', 100],
        ['model_request', request('r1'), 'r1', 100],
        ['hook_run', hook('PreToolUse'), 'r1', 110],
        ['hook_run', hook('PreToolUse'), 'r1', 120],
        ['message', result('c1', 'read'), 'r1', 400],
        ['message', result('c2', 'bash', true), 'r1', 401],
        ['run_end', { status: 'completed' }, 'r1', 500],
      ],
      expected: [
        expect.objectContaining({
          tools: [
            { toolCallId: 'c1', name: 'read', startedAt: 100, durationMs: 300, isError: false, hooks: [] },
            { toolCallId: 'c2', name: 'bash', startedAt: 100, durationMs: 301, isError: true, hooks: [] },
          ],
          hooks: [expect.objectContaining({ event: 'PreToolUse' }), expect.objectContaining({ event: 'PreToolUse' })],
        }),
      ],
    },
    {
      name: '审批等待：approval_request 到 approval_decision；工具耗时包含等待；Hook 归属唯一未结束的调用，Stop 记在 Run 上',
      steps: [
        ['run_start', start(), 'r1', 0],
        ['hook_run', hook('UserPromptSubmit', 'context'), 'r1', 5],
        ['message', callMessage(['c1', 'bash']), 'r1', 100],
        ['model_request', request('r1'), 'r1', 100],
        ['hook_run', hook('PreToolUse', 'asked'), 'r1', 120],
        ['approval_request', approvalRequest('a1', 'c1'), 'r1', 200],
        ['approval_decision', { requestId: 'a1', outcome: 'allowed', scope: 'once', by: 'user' }, 'r1', 900],
        ['tool_exec', { toolCallId: 'c1', toolName: 'bash', idempotencyKey: 's:c1' }, 'r1', 910],
        ['hook_run', hook('PostToolUse', 'context'), 'r1', 950],
        ['message', result('c1'), 'r1', 960],
        ['message', text('ok'), 'r1', 1000],
        ['model_request', request('r1'), 'r1', 1000],
        ['hook_run', hook('Stop', 'continued'), 'r1', 1010],
        ['run_end', { status: 'completed' }, 'r1', 1020],
      ],
      expected: [
        expect.objectContaining({
          tools: [
            {
              toolCallId: 'c1',
              name: 'bash',
              startedAt: 100,
              durationMs: 860,
              execMs: 50,
              isError: false,
              approvalWaitMs: 700,
              approval: 'allowed',
              approvalBy: 'user',
              hooks: [
                { event: 'PreToolUse', hookId: 'global:PreToolUse:0:0', source: 'global', outcome: 'asked', durationMs: 7 },
                { event: 'PostToolUse', hookId: 'global:PostToolUse:0:0', source: 'global', outcome: 'context', durationMs: 7 },
              ],
            },
          ],
          hooks: [expect.objectContaining({ event: 'UserPromptSubmit' }), expect.objectContaining({ event: 'Stop', outcome: 'continued' })],
        }),
      ],
    },
    {
      name: '审批的回答者：hook 与 headless；缺省为 user；插件 Hook 带插件名',
      steps: [
        ['run_start', start(), 'r1', 0],
        ['message', callMessage(['c1', 'bash']), 'r1', 10],
        ['hook_run', hook('PermissionRequest', 'allowed', { source: 'plugin', plugin: 'sample' }), 'r1', 15],
        ['approval_request', approvalRequest('a1', 'c1'), 'r1', 20],
        ['approval_decision', { requestId: 'a1', outcome: 'allowed', by: 'hook' }, 'r1', 25],
        ['message', result('c1'), 'r1', 30],
        ['message', callMessage(['c2', 'bash']), 'r1', 40],
        ['approval_request', approvalRequest('a2', 'c2'), 'r1', 50],
        ['approval_decision', { requestId: 'a2', outcome: 'denied', by: 'headless' }, 'r1', 50],
        ['message', result('c2', 'bash', true), 'r1', 51],
        ['message', callMessage(['c3', 'bash']), 'r1', 60],
        ['approval_request', approvalRequest('a3', 'c3'), 'r1', 70],
        ['approval_decision', { requestId: 'a3', outcome: 'denied' }, 'r1', 80],
        ['message', result('c3', 'bash', true), 'r1', 81],
        ['run_end', { status: 'completed' }, 'r1', 90],
      ],
      expected: [
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              toolCallId: 'c1',
              approval: 'allowed',
              approvalBy: 'hook',
              approvalWaitMs: 5,
              hooks: [
                { event: 'PermissionRequest', hookId: 'global:PermissionRequest:0:0', source: 'plugin', plugin: 'sample', outcome: 'allowed', durationMs: 7 },
              ],
            }),
            expect.objectContaining({ toolCallId: 'c2', approval: 'denied', approvalBy: 'headless', approvalWaitMs: 0 }),
            expect.objectContaining({ toolCallId: 'c3', approval: 'denied', approvalBy: 'user', approvalWaitMs: 10 }),
          ],
        }),
      ],
    },
    {
      name: '被中断的 Run 没有 run_end：没有状态与时长；未回答的审批为 pending，未得到结果的工具没有耗时',
      steps: [
        ['run_start', start(), 'r1', 0],
        ['message', callMessage(['c1', 'bash']), 'r1', 100],
        ['model_request', request('r1'), 'r1', 100],
        ['approval_request', approvalRequest('a1', 'c1'), 'r1', 200],
      ],
      expected: [
        {
          runId: 'r1',
          trigger: 'submit',
          startedAt: 0,
          requests: [expect.anything()],
          tools: [{ toolCallId: 'c1', name: 'bash', startedAt: 100, approval: 'pending', hooks: [] }],
          hooks: [],
          usage: usage(10, 5),
          tokens: 15,
          cost: 0.01,
        },
      ],
    },
    {
      name: '没有 run_start 的 runId 与没有 runId 的条目不构成 Run；Run 按开始顺序',
      steps: [
        ['permission_mode', { mode: 'default' }, null, 0],
        ['model_request', request('ghost'), 'ghost', 1],
        ['run_start', start('goal'), 'r2', 10],
        ['run_end', { status: 'paused' }, 'r2', 20],
        ['run_start', start('schedule'), 'r1', 30],
        ['run_end', { status: 'aborted' }, 'r1', 31],
      ],
      expected: [expect.objectContaining({ runId: 'r2', trigger: 'goal', status: 'paused' }), expect.objectContaining({ runId: 'r1', status: 'aborted' })],
    },
  ]
  it.each(cases)('$name', ({ steps, expected }) => {
    expect(deriveTrace(build(steps))).toEqual(expected)
  })

  it('合计：Run、请求、工具调用、Token、费用与已结束 Run 的时长之和', () => {
    // 第二个 Run 复用被中断的用例（toolCallId 与 requestId 在 Session 内唯一，换成新的）。
    const renamed = (p: unknown) => JSON.parse(JSON.stringify(p).replaceAll('"c1"', '"c9"').replaceAll('"a1"', '"a9"').replaceAll('"r1"', '"r9"')) as unknown
    const second = cases[6]!.steps.map(([k, p, , at]): Step => [k, renamed(p), 'r9', at + 5000])
    const runs = deriveTrace(build([...cases[0]!.steps, ...second]))
    expect(traceTotals(runs)).toEqual({ runs: 2, requests: 3, toolCalls: 2, tokens: 57, cost: 0.04, durationMs: 450 })
  })
})

describe('deriveAudit', () => {
  it('每类事件按提交顺序，审批在决定时给出（含请求时刻与回答者），未回答的审批为 pending', () => {
    const steps: Step[] = [
      ['permission_mode', { mode: 'accept-edits' }, null, 1],
      ['permission_rule', { op: 'add', rule: { behavior: 'allow', tool: 'Bash', content: 'npm test' } }, null, 2],
      ['run_start', start(), 'r1', 3],
      ['approval_request', approvalRequest('a1', 'c1', 'npm publish'), 'r1', 4],
      ['hook_run', hook('PermissionRequest', 'asked', { message: 'needs review', exitCode: 0 }), 'r1', 5],
      ['approval_decision', { requestId: 'a1', outcome: 'allowed', scope: 'session' }, 'r1', 6],
      ['approval_request', approvalRequest('a2', 'c2', 'git push'), 'r1', 7],
      ['approval_decision', { requestId: 'a2', outcome: 'denied', by: 'headless' }, 'r1', 8],
      ['confirmation_answer', { toolCallId: 'c0', answer: 'applied' }, null, 9],
      ['schedule_fire', { scheduleId: 's1', occurrence: 100, status: 'started', runId: 'r2' }, null, 10],
      ['schedule_fire', { scheduleId: 's1', occurrence: 200, status: 'skipped', reason: 'budget', missed: 2 }, null, 11],
      ['handoff', { targetSessionId: 't1', instructions: 'secret plan', summary: 'long summary', target: 'worktree' }, 'r3', 12],
      ['handoff_failed', { instructions: 'x', summary: 'y', error: { code: 'worktree-exists', message: 'taken' } }, 'r4', 13],
      ['handoff_origin', { sessionId: 'src', seq: 4 }, null, 14],
      [
        'agent_start',
        { agentId: 'ag1', agentType: 'general', description: 'review', background: true, toolCallId: 'c9', name: 'reviewer', teammate: true },
        'r1',
        15,
      ],
      ['agent_end', { agentId: 'ag1', status: 'dismissed', usage: { turns: 1, toolCalls: 0, tokens: 1, cost: 0, durationMs: 1 }, resultChars: 0 }, null, 16],
      ['approval_request', approvalRequest('a3', 'c3', 'curl'), 'r1', 17],
      ['message', user('not audited'), 'r1', 18],
      ['model_request', request('r1'), 'r1', 19],
    ]
    expect(deriveAudit(build(steps))).toEqual([
      { seq: 1, at: 1, kind: 'permission_mode', mode: 'accept-edits' },
      { seq: 2, at: 2, kind: 'permission_rule', op: 'add', rule: { behavior: 'allow', tool: 'Bash', content: 'npm test' } },
      {
        seq: 5,
        at: 5,
        runId: 'r1',
        kind: 'hook',
        event: 'PermissionRequest',
        hookId: 'global:PermissionRequest:0:0',
        source: 'global',
        outcome: 'asked',
        exitCode: 0,
        durationMs: 7,
        message: 'needs review',
      },
      {
        seq: 6,
        at: 6,
        runId: 'r1',
        kind: 'approval',
        requestId: 'a1',
        toolCallId: 'c1',
        toolName: 'bash',
        approvalKind: 'tool',
        subject: 'npm publish',
        requestedAt: 4,
        outcome: 'allowed',
        by: 'user',
        scope: 'session',
      },
      {
        seq: 8,
        at: 8,
        runId: 'r1',
        kind: 'approval',
        requestId: 'a2',
        toolCallId: 'c2',
        toolName: 'bash',
        approvalKind: 'tool',
        subject: 'git push',
        requestedAt: 7,
        outcome: 'denied',
        by: 'headless',
      },
      { seq: 9, at: 9, kind: 'confirmation', toolCallId: 'c0', answer: 'applied' },
      { seq: 10, at: 10, runId: 'r2', kind: 'schedule_fire', scheduleId: 's1', occurrence: 100, status: 'started' },
      { seq: 11, at: 11, kind: 'schedule_fire', scheduleId: 's1', occurrence: 200, status: 'skipped', reason: 'budget', missed: 2 },
      { seq: 12, at: 12, runId: 'r3', kind: 'handoff', targetSessionId: 't1', target: 'worktree' },
      { seq: 13, at: 13, runId: 'r4', kind: 'handoff_failed', errorCode: 'worktree-exists' },
      { seq: 14, at: 14, kind: 'handoff_origin', sourceSessionId: 'src', sourceSeq: 4 },
      { seq: 15, at: 15, runId: 'r1', kind: 'agent_start', agentId: 'ag1', agentType: 'general', background: true, name: 'reviewer', teammate: true },
      { seq: 16, at: 16, kind: 'agent_end', agentId: 'ag1', status: 'dismissed' },
      {
        seq: 17,
        at: 17,
        runId: 'r1',
        kind: 'approval',
        requestId: 'a3',
        toolCallId: 'c3',
        toolName: 'bash',
        approvalKind: 'tool',
        subject: 'curl',
        requestedAt: 17,
        outcome: 'pending',
      },
    ])
  })

  it('没有审计事件的会话为空', () => {
    expect(
      deriveAudit(
        build([
          ['run_start', start(), 'r1', 0],
          ['message', user('hi'), 'r1', 1],
          ['run_end', { status: 'completed' }, 'r1', 2],
        ]),
      ),
    ).toEqual([])
  })
})

describe('loadExport', () => {
  const header = { type: 'header', format: 'coko-session-export', version: 1, sessionId: 's1', exportedAt: 5 }
  const entry = { sessionId: 's1', seq: 1, kind: 'run_start', payloadVersion: 3, payload: { trigger: 'submit' }, runId: 'r1', createdAt: 1 }
  const child = { ...entry, sessionId: 'child', seq: 1 }

  it('返回 header 之后的条目（含子 Session 的），容忍末尾换行与空行', () => {
    const text = [header, entry, child].map((line) => JSON.stringify(line)).join('\n') + '\n\n'
    expect(loadExport(text)).toEqual([entry, child])
  })

  it.each([
    ['空文本', ''],
    ['第一行不是 header', JSON.stringify(entry)],
    ['格式不符', JSON.stringify({ ...header, format: 'other' })],
    ['版本不符', JSON.stringify({ ...header, version: 2 })],
    ['条目不是 JSON', JSON.stringify(header) + '\n{oops'],
    ['条目缺少字段', JSON.stringify(header) + '\n' + JSON.stringify({ seq: 1, kind: 'x' })],
  ])('%s：抛出', (_name, text) => {
    expect(() => loadExport(text)).toThrow(/session export/)
  })
})

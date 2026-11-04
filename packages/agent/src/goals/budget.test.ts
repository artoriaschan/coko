// Goal 预算（表驱动）：从条目派生五维用量（属于 Goal 的 Run、paused 期间开始的 Run 不计、用户提交的 Run 计入 Token / 费用 / 时间 /
// 工具调用但不计轮次、compaction.usage 计入、进行中的 Run 计到 now）、子 Session 条目的汇总、耗尽的维度与消息、budget-exhausted 恢复的余量检查。
import { describe, expect, it } from 'vitest'
import type { GoalBudget, GoalPayload } from '../session-entries/goals.ts'
import {
  applyGoalChange,
  exhaustedDimension,
  exhaustedMessage,
  GOAL_BUDGET_EXHAUSTED_PREFIX,
  goalChildRuns,
  goalSection,
  goalUsage,
  type BudgetEntry,
  type GoalUsageSnapshot,
} from './index.ts'

const goal = (phase: GoalPayload['phase'], revision: number, budget: GoalBudget = { maxRounds: 50 }): GoalPayload => ({
  id: 'goal-1',
  revision,
  objective: 'fix the tests',
  criteria: [{ id: 'c1', text: 'tests pass' }],
  budget,
  phase,
  resumedAtRound: 0,
  source: 'model',
})

let seq = 0
const at = (createdAt: number, kind: string, payload: unknown, runId?: string): BudgetEntry => ({ seq: ++seq, kind, payload, runId: runId ?? null, createdAt })
const start = (t: number, runId: string, round?: number) =>
  at(t, 'run_start', round ? { trigger: 'goal', goal: { goalId: 'goal-1', round } } : { trigger: 'submit' }, runId)
const end = (t: number, runId: string, status = 'completed') => at(t, 'run_end', { status }, runId)
const usage = (input: number, output: number, cost: number, cache: { cacheRead?: number; cacheWrite?: number } = {}) => ({
  input,
  output,
  cacheRead: cache.cacheRead ?? 0,
  cacheWrite: cache.cacheWrite ?? 0,
  totalTokens: input + output + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0),
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
})
const assistant = (t: number, runId: string, u: ReturnType<typeof usage>) =>
  at(t, 'message', { role: 'assistant', content: [], stopReason: 'stop', usage: u }, runId)
const toolResult = (t: number, runId: string, id: string, text = 'ok', isError = false, details?: unknown) =>
  at(t, 'message', { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text }], isError, ...(details ? { details } : {}) }, runId)
const budgetBlock = { hostBlock: { by: 'goal-budget', dimension: 'tool-calls' } }
const compaction = (t: number, runId: string, u?: ReturnType<typeof usage>) =>
  at(t, 'compaction', { summary: 's', firstKeptSeq: 1, tokensBefore: 10, trigger: 'auto', readFiles: [], modifiedFiles: [], ...(u ? { usage: u } : {}) }, runId)
const goalEntry = (t: number, g: GoalPayload) => at(t, 'goal', g)

/**
 * 一个 Session 的时间线（毫秒）：
 * - r0（submit，0–1000）：没有 Goal 时开始；其中创建 Goal。不计。
 * - r1（Goal Round 1，1000–2000）：一次调用、两次请求、一次带 usage 的自动压缩。
 * - 暂停（2100）；r2（submit，2200–2700）：paused 期间开始，不计。恢复（2800）。
 * - r3（submit，3000–4500）：Goal running 时用户提交，计入 Token / 费用 / 时间 / 工具调用，不计轮次；被拒绝的调用（错误结果）照常计入。
 * - r4（Goal Round 2，5000–）：进行中，一次调用；时间计到 now。
 */
function timeline() {
  seq = 0
  return [
    start(0, 'r0'),
    assistant(100, 'r0', usage(1000, 100, 1)),
    goalEntry(500, goal('running', 1)),
    end(1000, 'r0'),
    start(1000, 'r1', 1),
    assistant(1100, 'r1', usage(200, 20, 0.002, { cacheRead: 50 })),
    toolResult(1200, 'r1', 'b1'),
    compaction(1300, 'r1', usage(300, 30, 0.003)),
    assistant(1400, 'r1', usage(100, 10, 0.001, { cacheWrite: 7 })),
    end(2000, 'r1'),
    goalEntry(2100, goal('paused', 2)),
    start(2200, 'r2'),
    assistant(2300, 'r2', usage(5000, 500, 5)),
    toolResult(2400, 'r2', 'x1'),
    end(2700, 'r2'),
    goalEntry(2800, goal('running', 3)),
    start(3000, 'r3'),
    assistant(3100, 'r3', usage(400, 40, 0.004)),
    toolResult(3200, 'r3', 'b2'),
    toolResult(3300, 'r3', 'b3', 'denied', true),
    end(4500, 'r3'),
    start(5000, 'r4', 2),
    toolResult(5100, 'r4', 'b4'),
  ]
}

describe('预算派生', () => {
  it('actual request attempts take precedence once per Run while legacy and child ownership remain', () => {
    const request = (t: number, run: string, requestId: string, input: number, output: number, cost: number) =>
      at(t, 'model_request', { requestId, purpose: 'turn', usage: { input, output, cacheRead: 0, cacheWrite: 0, total: input + output }, cost }, run)
    const first = request(2, 'modern', 'failed', 11, 3, 0.000017)
    const second = request(3, 'modern', 'retry', 20, 5, 0.00003)
    const entries = [
      goalEntry(0, goal('running', 1)),
      start(1, 'modern', 1),
      first,
      second,
      { ...first, seq: 1000 },
      assistant(4, 'modern', usage(20, 5, 0.00003)),
      compaction(5, 'modern', usage(20, 5, 0.00003)),
      end(11, 'modern'),
      start(12, 'old'),
      assistant(13, 'old', usage(2, 1, 0.1)),
      end(17, 'old'),
    ]
    const child = [start(1, 'child'), request(2, 'child', 'child-request', 7, 1, 0.01), assistant(3, 'child', usage(7, 1, 0.01)), end(5, 'child')]
    expect(goalUsage(entries, 'goal-1', { children: [child] })).toEqual({
      rounds: 1,
      toolCalls: 0,
      tokens: 50,
      cost: expect.closeTo(0.110047, 10),
      durationMs: 19,
    })
  })

  it('五维用量：只计属于 Goal 的 Run；用户提交的 Run 不计轮次；compaction.usage 计入；进行中的 Run 计到 now', () => {
    const u = goalUsage(timeline(), 'goal-1', { now: 5600 })
    // Token：r1 (200+20+50) + 压缩 (300+30) + (100+10+7)，r3 (400+40)，共 1157。费用 0.002 + 0.003 + 0.001 + 0.004。
    // 时间：r1 1000 + r3 1500 + r4（5600 − 5000）600。
    expect(u).toEqual({ rounds: 2, toolCalls: 4, tokens: 1157, cost: expect.closeTo(0.01, 10), durationMs: 3100 })
  })

  it.each([
    [
      '没有 Goal 的条目',
      () => [start(0, 'a'), assistant(1, 'a', usage(10, 1, 1)), end(2, 'a')],
      { rounds: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 },
    ],
    [
      'Goal 终结之后开始的 Run 不计',
      () => [goalEntry(0, goal('running', 1)), goalEntry(1, goal('complete', 2)), start(2, 'a'), assistant(3, 'a', usage(10, 1, 1)), end(4, 'a')],
      { rounds: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 },
    ],
    [
      'waiting-input 与 blocked 期间开始的 Run 计入',
      () => [
        goalEntry(0, goal('waiting-input', 1)),
        start(10, 'a'),
        assistant(11, 'a', usage(10, 1, 0.5)),
        end(20, 'a'),
        goalEntry(21, goal('blocked', 2)),
        start(30, 'b'),
        toolResult(31, 'b', 't1'),
        end(40, 'b'),
      ],
      { rounds: 0, toolCalls: 1, tokens: 11, cost: 0.5, durationMs: 20 },
    ],
    [
      '工具调用上限拦下的错误结果不计为调用',
      () => [
        goalEntry(0, goal('running', 1)),
        start(1, 'a', 1),
        toolResult(2, 'a', 't1'),
        toolResult(3, 'a', 't2', GOAL_BUDGET_EXHAUSTED_PREFIX + 'tool calls (1 / 1)', true, budgetBlock),
        end(4, 'a'),
      ],
      { rounds: 1, toolCalls: 1, tokens: 0, cost: 0, durationMs: 3 },
    ],
    [
      '结果文本伪造拦下的前缀（命令输出）仍计为调用：只认结构化标记',
      () => [
        goalEntry(0, goal('running', 1)),
        start(1, 'a', 1),
        toolResult(2, 'a', 't1', GOAL_BUDGET_EXHAUSTED_PREFIX + 'tool calls (1 / 1)\n\n[exit code: 1]', true),
        end(3, 'a'),
      ],
      { rounds: 1, toolCalls: 1, tokens: 0, cost: 0, durationMs: 2 },
    ],
    [
      '没有 usage 的压缩（v1 迁移而来）与没有 usage 的消息记 0',
      () => [
        goalEntry(0, goal('running', 1)),
        start(1, 'a', 1),
        compaction(2, 'a'),
        at(3, 'message', { role: 'assistant', content: [], stopReason: 'stop' }, 'a'),
        end(4, 'a'),
      ],
      { rounds: 1, toolCalls: 0, tokens: 0, cost: 0, durationMs: 3 },
    ],
  ])('%s', (_name, entries, expected) => {
    expect(goalUsage(entries(), 'goal-1', { now: 100 })).toEqual(expected)
  })

  it('汇总函数接受子 Session 的条目：子 Session 的全部 Run 计入 Token、费用、时间与工具调用，不计轮次', () => {
    seq = 0
    const child = [start(0, 'c1'), assistant(10, 'c1', usage(100, 10, 0.1)), toolResult(20, 'c1', 'k1'), end(500, 'c1'), start(600, 'c2'), end(700, 'c2')]
    const parent = [goalEntry(0, goal('running', 1)), start(1000, 'p1', 1), toolResult(1100, 'p1', 'p'), end(2000, 'p1')]
    expect(goalUsage(parent, 'goal-1', { now: 3000, children: [child] })).toEqual({ rounds: 1, toolCalls: 2, tokens: 110, cost: 0.1, durationMs: 1600 })
  })

  it('handoff 条目的 usage 计入同一 Run（属于该 Goal 时），与 compaction 相同；不属于 Goal 的 Run 不计', () => {
    seq = 0
    const handoff = (t: number, runId: string, u?: ReturnType<typeof usage>) =>
      at(t, 'handoff', { targetSessionId: 's2', instructions: 'next', summary: 's', target: 'current', ...(u ? { usage: u } : {}) }, runId)
    const entries = [
      at(0, 'run_start', { trigger: 'handoff' }, 'h0'),
      at(10, 'run_end', { status: 'completed' }, 'h0'),
      handoff(11, 'h0', usage(500, 50, 0.5)),
      goalEntry(100, goal('running', 1)),
      at(200, 'run_start', { trigger: 'handoff' }, 'h1'),
      at(300, 'run_end', { status: 'completed' }, 'h1'),
      handoff(301, 'h1', usage(40, 5, 0.04, { cacheRead: 5 })),
      handoff(302, 'h1'),
    ]
    expect(goalUsage(entries, 'goal-1', { now: 400 })).toEqual({ rounds: 0, toolCalls: 0, tokens: 50, cost: 0.04, durationMs: 100 })
  })
})

describe('耗尽的维度', () => {
  const used: GoalUsageSnapshot = { rounds: 3, toolCalls: 10, tokens: 5000, cost: 0.25, durationMs: 60_000 }
  it.each([
    [{ maxRounds: 3 }, 'rounds', 'Goal budget exhausted: rounds (3 / 3)'],
    [{ maxToolCalls: 10 }, 'tool-calls', 'Goal budget exhausted: tool calls (10 / 10)'],
    [{ maxTokens: 4000 }, 'tokens', 'Goal budget exhausted: tokens (5000 / 4000)'],
    [{ maxCost: 0.25 }, 'cost', 'Goal budget exhausted: cost (0.25 / 0.25)'],
    [{ maxDurationMs: 30_000 }, 'time', 'Goal budget exhausted: time (60000 ms / 30000 ms)'],
  ] as const)('%o → %s', (budget, dimension, message) => {
    expect(exhaustedDimension(budget, used)).toBe(dimension)
    expect(exhaustedMessage(dimension, budget, used)).toBe(message)
  })

  it('有余量、未设或只检查给定维度时为 undefined；多维同时耗尽时按 rounds、tool-calls、tokens、cost、time 的顺序', () => {
    expect(exhaustedDimension({ maxRounds: 4, maxToolCalls: 11, maxTokens: 5001, maxCost: 0.3, maxDurationMs: 60_001 }, used)).toBeUndefined()
    expect(exhaustedDimension({}, used)).toBeUndefined()
    expect(exhaustedDimension({ maxToolCalls: 10, maxTokens: 10 }, used)).toBe('tool-calls')
    expect(exhaustedDimension({ maxToolCalls: 10, maxTokens: 10 }, used, ['tokens', 'cost', 'time'])).toBe('tokens')
    expect(exhaustedDimension({ maxToolCalls: 10 }, used, ['tokens', 'cost', 'time'])).toBeUndefined()
    // 只有轮次的用量：其余维度未派生时不判定。
    expect(exhaustedDimension({ maxTokens: 1 }, { rounds: 3 })).toBeUndefined()
  })

  it('budget-exhausted 恢复须使耗尽的维度有余量（按完整用量判定）', () => {
    const exhausted = { ...goal('budget-exhausted', 4, { maxRounds: 50, maxTokens: 4000 }), reason: { code: 'tokens', message: 'm' } }
    expect(() => applyGoalChange(exhausted, { type: 'resume' }, 'user', used)).toThrow(/Raise the tokens budget before resuming/)
    const raised = applyGoalChange(exhausted, { type: 'edit', budget: { maxRounds: 50, maxTokens: 6000 } }, 'user', used)
    expect(applyGoalChange(raised, { type: 'resume' }, 'user', used)).toMatchObject({ phase: 'running', resumedAtRound: 3 })
  })

  it('<goal> 列出已设维度的用量 / 上限', () => {
    const text = goalSection(goal('running', 1, { maxRounds: 5, maxToolCalls: 20, maxTokens: 9000, maxCost: 1.5, maxDurationMs: 120_000 }), used)?.text
    expect(text).toContain('- rounds: 3 / 5')
    expect(text).toContain('- tool calls: 10 / 20')
    expect(text).toContain('- tokens: 5000 / 9000')
    expect(text).toContain('- cost: 0.25 / 1.5')
    expect(text).toContain('- time: 60000 ms / 120000 ms')
  })
})

describe('子 Session 的 Run 按触发 Run 归属（ADR 0018）', () => {
  // 根：r0 没有 Goal（之前派发 teammate），之后创建 Goal，r2 为 Goal Round。
  const g = goal('running', 1)
  const root = [
    start(0, 'r0'),
    at(
      1,
      'agent_start',
      { agentId: 'tm', agentType: 'general', description: '', background: true, toolCallId: 'c', name: 'tm', teammate: true, triggerRunId: 'r0' },
      'r0',
    ),
    end(2, 'r0'),
    goalEntry(3, g),
    start(4, 'r2', 1),
  ]
  const child = [
    at(1, 'run_start', { trigger: 'subagent', subagent: { triggerRunId: 'r0' } }, 'c0'),
    assistant(2, 'c0', usage(500, 0, 0)),
    end(2, 'c0'),
    at(5, 'run_start', { trigger: 'subagent', subagent: { triggerRunId: 'r2' } }, 'c1'),
    assistant(6, 'c1', usage(70, 0, 0)),
    end(6, 'c1'),
  ]
  it('没有 Goal 的根 Run 触发的 Run 不计入之后创建的 Goal；Goal Round 触发的计入', () => {
    const runs = goalChildRuns(root, 'tm', child, g.id)
    expect([...runs]).toEqual(['c1'])
    expect(goalUsage(root, g.id, { now: 10, children: [{ entries: child, runs }] }).tokens).toBe(70)
  })
  it('没有 triggerRunId 的旧条目：派发它的 agent_start 属于 Goal 时全部计入，否则不计', () => {
    const legacyChild = child.map((e) => (e.kind === 'run_start' ? { ...e, payload: { trigger: 'subagent' } } : e))
    expect(goalChildRuns(root, 'tm', legacyChild, g.id).size).toBe(0)
    const inGoal = root.map((e) => (e.kind === 'agent_start' ? { ...e, runId: 'r2' } : e))
    expect([...goalChildRuns(inGoal, 'tm', legacyChild, g.id)]).toEqual(['c0', 'c1'])
  })
})

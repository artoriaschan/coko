// Goal 状态机（表驱动）：规格转换表的每一行与非法组合、授权规则（Goal Round 中的 create / edit / pause / resume）、blocked 的 3 轮阈值、
// 完成证据、revision 过期、Run 授权的判定与 <goal> / <goal_round> 文本。
import { describe, expect, it } from 'vitest'
import type { EntryLike } from '../entries/types.ts'
import type { GoalPayload, GoalPhase } from '../session-entries/goals.ts'
import {
  applyGoalChange,
  createGoalSnapshot,
  currentGoal,
  GOAL_TRANSITIONS,
  GoalError,
  goalRounds,
  goalRoundText,
  goalSection,
  goalView,
  nextGoalId,
  planGoalCreate,
  planGoalUpdate,
  runAuthority,
  validateEvidence,
  type GoalChange,
  type GoalUpdateContext,
  type RunAuthority,
  type UpdateGoalArgs,
} from './index.ts'

const PHASES: GoalPhase[] = ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted', 'complete', 'cancelled']

const goal = (extra: Partial<GoalPayload> = {}): GoalPayload => ({
  id: 'goal-1',
  revision: 3,
  objective: 'fix the tests',
  criteria: [
    { id: 'c1', text: 'tests pass' },
    { id: 'c2', text: 'lint passes' },
  ],
  budget: { maxRounds: 50 },
  phase: 'running',
  resumedAtRound: 0,
  source: 'model',
  ...extra,
})

let seq = 0
const e = (kind: string, payload: unknown, runId?: string): EntryLike => ({ seq: ++seq, kind, payload, ...(runId ? { runId } : {}) })
const toolResult = (toolCallId: string, isError = false) => e('message', { role: 'toolResult', toolCallId, toolName: 'bash', content: [], isError })
const user = (text: string) => e('message', { role: 'user', content: text })

const r = (code: string) => ({ code, message: code })
const SAMPLE: Record<GoalChange['type'], GoalChange> = {
  pause: { type: 'pause', reason: r('user-paused') },
  resume: { type: 'resume' },
  edit: { type: 'edit', objective: 'fix all tests' },
  complete: { type: 'complete', by: 'user' },
  cancel: { type: 'cancel', cleanup: { runsAborted: 0, jobsKilled: 0, failures: [] } },
  block: { type: 'block', reason: r('model-blocked') },
  'wait-input': { type: 'wait-input', reason: r('needs-input') },
  'wait-jobs': { type: 'wait-jobs', jobIds: ['job_1'], reason: r('waiting-jobs') },
  wake: { type: 'wake' },
  fail: { type: 'fail', reason: r('model_error') },
  exhaust: { type: 'exhaust', reason: r('rounds') },
}
/** 规格转换表：变化 → 允许的出发阶段 → 目标阶段。 */
const EXPECTED: Record<GoalChange['type'], { from: GoalPhase[]; to: GoalPhase | 'same' }> = {
  pause: { from: ['running', 'waiting-input', 'waiting-external'], to: 'paused' },
  resume: { from: ['paused', 'blocked', 'failed', 'budget-exhausted'], to: 'running' },
  edit: { from: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'], to: 'same' },
  complete: { from: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'], to: 'complete' },
  cancel: { from: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'], to: 'cancelled' },
  block: { from: ['running'], to: 'blocked' },
  'wait-input': { from: ['running'], to: 'waiting-input' },
  'wait-jobs': { from: ['running'], to: 'waiting-external' },
  wake: { from: ['waiting-input', 'waiting-external'], to: 'running' },
  fail: { from: ['running'], to: 'failed' },
  exhaust: { from: ['running'], to: 'budget-exhausted' },
}

describe('转换表', () => {
  const rows = (Object.keys(SAMPLE) as GoalChange['type'][]).flatMap((type) => PHASES.map((phase) => [type, phase] as const))
  const before = (phase: GoalPhase) => goal({ phase, ...(phase === 'budget-exhausted' ? { budget: { maxRounds: 10 } } : {}) })
  it.each(rows.filter(([type, phase]) => !EXPECTED[type].from.includes(phase)))('%s 从 %s：invalid-transition', (type, phase) => {
    expect(() => applyGoalChange(before(phase), SAMPLE[type], 'user', 0)).toThrow(expect.objectContaining({ code: 'invalid-transition' }))
  })
  it.each(rows.filter(([type, phase]) => EXPECTED[type].from.includes(phase)))('%s 从 %s', (type, phase) => {
    const next = applyGoalChange(before(phase), SAMPLE[type], 'user', 2)
    expect(next.revision).toBe(4)
    expect(next.source).toBe('user')
    expect(next.phase).toBe(EXPECTED[type].to === 'same' ? phase : EXPECTED[type].to)
  })

  it('表与规格一致（未列出的组合都是非法转换）', () => {
    for (const type of Object.keys(EXPECTED) as GoalChange['type'][]) expect([...GOAL_TRANSITIONS[type]].sort()).toEqual([...EXPECTED[type].from].sort())
  })

  it('进入 running 清除 reason 与 waitingFor；resume 与 edit 把 resumedAtRound 设为当前轮次；wait-jobs 记下 jobIds', () => {
    const waiting = applyGoalChange(goal(), SAMPLE['wait-jobs'], 'model', 4)
    expect(waiting).toMatchObject({ phase: 'waiting-external', waitingFor: { jobIds: ['job_1'] }, reason: { code: 'waiting-jobs' } })
    const woken = applyGoalChange(waiting, { type: 'wake' }, 'system', 4)
    expect(woken).not.toHaveProperty('reason')
    expect(woken).not.toHaveProperty('waitingFor')
    expect(applyGoalChange(goal({ phase: 'paused', reason: r('user-paused') }), { type: 'resume' }, 'user', 7)).toMatchObject({
      phase: 'running',
      resumedAtRound: 7,
    })
    expect(applyGoalChange(goal({ phase: 'paused', reason: r('user-paused') }), SAMPLE.edit, 'user', 5)).toMatchObject({
      phase: 'paused',
      reason: { code: 'user-paused' },
      objective: 'fix all tests',
      resumedAtRound: 5,
    })
  })

  it('budget-exhausted（rounds）须先调高轮次上限才能恢复', () => {
    const exhausted = goal({ phase: 'budget-exhausted', budget: { maxRounds: 3 }, reason: r('rounds') })
    expect(() => applyGoalChange(exhausted, { type: 'resume' }, 'user', 3)).toThrow(expect.objectContaining({ code: 'invalid-transition' }))
    const raised = applyGoalChange(exhausted, { type: 'edit', budget: { maxRounds: 5 } }, 'user', 3)
    expect(raised.phase).toBe('budget-exhausted')
    expect(applyGoalChange(raised, { type: 'resume' }, 'user', 3)).toMatchObject({ phase: 'running', revision: 5 })
  })

  it('cancel 带 cleanup；complete 记 completedBy 与证据', () => {
    const cleanup = { runsAborted: 1, jobsKilled: 2, failures: ['x'] }
    expect(applyGoalChange(goal(), { type: 'cancel', cleanup }, 'user', 0)).toMatchObject({ phase: 'cancelled', cleanup })
    expect(applyGoalChange(goal({ phase: 'paused' }), { type: 'complete', by: 'user' }, 'user', 0)).toMatchObject({ phase: 'complete', completedBy: 'user' })
  })
})

describe('创建', () => {
  it('第一份快照：running、revision 1、条件 c1…、缺省 maxRounds 50；id 按 Session 内顺序', () => {
    const created = createGoalSnapshot([], { objective: '  ship it ', criteria: [' a ', 'b'] }, 'model')
    expect(created).toEqual({
      id: 'goal-1',
      revision: 1,
      objective: 'ship it',
      criteria: [
        { id: 'c1', text: 'a' },
        { id: 'c2', text: 'b' },
      ],
      budget: { maxRounds: 50 },
      phase: 'running',
      resumedAtRound: 0,
      source: 'model',
    })
    expect(nextGoalId([e('goal', goal({ phase: 'complete' }))])).toBe('goal-2')
  })

  it.each([
    ['没有条件', { objective: 'o', criteria: [] }],
    ['11 条条件', { objective: 'o', criteria: Array.from({ length: 11 }, (_, i) => 'c' + i) }],
    ['空条件', { objective: 'o', criteria: ['  '] }],
    ['重复条件', { objective: 'o', criteria: ['a', 'a'] }],
    ['空目标', { objective: ' ', criteria: ['a'] }],
    ['非正的预算', { objective: 'o', criteria: ['a'], budget: { maxRounds: 0 } }],
  ])('%s：invalid-argument', (_name, input) => {
    expect(() => createGoalSnapshot([], input, 'model')).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
  })

  it('已有未终结的 Goal 时 already-exists；终结后可以再建', () => {
    expect(() => createGoalSnapshot([e('goal', goal({ phase: 'paused' }))], { objective: 'o', criteria: ['a'] }, 'model')).toThrow(
      expect.objectContaining({ code: 'already-exists' }),
    )
    expect(createGoalSnapshot([e('goal', goal({ phase: 'cancelled' }))], { objective: 'o', criteria: ['a'] }, 'model').id).toBe('goal-2')
  })
})

describe('完成证据', () => {
  const entries = [toolResult('ok1'), toolResult('bad1', true)]
  const full = [
    { criterionId: 'c2', text: ' lint clean ', toolCallIds: ['ok1', 'ok1'] },
    { criterionId: 'c1', text: 'all green', toolCallIds: [] },
  ]
  it('覆盖每条条件：按条件顺序返回，去掉空白与重复 id', () => {
    expect(validateEvidence(goal(), full, entries)).toEqual([
      { criterionId: 'c1', text: 'all green' },
      { criterionId: 'c2', text: 'lint clean', toolCallIds: ['ok1'] },
    ])
  })
  it.each([
    ['没有证据', undefined, /needs evidence/],
    ['缺一条条件', [full[0]!], /Missing evidence for criterion c1/],
    ['空文本', [full[0]!, { criterionId: 'c1', text: '   ' }], /c1 is empty/],
    ['未知条件', [...full, { criterionId: 'c9', text: 'x' }], /unknown criterion c9/],
    ['重复条件', [...full, { criterionId: 'c1', text: 'x' }], /Duplicate evidence/],
    ['引用不存在的调用', [full[0]!, { criterionId: 'c1', text: 'x', toolCallIds: ['nope'] }], /nope, which has no successful result/],
    ['引用出错的调用', [full[0]!, { criterionId: 'c1', text: 'x', toolCallIds: ['bad1'] }], /bad1, which has no successful result/],
  ])('%s：invalid-argument', (_name, evidence, message) => {
    expect(() => validateEvidence(goal(), evidence as never, entries)).toThrow(message)
    expect(() => validateEvidence(goal(), evidence as never, entries)).toThrow(GoalError)
  })
})

describe('update_goal 的授权与 revision', () => {
  const USER: RunAuthority = { kind: 'user' }
  const ROUND = (round: number, goalId = 'goal-1'): RunAuthority => ({ kind: 'goal-round', goalId, round })
  const NONE: RunAuthority = { kind: 'none' }
  const ctx = (authority: RunAuthority, extra: Partial<GoalUpdateContext> = {}): GoalUpdateContext => ({
    entries: [toolResult('ok1')],
    authority,
    rounds: 4,
    jobRunning: (id) => id === 'job_run',
    ...extra,
  })
  const args = (action: UpdateGoalArgs['action'], extra: Partial<UpdateGoalArgs> = {}): UpdateGoalArgs => ({ goal_id: 'goal-1', revision: 3, action, ...extra })
  const evidence = [
    { criterion_id: 'c1', text: 'green', tool_call_ids: ['ok1'] },
    { criterion_id: 'c2', text: 'clean' },
  ]
  const ACTIONS: [UpdateGoalArgs['action'], Partial<UpdateGoalArgs>, Partial<GoalPayload>][] = [
    ['edit', { objective: 'x' }, {}],
    ['pause', {}, {}],
    ['resume', {}, { phase: 'paused' }],
    ['complete', { evidence }, {}],
    ['blocked', { reason: 'no access' }, {}],
    ['wait_input', { reason: 'which db?' }, {}],
    ['wait_jobs', { job_ids: ['job_run'] }, {}],
  ]
  /** 期望：user / 本 Goal 的第 4 轮（resumedAtRound 0）/ 其他 Goal 的轮 / none。 */
  const ALLOWED: Record<UpdateGoalArgs['action'], [boolean, boolean, boolean, boolean]> = {
    edit: [true, false, false, false],
    pause: [true, false, false, false],
    resume: [true, false, false, false],
    complete: [true, true, false, false],
    blocked: [true, true, false, false],
    wait_input: [true, true, false, false],
    wait_jobs: [true, true, false, false],
  }
  const AUTHORITIES: [string, RunAuthority][] = [
    ['user', USER],
    ['goal-round', ROUND(4)],
    ['其他 Goal 的轮', ROUND(4, 'goal-0')],
    ['none', NONE],
  ]
  const rows = ACTIONS.flatMap(([action, extra, state]) =>
    AUTHORITIES.map(([name, authority], i) => [action, name, authority, extra, state, ALLOWED[action][i]!] as const),
  )
  it.each(rows.filter((row) => row[5]))('%s 在 %s 的 Run 中：接受', (action, _name, authority, extra, state) => {
    expect(planGoalUpdate(goal(state), args(action, extra), ctx(authority)).revision).toBe(4)
  })
  it.each(rows.filter((row) => !row[5]))('%s 在 %s 的 Run 中：not-authorized', (action, _name, authority, extra, state) => {
    expect(() => planGoalUpdate(goal(state), args(action, extra), ctx(authority))).toThrow(expect.objectContaining({ code: 'not-authorized' }))
  })

  it('Goal Round 中 blocked 须自 resumedAtRound 起至少 3 轮；用户的 Run 不受限；须有 reason', () => {
    const blocked = args('blocked', { reason: 'no credentials' })
    expect(() => planGoalUpdate(goal({ resumedAtRound: 2 }), blocked, ctx(ROUND(4)))).toThrow(/at least 3 goal rounds/)
    expect(planGoalUpdate(goal({ resumedAtRound: 2 }), blocked, ctx(ROUND(5)))).toMatchObject({ phase: 'blocked', reason: { message: 'no credentials' } })
    expect(planGoalUpdate(goal({ resumedAtRound: 2 }), blocked, ctx(USER)).phase).toBe('blocked')
    expect(() => planGoalUpdate(goal(), args('blocked'), ctx(USER))).toThrow(/needs a reason/)
  })

  it('revision 过期：revision-conflict 带当前 revision；goal_id 不是当前 Goal：not-found', () => {
    const conflict = (() => {
      try {
        planGoalUpdate(goal(), args('pause', { revision: 2 }), ctx(USER))
      } catch (error) {
        return error as GoalError
      }
    })()
    expect(conflict).toMatchObject({ code: 'revision-conflict', details: { expected: 2, actual: 3 } })
    expect(conflict?.message).toContain('revision 3')
    expect(() => planGoalUpdate(goal(), args('pause', { goal_id: 'goal-9' }), ctx(USER))).toThrow(expect.objectContaining({ code: 'not-found' }))
    expect(() => planGoalUpdate(undefined, args('pause'), ctx(USER))).toThrow(expect.objectContaining({ code: 'not-found' }))
  })

  it('wait_jobs 只接受本 Session running 的 Job；complete 的证据照常校验', () => {
    expect(() => planGoalUpdate(goal(), args('wait_jobs', { job_ids: ['job_done'] }), ctx(USER))).toThrow(/job_done is not running/)
    expect(() => planGoalUpdate(goal(), args('wait_jobs'), ctx(USER))).toThrow(/needs job_ids/)
    expect(() => planGoalUpdate(goal(), args('complete', { evidence: [evidence[0]!] }), ctx(ROUND(4)))).toThrow(/Missing evidence for criterion c2/)
    expect(planGoalUpdate(goal(), args('complete', { evidence }), ctx(ROUND(4)))).toMatchObject({ phase: 'complete', completedBy: 'model', source: 'model' })
  })

  it('create_goal 只在用户授权的 Run 中接受（Goal Round 与 continue 被拒）', () => {
    const input = { objective: 'o', criteria: ['a'] }
    expect(planGoalCreate(input, { entries: [], authority: USER })).toMatchObject({ id: 'goal-1', phase: 'running', source: 'model' })
    for (const authority of [ROUND(1), NONE])
      expect(() => planGoalCreate(input, { entries: [], authority })).toThrow(expect.objectContaining({ code: 'not-authorized' }))
    expect(planGoalCreate({ ...input, budget: { max_rounds: 3, max_cost: 1.5 } }, { entries: [], authority: USER }).budget).toEqual({
      maxRounds: 3,
      maxCost: 1.5,
    })
  })
})

describe('Run 的授权（runAuthority）', () => {
  const start = (trigger: string, goalRef?: { goalId: string; round: number }) => e('run_start', goalRef ? { trigger, goal: goalRef } : { trigger })
  it.each([
    ['submit', [start('submit'), user('hi')], { kind: 'user' }],
    ['Goal Round', [start('goal', { goalId: 'goal-1', round: 2 }), user('<goal_round>')], { kind: 'goal-round', goalId: 'goal-1', round: 2 }],
    ['Goal Round 中送达了用户的追加指令', [start('goal', { goalId: 'goal-1', round: 2 }), user('<goal_round>'), user('also lint')], { kind: 'user' }],
    [
      'Goal Round 中只送达了 Job 通知',
      [start('goal', { goalId: 'goal-1', round: 2 }), user('<goal_round>'), e('job_notification', { jobIds: ['j'] }), user('<job-notification>')],
      { kind: 'goal-round', goalId: 'goal-1', round: 2 },
    ],
    ['continue', [start('continue')], { kind: 'none' }],
    ['continue 中送达了追加指令', [start('continue'), user('go on')], { kind: 'user' }],
    ['没有进行中的 Run', [start('submit'), user('hi'), e('run_end', { status: 'completed' })], { kind: 'none' }],
  ])('%s', (_name, entries, expected) => {
    expect(runAuthority(entries)).toEqual(expected)
  })
})

describe('派生与文本', () => {
  it('轮次为该 Goal 的 run_start 中最大的 round；当前 Goal 为最新的 goal 条目', () => {
    const entries = [
      e('goal', goal({ revision: 1 })),
      e('run_start', { trigger: 'goal', goal: { goalId: 'goal-1', round: 1 } }),
      e('run_start', { trigger: 'submit' }),
      e('run_start', { trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } }),
      e('run_start', { trigger: 'goal', goal: { goalId: 'goal-0', round: 9 } }),
      e('goal', goal({ revision: 2, phase: 'paused' })),
    ]
    expect(goalRounds(entries, 'goal-1')).toBe(2)
    expect(currentGoal(entries)).toMatchObject({ revision: 2, phase: 'paused' })
    expect(currentGoal([])).toBeUndefined()
  })

  it('<goal> 在未终结时注入（目标、条件、阶段与原因、轮次 / 上限），终结后不注入', () => {
    const section = goalSection(goal({ phase: 'paused', reason: { code: 'user-paused', message: 'Paused by the user' }, constraints: 'no new deps' }), {
      rounds: 2,
    })
    expect(section?.name).toBe('goal')
    expect(section?.text).toMatch(/^<goal>\n/)
    expect(section?.text).toContain('Objective: "fix the tests"')
    expect(section?.text).toContain('Constraints: "no new deps"')
    expect(section?.text).toContain('- c2: lint passes')
    expect(section?.text).toContain('phase paused (user-paused: Paused by the user)')
    expect(section?.text).toContain('- rounds: 2 / 50')
    for (const phase of ['complete', 'cancelled'] as const) expect(goalSection(goal({ phase }), { rounds: 2 })).toBeUndefined()
    expect(goalSection(undefined, { rounds: 0 })).toBeUndefined()
  })

  it('<goal_round>：目标 JSON 字符串、条件、第 n / 上限 轮与"以当前状态为准"', () => {
    const text = goalRoundText(goal({ objective: 'say "hi"' }), 3)
    expect(text.split('\n').slice(0, 5)).toEqual(['<goal_round>', 'Objective: "say \\"hi\\""', 'Success criteria:', '- c1: tests pass', '- c2: lint passes'])
    expect(text).toContain('Round: 3 / 50')
    expect(text).toContain('Treat the current workspace, tool results and committed session state as authoritative')
    expect(text).toMatch(/<\/goal_round>$/)
  })

  it('工具结果视图', () => {
    expect(goalView(undefined, 0)).toEqual({ goal: null })
    expect(goalView(goal(), 2).goal).toMatchObject({ id: 'goal-1', revision: 3, round: 2, maxRounds: 50, phase: 'running' })
  })
})

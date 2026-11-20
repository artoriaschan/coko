// Plan Mode 的 agent 部分：条目派生（planId 与 revision、压缩后的再注入）、system section 文本与计划校验，以及经 createAgentRuntime 的
// 审阅闭环（proposed → kind plan 的审批 → 批准执行 / 带反馈继续规划 / 无反馈拒绝停止；参数错误不提交也不询问），以及 complete_plan 的
// 判定（四种模式都不询问，拒绝与询问规则照常）、参数校验与结果文本。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { activePlanOf, planPhaseOf } from '../entries/index.ts'
import type { EntryLike } from '../entries/types.ts'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import {
  APPROVED_PLAN_MAX_CHARS,
  approvedPlanSection,
  approvedPlanToReinject,
  COMPLETE_PLAN_TOOL,
  createCompletePlanTool,
  createExitPlanModeTool,
  NO_PLAN_IN_PROGRESS_TEXT,
  latestPlan,
  nextPlanRef,
  planMarkdownProblem,
  planTitle,
  type PlanReview,
} from './index.ts'

let seq = 0
const entry = (kind: string, payload: unknown): EntryLike => ({ seq: ++seq, kind, payload })
const plan = (planId: string, revision: number, status: string, markdown = '# P') => entry('plan', { planId, revision, markdown, status })
const mode = (m: string) => entry('permission_mode', { mode: m })
const phase = (p: string, planId?: string) => entry('plan_phase', planId ? { phase: p, planId } : { phase: p })
beforeEach(() => {
  seq = 0
})

describe('nextPlanRef', () => {
  const id = () => 'new'
  it.each<[string, () => EntryLike[], { planId: string; revision: number }]>([
    ['还没有计划：新 planId，revision 1', () => [mode('default'), phase('planning')], { planId: 'new', revision: 1 }],
    ['本次规划已有 proposed：沿用并加一', () => [phase('planning'), plan('p1', 1, 'proposed')], { planId: 'p1', revision: 2 }],
    ['被拒绝后再次提交：沿用并加一', () => [phase('planning'), plan('p1', 1, 'proposed'), plan('p1', 1, 'rejected')], { planId: 'p1', revision: 2 }],
    ['上一份已批准：新 planId', () => [phase('planning'), plan('p1', 2, 'approved'), phase('none')], { planId: 'new', revision: 1 }],
    ['上一份已完成：新 planId', () => [plan('p1', 2, 'approved'), plan('p1', 2, 'completed')], { planId: 'new', revision: 1 }],
    ['上一份已放弃：新 planId', () => [plan('p1', 2, 'approved'), plan('p1', 2, 'abandoned')], { planId: 'new', revision: 1 }],
    ['退出后重新进入规划：新 planId', () => [phase('planning'), plan('p1', 1, 'proposed'), phase('none'), phase('planning')], { planId: 'new', revision: 1 }],
    [
      '起点是计划阶段：规划中切换模式（permission_mode）不截断',
      () => [phase('planning'), plan('p1', 1, 'proposed'), mode('read-only')],
      { planId: 'p1', revision: 2 },
    ],
  ])('%s', (_name, build, expected) => {
    expect(nextPlanRef(build(), id)).toEqual(expected)
  })

  it('被回退的区间不算', () => {
    const entries = [phase('planning'), plan('p1', 1, 'proposed')]
    entries.push(entry('rewind', { targetSeq: 2 }))
    expect(nextPlanRef(entries, id)).toEqual({ planId: 'new', revision: 1 })
  })
})

describe('planPhaseOf 与 activePlanOf', () => {
  it('没有阶段条目时为 none（含只有 permission_mode 的旧 Session），否则为有效条目中最后一条', () => {
    expect(planPhaseOf([mode('default')])).toEqual({ phase: 'none' })
    expect(planPhaseOf([phase('planning'), phase('none'), phase('executing', 'p1')])).toEqual({ phase: 'executing', planId: 'p1' })
    const entries = [phase('planning'), entry('message', {}), phase('none')]
    entries.push(entry('rewind', { targetSeq: entries[1]!.seq }))
    expect(planPhaseOf(entries)).toEqual({ phase: 'planning' })
  })

  it('规划中：本次规划最后一条 plan 为 proposed 时返回它，否则 undefined', () => {
    expect(activePlanOf([phase('planning'), plan('p1', 1, 'proposed', '# A')])).toEqual({ planId: 'p1', revision: 1, markdown: '# A', status: 'proposed' })
    expect(activePlanOf([phase('planning'), plan('p1', 1, 'proposed'), plan('p1', 1, 'rejected')])).toBeUndefined()
    expect(activePlanOf([plan('p1', 1, 'proposed'), phase('planning')])).toBeUndefined()
    expect(activePlanOf([phase('planning')])).toBeUndefined()
  })

  it('执行中：阶段 planId 的最后一条 plan；无：undefined', () => {
    const entries = [phase('planning'), plan('p1', 1, 'proposed'), plan('p1', 2, 'approved', '# B'), plan('p2', 1, 'proposed'), phase('executing', 'p1')]
    expect(activePlanOf(entries)).toMatchObject({ planId: 'p1', revision: 2, status: 'approved', markdown: '# B' })
    expect(activePlanOf([phase('planning'), plan('p1', 1, 'proposed'), phase('none')])).toBeUndefined()
  })
})

describe('approvedPlanToReinject', () => {
  it('执行中：该 planId 最新的已批准条目早于最后一个 compaction 的 firstKeptSeq 时返回其正文（不看其他计划）', () => {
    const entries = [plan('p1', 1, 'approved', '# Executing'), phase('executing', 'p1'), plan('p2', 1, 'approved', '# Other'), entry('message', {})]
    entries.push(entry('compaction', { summary: 's', firstKeptSeq: 4 }))
    expect(approvedPlanToReinject(entries)).toBe('# Executing')
  })
  it('不在执行中（历史上已批准、规划中、执行结束）、计划仍在保留的消息中、没有压缩时 undefined', () => {
    const compacted = (...before: EntryLike[]) => [...before, entry('message', {}), entry('compaction', { summary: 's', firstKeptSeq: seq })]
    expect(approvedPlanToReinject(compacted(plan('p1', 1, 'approved')))).toBeUndefined()
    expect(approvedPlanToReinject(compacted(plan('p1', 1, 'approved'), phase('none')))).toBeUndefined()
    expect(approvedPlanToReinject(compacted(plan('p1', 1, 'approved'), phase('executing', 'p1'), phase('planning')))).toBeUndefined()
    expect(
      approvedPlanToReinject([
        entry('message', {}),
        plan('p1', 1, 'approved'),
        phase('executing', 'p1'),
        entry('compaction', { summary: 's', firstKeptSeq: 2 }),
      ]),
    ).toBeUndefined()
    expect(approvedPlanToReinject([plan('p1', 1, 'approved'), phase('executing', 'p1')])).toBeUndefined()
  })
  it('latestPlan 按 planId 取最新一条', () => {
    const entries = [plan('p1', 1, 'proposed'), plan('p2', 1, 'proposed'), plan('p1', 1, 'rejected')]
    expect(latestPlan(entries, 'p1')).toMatchObject({ status: 'rejected' })
    expect(latestPlan(entries)).toMatchObject({ planId: 'p1', status: 'rejected' })
  })
})

describe('计划文本', () => {
  it('必须以 # 标题开头且不超过 64 000 字符', () => {
    expect(planMarkdownProblem('# Plan\n\n- step')).toBeUndefined()
    expect(planMarkdownProblem('\n\n## Plan')).toBeUndefined()
    expect(planMarkdownProblem('Plan without heading')).toMatch(/heading/)
    expect(planMarkdownProblem('#NoSpace')).toMatch(/heading/)
    expect(planMarkdownProblem(`# P\n${'x'.repeat(64_000)}`)).toMatch(/64000/)
    expect(planTitle('\n## Fix the tests  \nbody')).toBe('Fix the tests')
  })
  it('<approved_plan> 超出上限截断并注明', () => {
    const long = `# P\n${'y'.repeat(APPROVED_PLAN_MAX_CHARS)}`
    const { text } = approvedPlanSection(long)
    expect(text.startsWith('<approved_plan>')).toBe(true)
    expect(text).toContain(`[truncated: the approved plan is ${long.length} characters`)
    expect(text.length).toBeLessThan(APPROVED_PLAN_MAX_CHARS + 400)
  })
})

describe('审阅闭环（createAgentRuntime）', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-plan-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  function harness() {
    const { faux, models, model } = createFauxModels()
    const entries: RunEntry[] = []
    const calls: string[] = []
    // 进入规划不改变 Permission Mode（ADR 0028）：模式始终为 accept-edits，批准只结束规划。
    const current: PermissionMode = 'accept-edits'
    let planning = true
    const review: PlanReview = {
      active: async () => planning,
      async propose(toolCallId, markdown) {
        calls.push(`propose ${toolCallId} ${planTitle(markdown)}`)
        return { planId: 'p1', revision: calls.filter((c) => c.startsWith('propose')).length }
      },
      async rejected(toolCallId, feedback) {
        calls.push(`rejected ${toolCallId} ${feedback ?? '-'}`)
      },
      async approved(toolCallId, markdown) {
        calls.push(`approved ${toolCallId}`)
        planning = false
        return { markdown: `${markdown}\n(edited)` }
      },
    }
    const tools = createToolRegistry()
    tools.register(createExitPlanModeTool(review), { permissionClass: 'plan-exit' })
    const runtime = createAgentRuntime({
      models,
      model,
      cwd: ws.dir,
      sessionId: 's1',
      tools,
      commit: async () => {},
      permissions: { mode: () => current, planning: () => planning, rules: () => [] },
    })
    const waiters = new Set<() => void>()
    runtime.subscribe((event) => {
      if (event.kind !== 'entry') return
      entries.push(event.entry)
      for (const w of waiters) w()
    })
    const request = (n = 1) =>
      new Promise<Extract<RunEntry, { kind: 'approval_request' }>>((resolve) => {
        const check = () => {
          const found = entries.filter((e): e is Extract<RunEntry, { kind: 'approval_request' }> => e.kind === 'approval_request')[n - 1]
          if (found) {
            waiters.delete(check)
            resolve(found)
          }
        }
        waiters.add(check)
        check()
      })
    const results = () =>
      entries.flatMap((e) =>
        e.kind === 'message' && e.payload.role === 'toolResult'
          ? [{ isError: e.payload.isError, text: e.payload.content.map((b) => ('text' in b ? b.text : '')).join('') }]
          : [],
      )
    return { faux, runtime, entries, calls, request, results }
  }
  const exit = (id: string, planText: string) => fauxAssistantMessage(fauxToolCall('exit_plan_mode', { plan: planText }, { id }), { stopReason: 'toolUse' })

  it('批准：proposed 之后以 kind plan 询问（模式为 accept-edits 也询问）；执行时宿主提交批准，结果带最终计划、不提模式，Run 继续', async () => {
    const h = harness()
    h.faux.setResponses([exit('e1', '# Fix it\n- a'), fauxAssistantMessage('implementing')])
    const done = h.runtime.run('plan it')
    const req = await h.request()
    expect(req.payload).toMatchObject({ kind: 'plan', toolName: 'exit_plan_mode', subject: 'Fix it', planId: 'p1', revision: 1, suggestions: [] })
    expect(h.calls).toEqual(['propose e1 Fix it'])
    await h.runtime.answerApproval(req.payload.requestId, { decision: 'allow' })
    expect((await done).status).toBe('completed')
    expect(h.calls).toEqual(['propose e1 Fix it', 'approved e1'])
    expect(h.results()).toEqual([
      {
        isError: false,
        text: [
          'The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan:',
          '1. First break the plan into steps with todo_write.',
          '2. Do the work and verify it, for example by running the relevant tests or checks.',
          '3. When the work is done, call complete_plan with a report that goes through the plan item by item: what you did, how you verified it, and anything you did not do or did differently, with the reason.',
          '',
          '# Fix it\n- a\n(edited)',
        ].join('\n'),
      },
    ])
  })

  it('带反馈的拒绝：提交 rejected，模型看到反馈并继续规划；无反馈的拒绝本批后 aborted', async () => {
    const h = harness()
    h.faux.setResponses([exit('e1', '# One'), exit('e2', '# Two'), fauxAssistantMessage('stopped?')])
    const done = h.runtime.run('plan it')
    await h.runtime.answerApproval((await h.request(1)).payload.requestId, { decision: 'deny', feedback: 'add tests' })
    await h.runtime.answerApproval((await h.request(2)).payload.requestId, { decision: 'deny' })
    expect((await done).status).toBe('aborted')
    expect(h.calls).toEqual(['propose e1 One', 'rejected e1 add tests', 'propose e2 Two', 'rejected e2 -'])
    const [first, second] = h.results()
    expect(first).toEqual({ isError: true, text: expect.stringContaining('The user did not approve the plan and said:\nadd tests') })
    expect(second!.isError).toBe(true)
    expect(second!.text).toContain('The user rejected this tool call')
  })

  it('计划没有 # 标题：参数错误，不提交也不询问', async () => {
    const h = harness()
    h.faux.setResponses([exit('e1', 'no heading here'), fauxAssistantMessage('ok')])
    expect((await h.runtime.run('plan it')).status).toBe('completed')
    expect(h.calls).toEqual([])
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
    expect(h.results()).toEqual([{ isError: true, text: expect.stringContaining('Invalid plan: the plan must start with a Markdown heading') }])
  })
})

describe('complete_plan（createAgentRuntime）', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-plan-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  const COMPLETED = 'The plan is complete and your report was recorded; the user sees it with the plan. Continue only if the user asks for more.'

  /** 模型调用一次 complete_plan；询问时（没有回答）停止 Run。 */
  async function run(report: string, options: { mode?: PermissionMode; rules?: PermissionRule[]; complete?: (report: string) => Promise<void> } = {}) {
    const { faux, models, model } = createFauxModels()
    const reports: string[] = []
    const tools = createToolRegistry()
    tools.register(createCompletePlanTool({ complete: options.complete ?? (async (r) => void reports.push(r)) }), { permissionClass: 'session-state' })
    const runtime = createAgentRuntime({
      models,
      model,
      cwd: ws.dir,
      sessionId: 's1',
      tools,
      commit: async () => {},
      permissions: { mode: () => options.mode ?? 'default', planning: () => false, rules: () => options.rules ?? [] },
    })
    const entries: RunEntry[] = []
    runtime.subscribe((event) => {
      if (event.kind !== 'entry') return
      entries.push(event.entry)
      if (event.entry.kind === 'approval_request') runtime.abort()
    })
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(COMPLETE_PLAN_TOOL, { report }, { id: 'c1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    await runtime.run('go')
    const results = entries.flatMap((e) =>
      e.kind === 'message' && e.payload.role === 'toolResult'
        ? [{ isError: e.payload.isError, text: e.payload.content.map((b) => ('text' in b ? b.text : '')).join('') }]
        : [],
    )
    return { reports, asked: entries.some((e) => e.kind === 'approval_request'), results }
  }

  it.each<PermissionMode>(['read-only', 'default', 'accept-edits', 'auto-review', 'full-access'])(
    '%s 下不询问：报告原样交给宿主，结果为完成文本',
    async (mode) => {
      const report = '## 1. Read src/parse.ts\nDone; verified by `pnpm test`.'
      expect(await run(report, { mode })).toEqual({ reports: [report], asked: false, results: [{ isError: false, text: COMPLETED }] })
    },
  )

  it('拒绝规则与询问规则照常生效', async () => {
    const denied = await run('# r', { mode: 'full-access', rules: [{ behavior: 'deny', tool: COMPLETE_PLAN_TOOL }] })
    expect([denied.reports, denied.asked, denied.results[0]?.isError]).toEqual([[], false, true])
    const asked = await run('# r', { mode: 'full-access', rules: [{ behavior: 'ask', tool: COMPLETE_PLAN_TOOL }] })
    expect([asked.reports, asked.asked]).toEqual([[], true])
  })

  it.each([
    ['空报告', ' \n\t ', 'Invalid report: the report is empty. Call complete_plan again with the complete report.'],
    ['超过 64000 字符', 'x'.repeat(64_001), 'Invalid report: the report is longer than 64000 characters. Call complete_plan again with the complete report.'],
  ])('%s：错误结果，不交给宿主', async (_name, report, expected) => {
    expect(await run(report)).toEqual({ reports: [], asked: false, results: [{ isError: true, text: expected }] })
  })

  it('宿主拒绝（没有执行中的 Plan）：错误结果为宿主给出的文本', async () => {
    const result = await run('# r', {
      complete: async () => {
        throw new Error(NO_PLAN_IN_PROGRESS_TEXT)
      },
    })
    expect(result.results).toEqual([
      {
        isError: true,
        text: 'No plan is being carried out: there is no approved plan in progress (it was completed or abandoned, or none was approved). Continue with the task.',
      },
    ])
  })
})

// Plan Mode 的 agent 部分：条目派生（planId 与 revision、压缩后的再注入）、system section 文本与计划校验，以及经 createAgentRuntime 的
// 审阅闭环（proposed → kind plan 的审批 → 批准执行 / 带反馈继续规划 / 无反馈拒绝停止；参数错误不提交也不询问）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { EntryLike } from '../entries/types.ts'
import type { PermissionMode } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import {
  APPROVED_PLAN_MAX_CHARS,
  approvedPlanSection,
  approvedPlanToReinject,
  createExitPlanModeTool,
  latestPlan,
  nextPlanRef,
  planMarkdownProblem,
  planTitle,
  type PlanReview,
} from './index.ts'

let seq = 0
const entry = (kind: string, payload: unknown): EntryLike => ({ seq: ++seq, kind, payload })
const plan = (planId: string, revision: number, status: string, markdown = '# P') => entry('plan', { planId, revision, markdown, status })
const mode = (m: string, prior?: string) => entry('permission_mode', prior ? { mode: m, prior } : { mode: m })
beforeEach(() => {
  seq = 0
})

describe('nextPlanRef', () => {
  const id = () => 'new'
  it.each<[string, () => EntryLike[], { planId: string; revision: number }]>([
    ['还没有计划：新 planId，revision 1', () => [mode('default'), mode('plan', 'default')], { planId: 'new', revision: 1 }],
    ['本次规划已有 proposed：沿用并加一', () => [mode('plan', 'default'), plan('p1', 1, 'proposed')], { planId: 'p1', revision: 2 }],
    ['被拒绝后再次提交：沿用并加一', () => [mode('plan', 'default'), plan('p1', 1, 'proposed'), plan('p1', 1, 'rejected')], { planId: 'p1', revision: 2 }],
    ['上一份已批准：新 planId', () => [mode('plan', 'default'), plan('p1', 2, 'approved'), mode('default')], { planId: 'new', revision: 1 }],
    [
      '退出后重新进入 plan：新 planId',
      () => [mode('plan', 'default'), plan('p1', 1, 'proposed'), mode('default'), mode('plan', 'default')],
      { planId: 'new', revision: 1 },
    ],
  ])('%s', (_name, build, expected) => {
    expect(nextPlanRef(build(), id)).toEqual(expected)
  })

  it('被回退的区间不算', () => {
    const entries = [mode('plan', 'default'), plan('p1', 1, 'proposed')]
    entries.push(entry('rewind', { targetSeq: 2 }))
    expect(nextPlanRef(entries, id)).toEqual({ planId: 'new', revision: 1 })
  })
})

describe('approvedPlanToReinject', () => {
  it('最新已批准计划早于最后一个 compaction 的 firstKeptSeq 时返回其正文', () => {
    const entries = [plan('p1', 1, 'approved', '# Old'), plan('p2', 1, 'approved', '# New'), entry('message', {}), entry('message', {})]
    entries.push(entry('compaction', { summary: 's', firstKeptSeq: 4 }))
    expect(approvedPlanToReinject(entries)).toBe('# New')
  })
  it('计划仍在保留的消息中、没有压缩或没有已批准计划时 undefined', () => {
    expect(approvedPlanToReinject([entry('message', {}), plan('p1', 1, 'approved'), entry('compaction', { summary: 's', firstKeptSeq: 2 })])).toBeUndefined()
    expect(approvedPlanToReinject([plan('p1', 1, 'approved')])).toBeUndefined()
    expect(approvedPlanToReinject([plan('p1', 1, 'proposed'), entry('message', {}), entry('compaction', { summary: 's', firstKeptSeq: 2 })])).toBeUndefined()
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
    let current: PermissionMode = 'plan'
    const review: PlanReview = {
      async propose(toolCallId, markdown) {
        calls.push(`propose ${toolCallId} ${planTitle(markdown)}`)
        return { planId: 'p1', revision: calls.filter((c) => c.startsWith('propose')).length }
      },
      async rejected(toolCallId, feedback) {
        calls.push(`rejected ${toolCallId} ${feedback ?? '-'}`)
      },
      async approved(toolCallId, markdown) {
        calls.push(`approved ${toolCallId}`)
        current = 'accept-edits'
        return { markdown: `${markdown}\n(edited)`, mode: current }
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
      permissions: { mode: () => current, rules: () => [] },
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

  it('批准：proposed 之后以 kind plan 询问；执行时宿主提交批准，结果带最终计划与模式，Run 继续', async () => {
    const h = harness()
    h.faux.setResponses([exit('e1', '# Fix it\n- a'), fauxAssistantMessage('implementing')])
    const done = h.runtime.run('plan it')
    const req = await h.request()
    expect(req.payload).toMatchObject({ kind: 'plan', toolName: 'exit_plan_mode', subject: 'Fix it', planId: 'p1', revision: 1, suggestions: [] })
    expect(h.calls).toEqual(['propose e1 Fix it'])
    await h.runtime.answerApproval(req.payload.requestId, { decision: 'allow' })
    expect((await done).status).toBe('completed')
    expect(h.calls).toEqual(['propose e1 Fix it', 'approved e1'])
    expect(h.results()).toEqual([{ isError: false, text: 'The user approved the plan. Proceed under accept-edits.\n\n# Fix it\n- a\n(edited)' }])
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

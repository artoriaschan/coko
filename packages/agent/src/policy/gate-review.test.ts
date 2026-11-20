// 自动审查（ADR 0029）在权限 gate 中的位置：faux 模型 + 临时 Workspace，经 createAgentRuntime 的公开接口观察条目、文件与 Reviewer 端口
// 收到的请求。Reviewer 由测试替身端口给出结论；真实审查请求见 tests/integration/sidecar-auto-review.test.ts。
import { access } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { ProgressEvent, RunEntry } from '../engine/types.ts'
import type { HookVerdict } from '../extensions/hooks/types.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { ApprovalReview, PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ReviewOutcome, ReviewRequest } from './gate.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-reviewgate-')
})
afterEach(async () => {
  await ws.dispose()
})

const plain = (name: string, description = name): CokoTool =>
  ({
    name,
    label: name,
    description,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async () => ({ content: [{ type: 'text', text: `${name} ran` }], details: undefined }),
  }) as CokoTool

interface Setup {
  mode?: PermissionMode
  rules?: PermissionRule[]
  /** 省略时没有 Reviewer 端口。 */
  review?: (request: ReviewRequest, signal?: AbortSignal) => Promise<ReviewOutcome> | ReviewOutcome
  pre?: () => HookVerdict
  permissionRequest?: () => HookVerdict
}

function harness(setup: Setup) {
  const { faux, models, model } = createFauxModels()
  const registry = createBuiltinToolRegistry({
    cwd: ws.dir,
    exec: createLocalExecPort({ sandbox: { wrap: () => [], denialSignature: 'operation not permitted' } }),
  })
  registry.register(plain('mcp__docs__search', 'Search the docs.'))
  registry.register(plain('schedule_create'), { permissionClass: 'automation' })
  const entries: RunEntry[] = []
  const progress: ProgressEvent[] = []
  const waiters = new Set<() => void>()
  const reviews: ReviewRequest[] = []
  const state = { mode: setup.mode ?? 'auto-review' }
  const review = setup.review
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    tools: registry,
    commit: async () => {},
    permissions: {
      mode: () => state.mode,
      rules: () => setup.rules ?? [],
      ...(setup.pre || setup.permissionRequest
        ? { hooks: { preToolUse: async () => setup.pre?.() ?? {}, permissionRequest: async () => setup.permissionRequest?.() ?? {} } }
        : {}),
      ...(review ? { reviewer: { review: async (request: ReviewRequest, signal?: AbortSignal) => (reviews.push(request), review(request, signal)) } } : {}),
    },
  })
  runtime.subscribe((event) => {
    if (event.kind === 'progress') progress.push(event.event)
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
  const approval = (count = 1) =>
    new Promise<Extract<RunEntry, { kind: 'approval_request' }>>((resolve) => {
      const check = () => {
        const found = entries.filter((e): e is Extract<RunEntry, { kind: 'approval_request' }> => e.kind === 'approval_request')
        if (found.length < count) return
        waiters.delete(check)
        resolve(found[count - 1]!)
      }
      waiters.add(check)
      check()
    })
  const script = (...calls: ReturnType<typeof fauxToolCall>[]) =>
    faux.setResponses([fauxAssistantMessage(calls, { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
  return { faux, runtime, entries, progress, reviews, state, approval, script }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const kinds = (entries: RunEntry[]) => entries.map((e) => (e.kind === 'message' ? e.payload.role : e.kind))
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const decisions = (entries: RunEntry[]) => entries.flatMap((e) => (e.kind === 'approval_decision' ? [e.payload] : []))
const bash = (id: string, command: string) => fauxToolCall('bash', { command }, { id })
const allow: ReviewOutcome = { verdict: 'allow', reason: 'Writing out.txt is what the user asked for.' }

describe('Reviewer 放行', () => {
  it('提交请求与 by reviewer、带理由的单次允许后执行；不进入等待表；端口收到 runId、调用与参数', async () => {
    const h = harness({ review: () => allow })
    h.script(bash('b1', 'printf hi > out.txt'))
    const result = await h.runtime.run('write out.txt')
    expect(result.status).toBe('completed')
    expect(await exists(ws.path('out.txt'))).toBe(true)
    expect(h.runtime.pendingApprovals).toEqual([])
    const [request] = h.entries.filter((e) => e.kind === 'approval_request')
    expect(request!.payload).toMatchObject({ toolCallId: 'b1', toolName: 'bash', kind: 'tool', subject: 'printf hi > out.txt' })
    expect(request!.payload).not.toHaveProperty('review')
    expect(decisions(h.entries)).toEqual([{ requestId: request!.payload.requestId, outcome: 'allowed', scope: 'once', by: 'reviewer', reason: allow.reason }])
    expect(kinds(h.entries)).toEqual([
      'run_start',
      'user',
      'model_request',
      'assistant',
      'approval_request',
      'approval_decision',
      'tool_exec',
      'toolResult',
      'model_request',
      'assistant',
      'run_end',
    ])
    expect(h.reviews).toEqual([{ runId: result.runId, toolCallId: 'b1', toolName: 'bash', input: { command: 'printf hi > out.txt' }, priorCalls: [] }])
  })

  it('同一批的多个调用按顺序逐个审查；先前经过 gate 的调用（不论结果）进入 priorCalls', async () => {
    const order: string[] = []
    const held = { b1: heldReview(), b3: heldReview() }
    const h = harness({
      rules: [{ behavior: 'deny', tool: 'Bash', content: 'rm *' }],
      review: async (request, signal) => {
        order.push(`start ${request.toolCallId}`)
        const outcome = await held[request.toolCallId as keyof typeof held].review(request, signal)
        order.push(`end ${request.toolCallId}`)
        return outcome
      },
    })
    h.script(bash('b1', 'printf a > a.txt'), bash('b2', 'rm -f a.txt'), bash('b3', 'printf b > b.txt'))
    const pending = h.runtime.run('go')
    // b1 的结论放出之前，b3 的审查没有开始。
    await held.b1.started
    await settled()
    expect(order).toEqual(['start b1'])
    held.b1.release(allow)
    await held.b3.started
    expect(order).toEqual(['start b1', 'end b1', 'start b3'])
    held.b3.release(allow)
    await pending
    expect(order).toEqual(['start b1', 'end b1', 'start b3', 'end b3'])
    expect(h.reviews.map((r) => [r.toolCallId, r.priorCalls.map((c) => (c.input as { command: string }).command)])).toEqual([
      ['b1', []],
      ['b3', ['printf a > a.txt', 'rm -f a.txt']],
    ])
    expect(text(toolResults(h.entries)[1]!)).toBe('Permission denied by rule Bash(rm *).')
  })

  it('MCP 工具的请求带工具描述；其他类不带', async () => {
    const h = harness({ review: () => allow })
    h.script(fauxToolCall('mcp__docs__search', { q: 'x' }, { id: 'm1' }))
    await h.runtime.run('go')
    expect(h.reviews.map((r) => [r.toolName, r.description])).toEqual([['mcp__docs__search', 'Search the docs.']])
    expect(text(toolResults(h.entries)[0]!)).toBe('mcp__docs__search ran')
  })
})

describe('Reviewer 转交与失败', () => {
  it.each<[string, Setup['review'], ApprovalReview]>([
    ['转交', () => ({ verdict: 'escalate', reason: 'Not sure.' }), { outcome: 'escalated', reason: 'Not sure.' }],
    ...(['timeout', 'request-failed', 'invalid-output', 'no-model', 'budget', 'too-long'] as const).map((code): [string, Setup['review'], ApprovalReview] => [
      `审查失败 ${code}`,
      () => ({ verdict: 'failed', code }),
      { outcome: 'failed', code },
    ]),
    [
      '端口抛错',
      () => {
        throw new Error('boom')
      },
      { outcome: 'failed', code: 'request-failed' },
    ],
  ])('%s：出现带建议规则与审查信息的请求；允许后执行，决定为用户的', async (_name, review, expected) => {
    const h = harness({ review })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload.suggestions).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'printf hi > out.txt' }])
    expect(asked.payload.review).toEqual(expected)
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([asked.payload.requestId])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'allow' })
    await pending
    expect(await exists(ws.path('out.txt'))).toBe(true)
    expect(decisions(h.entries)).toEqual([{ requestId: asked.payload.requestId, outcome: 'allowed', scope: 'once' }])
    expect(h.reviews).toHaveLength(1)
  })

  it('转交后用户无反馈拒绝：与现有拒绝相同（不执行，Run 以 aborted 结束）；带反馈拒绝时模型看到反馈', async () => {
    const h = harness({ review: () => ({ verdict: 'escalate', reason: 'Not sure.' }) })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny' })
    expect((await pending).status).toBe('aborted')
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(text(toolResults(h.entries)[0]!)).toBe('The user rejected this tool call. Stop and wait for the user to tell you how to proceed.')

    h.script(bash('b2', 'printf hi > out.txt'))
    const second = h.runtime.run('go')
    const again = await h.approval(2)
    await h.runtime.answerApproval(again.payload.requestId, { decision: 'deny', feedback: 'not now' })
    expect((await second).status).toBe('completed')
    expect(text(toolResults(h.entries)[1]!)).toBe('The user rejected this tool call and said:\nnot now')
  })

  it('停止 Run 时进行中的审查被取消：调用得到 Operation aborted，没有审批条目', async () => {
    let started!: () => void
    const reviewing = new Promise<void>((resolve) => (started = resolve))
    const h = harness({
      review: (_request, signal) =>
        new Promise((resolve) => {
          started()
          signal?.addEventListener('abort', () => resolve({ verdict: 'failed', code: 'request-failed' }), { once: true })
        }),
    })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await reviewing
    h.runtime.abort()
    await pending
    expect(h.entries.filter((e) => e.kind === 'approval_request' || e.kind === 'approval_decision')).toEqual([])
    expect(await exists(ws.path('out.txt'))).toBe(false)
  })
})

describe('迟到的审查结果', () => {
  it('端口按超时返回后，模型的放行结论才到达：不生效，请求带超时代码继续等待，调用未执行', async () => {
    let late!: (outcome: ReviewOutcome) => void
    let timedOut!: () => void
    const answered = new Promise<ReviewOutcome>((resolve) => (late = resolve))
    const timer = new Promise<ReviewOutcome>((resolve) => (timedOut = () => resolve({ verdict: 'failed', code: 'timeout' })))
    // 与 SessionReviews 相同的形状：模型结论与超时赛跑，先到者为端口的返回值。
    const h = harness({ review: () => Promise.race([answered, timer]) })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await expect.poll(() => h.reviews.length).toBe(1)
    timedOut()
    const asked = await h.approval()
    expect(asked.payload.review).toEqual({ outcome: 'failed', code: 'timeout' })
    late(allow)
    await answered
    await settled()
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([asked.payload.requestId])
    expect(decisions(h.entries)).toEqual([])
    expect(await exists(ws.path('out.txt'))).toBe(false)
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await pending
    expect(decisions(h.entries).map((d) => d.by ?? 'user')).toEqual(['user'])
    expect(await exists(ws.path('out.txt'))).toBe(false)
  })
})

describe('不经 Reviewer 的调用', () => {
  it('没有端口时与之前相同：auto-review 下照常出审批请求', async () => {
    const h = harness({})
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await pending
    expect(asked.payload.toolName).toBe('bash')
  })

  it.each<[string, PermissionMode]>([
    ['default', 'default'],
    ['accept-edits', 'accept-edits'],
  ])('%s 模式不送审', async (_name, mode) => {
    const h = harness({ mode, review: () => allow })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload).not.toHaveProperty('review')
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await pending
    expect(h.reviews).toEqual([])
  })

  it('允许规则覆盖的命令、Workspace 内读取与可写根内编辑不送审', async () => {
    const h = harness({ rules: [{ behavior: 'allow', tool: 'Bash', content: 'printf *' }], review: () => allow })
    h.script(
      bash('b1', 'printf hi > out.txt'),
      fauxToolCall('read', { path: 'out.txt' }, { id: 'r1' }),
      fauxToolCall('write', { path: 'w.txt', content: 'x' }, { id: 'w1' }),
    )
    await h.runtime.run('go')
    expect(h.reviews).toEqual([])
    expect(h.entries.filter((e) => e.kind === 'approval_request')).toEqual([])
    expect(await exists(ws.path('w.txt'))).toBe(true)
  })

  it.each<[string, Setup, ReturnType<typeof fauxToolCall>]>([
    ['询问规则', { rules: [{ behavior: 'ask', tool: 'Bash', content: 'printf *' }] }, bash('b1', 'printf hi > out.txt')],
    ['受保护路径（.git 内写入）', {}, fauxToolCall('write', { path: '.git/config', content: 'x' }, { id: 'w1' })],
    ['越出可写根的写入', {}, fauxToolCall('write', { path: '/etc/coko-review-test', content: 'x' }, { id: 'w1' })],
    ['automation（schedule_create）', {}, fauxToolCall('schedule_create', {}, { id: 's1' })],
    ['PreToolUse Hook 的强制询问', { pre: () => ({ decision: 'ask', reason: 'check' }) }, bash('b1', 'printf hi > out.txt')],
  ])('%s：Reviewer 恒放行时仍出审批请求，端口没有被调用', async (_name, setup, call) => {
    const h = harness({ ...setup, review: () => allow })
    h.script(call)
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload).not.toHaveProperty('review')
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await pending
    expect(h.reviews).toEqual([])
  })

  it('拒绝规则照常拒绝；PermissionRequest Hook 给出 allow 或 deny 时不送审，没有决定时送审', async () => {
    const denied = harness({ rules: [{ behavior: 'deny', tool: 'Bash', content: 'printf *' }], review: () => allow })
    denied.script(bash('b1', 'printf hi > out.txt'))
    await denied.runtime.run('go')
    expect(text(toolResults(denied.entries)[0]!)).toBe('Permission denied by rule Bash(printf *).')

    const hookAllowed = harness({ permissionRequest: () => ({ decision: 'allow' }), review: () => allow })
    hookAllowed.script(bash('b1', 'printf hi > out.txt'))
    await hookAllowed.runtime.run('go')
    expect(decisions(hookAllowed.entries).map((d) => d.by)).toEqual(['hook'])

    const hookDenied = harness({ permissionRequest: () => ({ decision: 'deny', reason: 'no' }), review: () => allow })
    hookDenied.script(bash('b1', 'printf hi > out.txt'))
    await hookDenied.runtime.run('go')
    expect(text(toolResults(hookDenied.entries)[0]!)).toBe('Blocked by hook: no')

    const undecided = harness({ permissionRequest: () => ({}), review: () => allow })
    undecided.script(bash('b1', 'printf hi > out.txt'))
    await undecided.runtime.run('go')

    expect([denied.reviews.length, hookAllowed.reviews.length, hookDenied.reviews.length, undecided.reviews.length]).toEqual([0, 0, 0, 1])
    expect(decisions(undecided.entries).map((d) => d.by)).toEqual(['reviewer'])
  })
})

/** 受控 promise：交叠位置由测试决定（审查进行中时做某事，再放出结论）。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** 已到达的结论都已处理：等当前排队的微任务与 I/O 回调跑完（不以时长代表完成）。 */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

/** 审查端口被调用时通知测试，结论由测试放出（不理会 signal：迟到的结论也会到达）。 */
function heldReview() {
  const started = deferred<AbortSignal | undefined>()
  const outcome = deferred<ReviewOutcome>()
  return {
    started: started.promise,
    release: outcome.resolve,
    review: (_request: ReviewRequest, signal?: AbortSignal) => (started.resolve(signal), outcome.promise),
  }
}

describe('审查中与时序', () => {
  it('送审时先发出 review_start 进度（调用端口之前），不入库；不送审的调用没有它', async () => {
    const held = heldReview()
    const h = harness({ rules: [{ behavior: 'allow', tool: 'Bash', content: 'printf a *' }], review: held.review })
    h.script(bash('b0', 'printf a > a.txt'), bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await held.started
    const runId = (h.progress.find((e) => e.type === 'run_start') as { runId: string }).runId
    expect(h.progress.filter((e) => e.type === 'review_start')).toEqual([{ type: 'review_start', runId, toolCallId: 'b1', toolName: 'bash' }])
    held.release(allow)
    await pending
    expect(h.progress.filter((e) => e.type === 'review_start')).toHaveLength(1)
    expect(h.entries.map((e) => e.kind)).not.toContain('review_start')
  })

  it('审查途中切到 default：放行结论不生效，出现普通审批请求；之后的重新判定不再送审', async () => {
    const held = heldReview()
    const h = harness({ review: held.review })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await held.started
    h.state.mode = 'default'
    held.release(allow)
    const asked = await h.approval()
    expect(asked.payload).toMatchObject({ toolCallId: 'b1', suggestions: [{ behavior: 'allow', tool: 'Bash', content: 'printf hi > out.txt' }] })
    expect(asked.payload).not.toHaveProperty('review')
    expect(decisions(h.entries)).toEqual([])
    h.state.mode = 'auto-review'
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([asked.payload.requestId])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'allow' })
    await pending
    expect(await exists(ws.path('out.txt'))).toBe(true)
    expect(decisions(h.entries)).toEqual([{ requestId: asked.payload.requestId, outcome: 'allowed', scope: 'once' }])
    expect(h.reviews).toHaveLength(1)
  })

  it('审查途中切到 full-access：调用按模式放行执行，没有审批条目（转交结论同样作废）', async () => {
    const held = heldReview()
    const h = harness({ review: held.review })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await held.started
    h.state.mode = 'full-access'
    held.release({ verdict: 'escalate', reason: 'Not sure.' })
    expect((await pending).status).toBe('completed')
    expect(await exists(ws.path('out.txt'))).toBe(true)
    expect(h.entries.filter((e) => e.kind === 'approval_request' || e.kind === 'approval_decision')).toEqual([])
  })

  it('审查途中新增匹配的拒绝规则：调用以规则拒绝；新增询问规则：直接询问，不重审', async () => {
    const rules: PermissionRule[] = []
    const held = heldReview()
    const h = harness({ rules, review: held.review })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    await held.started
    rules.push({ behavior: 'deny', tool: 'Bash', content: 'printf *' })
    held.release(allow)
    await pending
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(text(toolResults(h.entries)[0]!)).toBe('Permission denied by rule Bash(printf *).')
    expect(h.entries.filter((e) => e.kind === 'approval_request' || e.kind === 'approval_decision')).toEqual([])

    const again = heldReview()
    const asking: PermissionRule[] = []
    const h2 = harness({ rules: asking, review: again.review })
    h2.script(bash('b2', 'printf hi > out.txt'))
    const second = h2.runtime.run('go')
    await again.started
    asking.push({ behavior: 'ask', tool: 'Bash', content: 'printf *' })
    again.release(allow)
    const asked = await h2.approval()
    expect(asked.payload.toolCallId).toBe('b2')
    await h2.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await second
    expect(h2.reviews).toHaveLength(1)
    expect(decisions(h2.entries).map((d) => d.by)).toEqual([undefined])
  })

  it.each<[string, (h: ReturnType<typeof harness>) => void, string, string]>([
    ['停止', (h) => h.runtime.abort(), 'Operation aborted', 'aborted'],
    ['暂停', (h) => h.runtime.pause(), 'Not run: the user paused the run before this call was approved.', 'paused'],
  ])('%s：进行中的审查收到中止信号；之后到达的放行结论不生效，没有审批条目', async (_name, interrupt, resultText, status) => {
    const held = heldReview()
    const h = harness({ review: held.review })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const signal = await held.started
    interrupt(h)
    expect(signal?.aborted).toBe(true)
    held.release(allow)
    expect((await pending).status).toBe(status)
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(text(toolResults(h.entries)[0]!)).toBe(resultText)
    expect(h.entries.filter((e) => e.kind === 'approval_request' || e.kind === 'approval_decision')).toEqual([])
    expect(h.reviews).toHaveLength(1)
  })

  it('每次调用至多审查一次：转交后的请求被重新判定并重新询问时不送审', async () => {
    const rules: PermissionRule[] = []
    const h = harness({ rules, review: () => ({ verdict: 'escalate', reason: 'Not sure.' }) })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const first = await h.approval()
    rules.push({ behavior: 'ask', tool: 'Bash', content: 'printf *' })
    await h.runtime.answerApproval(first.payload.requestId, { decision: 'reevaluate' })
    const second = await h.approval(2)
    expect(second.payload).toMatchObject({ toolCallId: 'b1', suggestions: [] })
    await h.runtime.answerApproval(second.payload.requestId, { decision: 'allow' })
    await pending
    expect(await exists(ws.path('out.txt'))).toBe(true)
    expect(h.reviews).toHaveLength(1)
    expect(decisions(h.entries).map((d) => [d.outcome, d.by])).toEqual([
      ['superseded', undefined],
      ['allowed', undefined],
    ])
  })

  it('切换到 auto-review 时已在等待的请求保持等待，没有审查请求', async () => {
    const h = harness({ mode: 'default', review: () => allow })
    h.script(bash('b1', 'printf hi > out.txt'))
    const pending = h.runtime.run('go')
    const asked = await h.approval()
    h.state.mode = 'auto-review'
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([asked.payload.requestId])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await pending
    expect(h.reviews).toEqual([])
    expect(h.progress.filter((e) => e.type === 'review_start')).toEqual([])
  })
})

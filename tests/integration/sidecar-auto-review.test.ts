// 自动审查（ADR 0029，票 03）：真实 Sidecar（faux 模型）经协议驱动。faux 以 match: 'COKO_PERMISSION_REVIEW' 应答审查请求；请求明细日志
// （requestDetailsLog）记下每次模型请求的系统提示、消息、工具与选项，用于断言哪些调用送审。审查应答放在脚本最前，使它先于对话回复被取用。
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  goalPaths,
  hookPaths,
  mcpPaths,
  permissionPaths,
  planPaths,
  schedulePaths,
  tracePaths,
  type McpResponse,
  type SessionEntryRecord,
  type TraceResponse,
} from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { advanceClock, client, connect, exchange, fauxScript, hookCommand, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'
const MARKER = 'COKO_PERMISSION_REVIEW'
const allow = (reason = 'This is what the user asked for.') => ({ match: MARKER, content: JSON.stringify({ decision: 'allow', reason }) })
const escalate = (reason = 'Not sure this was authorized.') => ({ match: MARKER, content: JSON.stringify({ decision: 'escalate', reason }) })
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const bash = (id: string, command: string, extra: Record<string, unknown> = {}) => call(id, 'bash', { command, ...extra })
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
type ToolResult = { toolCallId: string; isError: boolean; content: { text?: string }[] }
const toolResults = (entries: SessionEntryRecord[]) => entries.filter((e) => kindOf(e) === 'toolResult').map((e) => e.payload as ToolResult)
const text = (result: ToolResult | undefined) => (result?.content ?? []).map((b) => b.text ?? '').join('')

type Detail = { messages: { role: string; content: unknown }[]; tools?: unknown[]; options: { toolChoice?: unknown } }
/** 审查请求：系统提示（随消息记录）带固定标记；对话请求不含它。 */
const isReview = (detail: Detail) => JSON.stringify(detail).includes(MARKER)
interface ReviewInput {
  user_authorization: { goal: unknown; approved_plan: unknown; user_messages: string[] }
  delegated_tasks: { items: unknown[] }
  actions: { earlier_calls: unknown[]; pending_call: { tool: string; arguments: Record<string, unknown>; tool_description?: string } }
}

async function boot(responses: unknown[], options: { root?: string; env?: Record<string, string>; script?: Record<string, unknown> } = {}) {
  const root = options.root ?? (await realpath(await tempDir()))
  const logs = await realpath(await tempDir('coko-review-logs-'))
  const requestDetailsLog = join(logs, 'details.jsonl')
  await writeFile(requestDetailsLog, '')
  const script = await fauxScript(logs, { ...options.script, requestDetailsLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, ...options.env } })
  onTestFinished(() => sidecar.stop().then(() => undefined))
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const open = async (mode = 'auto-review', planning = false) => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
    if (planning && (await api.post(planPaths.sessionPlan(sessionId), { action: 'enter' })).status !== 200) throw new Error('entering planning failed')
    return sessionId
  }
  const entries = (sessionId: string) => stream.entries(sessionId)
  const runEnds = (sessionId: string, n: number) => stream.waitFor(() => entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
  const send = async (sessionId: string, text = 'go') => {
    const res = await api.post(apiPaths.sessionMessages(sessionId), { text })
    expect(res.status).toBe(202)
    return res.body.runId as string
  }
  const details = async () =>
    (await readFile(requestDetailsLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Detail)
  /** 审查请求的输入（按发出顺序）。 */
  const reviews = async () =>
    (await details()).filter(isReview).map((d) => JSON.parse(String(d.messages.filter((m) => m.role === 'user').at(-1)!.content)) as ReviewInput)
  const answer = (sessionId: string, requestId: string, body: Record<string, unknown>) => api.post(apiPaths.sessionApproval(sessionId, requestId), body)
  return { root, sidecar, api, stream, workspaceId, open, entries, runEnds, send, details, reviews, answer }
}

describe('Reviewer 放行与转交', () => {
  it('放行：没有等待中的请求；条目为审查的 model_request、请求、Reviewer 的允许决定、执行；请求无工具、带固定提示，出现在追踪中', async () => {
    const h = await boot([allow('Writing a.txt is what the user asked for.'), { content: [bash('b1', 'printf a > a.txt')] }, { content: 'ok' }])
    const sessionId = await h.open()
    const runId = await h.send(sessionId, 'please write a.txt')
    await h.runEnds(sessionId, 1)
    expect(await readFile(join(h.root, 'a.txt'), 'utf8')).toBe('a')
    const entries = h.entries(sessionId)
    const kinds = entries.map(kindOf)
    const from = kinds.indexOf('approval_request') - 1
    expect(kinds.slice(from, from + 5)).toEqual(['model_request', 'approval_request', 'approval_decision', 'tool_exec', 'toolResult'])
    expect(entries[from]!.payload).toMatchObject({ runId, purpose: 'review', stopReason: 'stop', retries: 0 })
    expect(entries[from]).toMatchObject({ runId })
    const request = entries[from + 1]!.payload as { requestId: string }
    expect(request).toMatchObject({ toolCallId: 'b1', toolName: 'bash', kind: 'tool', subject: 'printf a > a.txt' })
    expect(request).not.toHaveProperty('review')
    expect(entries[from + 2]!.payload).toEqual({
      requestId: request.requestId,
      outcome: 'allowed',
      scope: 'once',
      by: 'reviewer',
      reason: 'Writing a.txt is what the user asked for.',
    })
    expect(kinds.filter((k) => k === 'approval_request')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'approval_decision')).toHaveLength(1)

    const [review] = (await h.details()).filter(isReview)
    expect(review!.tools ?? []).toEqual([])
    expect(review!.options.toolChoice).toBe('none')
    expect(review!.messages.filter((m) => m.role !== 'system')).toHaveLength(1)
    expect(await h.reviews()).toEqual([
      {
        user_authorization: { goal: null, approved_plan: null, user_messages: ['please write a.txt'] },
        delegated_tasks: { items: [] },
        actions: { earlier_calls: [], pending_call: { tool: 'bash', arguments: { command: 'printf a > a.txt' } } },
      },
    ])
    const trace = (await h.api.get(tracePaths.trace(sessionId))).body as TraceResponse
    expect(trace.runs[0]!.requests.map((r) => r.purpose)).toEqual(['turn', 'review', 'turn'])
    expect(trace.runs[0]!.tools[0]).toMatchObject({ toolCallId: 'b1', approval: 'allowed', approvalBy: 'reviewer' })
    expect(h.stream.invalidEntries).toEqual([])
  })

  it('转交：出现带建议规则的待审批请求，允许后执行；再次转交后无反馈拒绝与现有拒绝相同；审查失败（非结构化输出）同样转交', async () => {
    const h = await boot([
      escalate(),
      escalate(),
      { match: MARKER, content: 'I think this is fine.' },
      { content: [bash('b1', 'printf a > a.txt')] },
      { content: 'ok' },
      { content: [bash('b2', 'printf b > b.txt')] },
      { content: [bash('b3', 'printf c > c.txt')] },
      { content: 'ok' },
    ])
    const sessionId = await h.open()
    await h.send(sessionId)
    const asked = await waitApproval(h.stream, sessionId)
    expect(asked).toMatchObject({ toolCallId: 'b1', suggestions: [{ behavior: 'allow', tool: 'Bash', content: 'printf a > a.txt' }] })
    expect(asked).not.toHaveProperty('review')
    expect((await h.answer(sessionId, asked.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(sessionId, 1)
    expect(await readFile(join(h.root, 'a.txt'), 'utf8')).toBe('a')
    expect(h.entries(sessionId).find((e) => e.kind === 'approval_decision')!.payload).toEqual({ requestId: asked.requestId, outcome: 'allowed', scope: 'once' })

    await h.send(sessionId)
    const second = await waitApproval(h.stream, sessionId, 2)
    await h.answer(sessionId, second.requestId, { decision: 'deny' })
    await h.runEnds(sessionId, 2)
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'run_end')
        .at(-1)!.payload,
    ).toMatchObject({ status: 'aborted' })
    expect(existsSync(join(h.root, 'b.txt'))).toBe(false)
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'b2'))).toBe(
      'The user rejected this tool call. Stop and wait for the user to tell you how to proceed.',
    )

    await h.send(sessionId)
    const third = await waitApproval(h.stream, sessionId, 3)
    expect(third).toMatchObject({ toolCallId: 'b3' })
    await h.answer(sessionId, third.requestId, { decision: 'deny', feedback: 'not now' })
    await h.runEnds(sessionId, 3)
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'b3'))).toBe('The user rejected this tool call and said:\nnot now')
    const reviewRequests = h.entries(sessionId).filter((e) => e.kind === 'model_request' && (e.payload as { purpose: string }).purpose === 'review')
    expect(reviewRequests).toHaveLength(3)
    expect(await h.reviews()).toHaveLength(3)
  })
})

describe('送审范围', () => {
  it('MCP 工具调用送审，请求带工具描述；放行后执行', { timeout: 60_000 }, async () => {
    const h = await boot([allow(), { content: [call('l1', 'mcp__local__echo', { text: 'hi' })] }, { content: 'done' }])
    const saved = await h.api.put(mcpPaths.servers, {
      servers: { local: stdioServerConfig({}, { alwaysLoad: true }) },
      expectedRevision: 0,
      workspaceId: h.workspaceId,
    })
    expect(saved.status).toBe(200)
    await expect
      .poll(async () => ((await h.api.get(`${mcpPaths.mcp}?workspaceId=${h.workspaceId}`)).body as McpResponse).servers[0]?.status, { timeout: 20_000 })
      .toBe('connected')
    const sessionId = await h.open()
    await h.send(sessionId)
    await h.runEnds(sessionId, 1)
    expect(text(toolResults(h.entries(sessionId))[0])).toBe('echo:hi')
    const [review] = await h.reviews()
    expect(review!.actions.pending_call).toMatchObject({ tool: 'mcp__local__echo', arguments: { text: 'hi' }, tool_description: expect.any(String) })
  })

  it('Workspace 外的读取与带 Worktree 隔离的 Subagent 派发送审', { timeout: 120_000 }, async () => {
    const fixture = await createGitWorkspace()
    onTestFinished(() => fixture.dispose())
    const outside = await realpath(await tempDir('coko-outside-'))
    await writeFile(join(outside, 'notes.txt'), 'OUTSIDE')
    const h = await boot(
      [
        allow(),
        allow(),
        { match: 'PARENT-R', content: [call('r1', 'read', { path: join(outside, 'notes.txt') })] },
        { match: 'PARENT-R', content: [call('a1', 'agent', { description: 'look', prompt: 'CHILD-R look', subagent_type: 'general', isolation: 'worktree' })] },
        { match: 'CHILD-R', content: 'looked' },
        { match: 'PARENT-R', content: 'ok' },
      ],
      { root: fixture.root, env: fixture.env },
    )
    const sessionId = await h.open()
    await h.send(sessionId, 'PARENT-R go')
    await h.stream.waitFor(() => h.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 1, 60_000)
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'r1'))).toContain('OUTSIDE')
    expect(h.entries(sessionId).filter((e) => e.kind === 'agent_start')).toHaveLength(1)
    expect((await h.reviews()).map((r) => r.actions.pending_call.tool)).toEqual(['read', 'agent'])
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'approval_decision')
        .map((e) => (e.payload as { by?: string }).by),
    ).toEqual(['reviewer', 'reviewer'])
  })

  it('不送审：允许规则覆盖的命令、Workspace 内读取、可写根内编辑；schedule_create 直接出审批请求', async () => {
    const h = await boot([
      allow(),
      {
        content: [
          bash('b1', 'printf a > a.txt'),
          call('r1', 'read', { path: 'a.txt' }),
          call('w1', 'write', { path: 'w.txt', content: 'x' }),
          call('s1', 'schedule_create', { title: 'later', prompt: 'p', every_seconds: 60 }),
        ],
      },
      { content: 'ok' },
    ])
    const sessionId = await h.open()
    expect(
      (await h.api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'allow', tool: 'Bash', content: 'printf a *' } })).status,
    ).toBe(200)
    await h.send(sessionId)
    const asked = await waitApproval(h.stream, sessionId)
    expect(asked).toMatchObject({ toolCallId: 's1', toolName: 'schedule_create' })
    await h.answer(sessionId, asked.requestId, { decision: 'deny', feedback: 'no' })
    await h.runEnds(sessionId, 1)
    expect(await readFile(join(h.root, 'w.txt'), 'utf8')).toBe('x')
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'r1'))).toContain('a')
    expect(h.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(await h.reviews()).toEqual([])
  })
})

describe('Hook 先于 Reviewer', () => {
  it('PermissionRequest Hook 给出 allow 或 deny 时没有审查请求，没有决定时有；PreToolUse Hook 的强制询问不经审查', async () => {
    const h = await boot([
      allow(),
      allow(),
      {
        content: [bash('a1', 'printf y > yes.txt'), bash('d1', 'printf n > no.txt'), bash('n1', 'printf r > reviewed.txt'), bash('k1', 'printf k > asked.txt')],
      },
      { content: 'ok' },
    ])
    const out = (body: unknown) => hookCommand('--stdout', JSON.stringify(body))
    const saved = await h.api.put(hookPaths.hooks, {
      hooks: {
        PermissionRequest: [
          { hooks: [{ type: 'command', command: out({ hookSpecificOutput: { decision: { behavior: 'allow' } } }), if: 'Bash(printf y *)' }] },
          {
            hooks: [
              { type: 'command', command: out({ hookSpecificOutput: { decision: { behavior: 'deny', message: 'not this one' } } }), if: 'Bash(printf n *)' },
            ],
          },
        ],
        PreToolUse: [
          {
            hooks: [
              { type: 'command', command: out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }), if: 'Bash(printf k *)' },
            ],
          },
        ],
      },
      expectedRevision: 0,
    })
    expect(saved.status).toBe(200)
    const sessionId = await h.open()
    await h.send(sessionId)
    const asked = await waitApproval(h.stream, sessionId, 3)
    expect(asked).toMatchObject({ toolCallId: 'k1' })
    await h.answer(sessionId, asked.requestId, { decision: 'deny', feedback: 'no' })
    await h.runEnds(sessionId, 1)
    expect(existsSync(join(h.root, 'yes.txt'))).toBe(true)
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'd1'))).toBe('Blocked by hook: not this one')
    expect(existsSync(join(h.root, 'reviewed.txt'))).toBe(true)
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'approval_decision')
        .map((e) => (e.payload as { by?: string }).by ?? 'user'),
    ).toEqual(['hook', 'reviewer', 'user'])
    expect((await h.reviews()).map((r) => r.actions.pending_call.arguments.command)).toEqual(['printf r > reviewed.txt'])
  })
})

describe('对手用例：审查应答恒为放行', () => {
  it('拒绝规则拒绝；询问规则、.git 内写入、越出可写根的写入、计划审阅都出审批请求，且没有对应的审查请求', async () => {
    const outside = await realpath(await tempDir('coko-outside-'))
    const h = await boot([
      ...Array.from({ length: 6 }, () => allow()),
      {
        content: [
          bash('x1', 'rm -f gone.txt'),
          bash('q1', 'git status'),
          call('g1', 'write', { path: '.git/config', content: 'x' }),
          call('o1', 'write', { path: join(outside, 'o.txt'), content: 'x' }),
        ],
      },
      { content: 'ok' },
      { content: [call('p1', 'exit_plan_mode', { plan: '# Fix the parser\n\n1. Read it.' })] },
      { content: 'ok' },
    ])
    await mkdir(join(h.root, '.git'), { recursive: true })
    const sessionId = await h.open()
    for (const rule of [
      { behavior: 'deny', tool: 'Bash', content: 'rm *' },
      { behavior: 'ask', tool: 'Bash', content: 'git status' },
    ])
      expect((await h.api.post(permissionPaths.sessionPermissionRules(sessionId), { rule })).status).toBe(200)
    await h.send(sessionId)
    for (const [n, id] of [
      [1, 'q1'],
      [2, 'g1'],
      [3, 'o1'],
    ] as const) {
      const asked = await waitApproval(h.stream, sessionId, n)
      expect(asked.toolCallId).toBe(id)
      await h.answer(sessionId, asked.requestId, { decision: 'deny', feedback: 'no' })
    }
    await h.runEnds(sessionId, 1)
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'x1'))).toBe('Permission denied by rule Bash(rm *).')
    expect(existsSync(join(outside, 'o.txt'))).toBe(false)

    const plan = await h.open('auto-review', true)
    await h.send(plan)
    const review = await waitApproval(h.stream, plan)
    expect(review).toMatchObject({ toolCallId: 'p1', kind: 'plan' })
    await h.answer(plan, review.requestId, { decision: 'deny', feedback: 'not yet' })
    await h.runEnds(plan, 1)
    expect(await h.reviews()).toEqual([])
  })

  it.skipIf(!darwin)('审查放行的越界写入命令被 Seatbelt 拒绝；带提权参数的重试出 Escalation 卡且不送审', async () => {
    const outside = await realpath(await tempDir('coko-outside-'))
    const escalated = { sandbox_permissions: 'danger-full-access', justification: 'outside the workspace' }
    const h = await boot([
      ...Array.from({ length: 3 }, () => allow()),
      { content: [bash('p0', `printf 1 >> ${outside}/f`)] },
      { content: [bash('e1', `printf 1 >> ${outside}/f`, escalated)] },
      { content: 'ok' },
    ])
    const sessionId = await h.open()
    await h.send(sessionId)
    // 第一条请求是 p0 经 Reviewer 放行时提交的。
    const escalation = await waitApproval(h.stream, sessionId, 2)
    expect(escalation).toMatchObject({ toolCallId: 'e1', kind: 'escalation', targetMode: 'danger-full-access' })
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'p0'))).toContain('[sandbox: file access denied under workspace-write mode]')
    await h.answer(sessionId, escalation.requestId, { decision: 'deny', feedback: 'no' })
    await h.runEnds(sessionId, 1)
    expect(existsSync(join(outside, 'f'))).toBe(false)
    expect((await h.reviews()).map((r) => r.actions.pending_call.arguments)).toEqual([{ command: `printf 1 >> ${outside}/f` }])
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'approval_decision')
        .map((e) => (e.payload as { by?: string }).by ?? 'user'),
    ).toEqual(['reviewer', 'user'])
  })
})

describe('Goal、定时任务与预算', () => {
  type Goal = { phase: string; reason?: { code: string; message: string } }
  const usage = (input: number, output: number) => ({ usage: { input, output } })
  const goalOf = async (h: Awaited<ReturnType<typeof boot>>, sessionId: string) =>
    (await h.api.get(goalPaths.sessionGoal(sessionId))).body as { goal: Goal; usage: { rounds: number; toolCalls: number; tokens: number; cost: number } }
  const reviewRequests = (h: Awaited<ReturnType<typeof boot>>, sessionId: string) =>
    h.entries(sessionId).filter((e) => e.kind === 'model_request' && (e.payload as { purpose: string }).purpose === 'review')

  it('审查请求（含失败的）的用量计入 Goal 的 Token 与费用、Run 与 Session 合计，不计轮次与工具调用；预算耗尽后不发审查请求、转交用户，允许后执行且 Run 因预算暂停', async () => {
    // 每百万 token：输入 2、输出 10。审查请求以错误结束但报告了 400 输入 + 100 输出。
    const h = await boot(
      [
        { match: MARKER, content: [], stopReason: 'error', errorMessage: 'overloaded', ...usage(400, 100) },
        { content: [call('cg', 'create_goal', { objective: 'write files', criteria: ['done'], budget: { max_tokens: 1000 } })], ...usage(10, 1) },
        { content: 'goal set', ...usage(10, 1) },
        { content: [bash('b1', 'printf a > a.txt')], ...usage(10, 1) },
        { content: [bash('b2', 'printf b > b.txt')], ...usage(400, 100) },
        { content: 'must not be requested', ...usage(10, 1) },
      ],
      { script: { price: { input: 2, output: 10 } } },
    )
    const sessionId = await h.open()
    await h.send(sessionId, 'write the files')
    // b1：审查失败而转交；允许后执行。
    const first = await waitApproval(h.stream, sessionId, 1)
    expect(first).toMatchObject({ toolCallId: 'b1' })
    expect((await h.answer(sessionId, first.requestId, { decision: 'allow' })).status).toBe(204)
    // b2：Goal 已用 11 + 500（审查）+ 500 = 1011 ≥ 1000，请求前检查不通过：不发审查请求，直接转交用户，调用未执行。
    const second = await waitApproval(h.stream, sessionId, 2)
    expect(second).toMatchObject({ toolCallId: 'b2' })
    expect(existsSync(join(h.root, 'b.txt'))).toBe(false)
    expect((await h.api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ activity: 'awaiting-approval' })
    expect(await h.reviews()).toHaveLength(1)
    expect(reviewRequests(h, sessionId)).toHaveLength(1)
    expect(reviewRequests(h, sessionId)[0]!.payload).toMatchObject({ stopReason: 'error', usage: { input: 400, output: 100 } })
    expect((await goalOf(h, sessionId)).usage).toMatchObject({ rounds: 1, toolCalls: 1, tokens: 1011 })

    expect((await h.answer(sessionId, second.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(sessionId, 2)
    expect(await readFile(join(h.root, 'b.txt'), 'utf8')).toBe('b')
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'run_end')
        .at(-1)!.payload,
    ).toEqual({ status: 'paused', error: { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens (1011 / 1000)' } })
    await h.stream.waitFor(() => h.entries(sessionId).some((e) => e.kind === 'goal' && (e.payload as Goal).phase === 'budget-exhausted'))
    const state = await goalOf(h, sessionId)
    expect(state.goal).toMatchObject({ phase: 'budget-exhausted', reason: { code: 'tokens' } })
    // 轮次与工具调用数不含审查请求；费用含审查请求：(11 × 2 + … ) / 1e6。
    expect(state.usage).toMatchObject({ rounds: 1, toolCalls: 2, tokens: 1011 })
    const cost = (input: number, output: number) => (input * 2 + output * 10) / 1e6
    expect(state.usage.cost).toBeCloseTo(cost(10, 1) + cost(400, 100) + cost(400, 100), 12)
    expect(await h.reviews()).toHaveLength(1)

    const trace = (await h.api.get(tracePaths.trace(sessionId))).body as TraceResponse
    const round = trace.runs[1]!
    expect(round.requests.map((r) => r.purpose)).toEqual(['turn', 'review', 'turn'])
    expect(round.tokens).toBe(1011)
    expect(round.cost).toBeCloseTo(state.usage.cost, 12)
    expect(trace.totals.cost).toBeCloseTo(2 * cost(10, 1) + state.usage.cost, 12)
    expect(h.stream.invalidEntries).toEqual([])
  })

  it('Goal Round：Reviewer 放行的调用执行；被转交的调用使 Session 等待审批、Goal 仍为 running（与现有审批等待相同），允许后 Goal 继续直到完成', async () => {
    const h = await boot([
      allow(),
      escalate(),
      { content: [call('cg', 'create_goal', { objective: 'write files', criteria: ['done'] })] },
      { content: 'goal set' },
      { content: [bash('b1', 'printf a > a.txt')] },
      { content: [bash('b2', 'printf b > b.txt')] },
      { content: [call('u1', 'update_goal', { goal_id: 'goal-1', revision: 1, action: 'complete', evidence: [{ criterion_id: 'c1', text: 'written' }] })] },
      { content: 'all done' },
    ])
    const sessionId = await h.open()
    await h.send(sessionId, 'write the files')
    const asked = await waitApproval(h.stream, sessionId, 2)
    expect(asked).toMatchObject({ toolCallId: 'b2' })
    expect(await readFile(join(h.root, 'a.txt'), 'utf8')).toBe('a')
    expect(existsSync(join(h.root, 'b.txt'))).toBe(false)
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'run_start')
        .at(-1)!.payload,
    ).toEqual({ trigger: 'goal', goal: { goalId: 'goal-1', round: 1 } })
    expect((await h.api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ running: true, activity: 'awaiting-approval' })
    expect((await goalOf(h, sessionId)).goal.phase).toBe('running')

    expect((await h.answer(sessionId, asked.requestId, { decision: 'allow' })).status).toBe(204)
    await h.stream.waitFor(() => h.entries(sessionId).some((e) => e.kind === 'goal' && (e.payload as Goal).phase === 'complete'))
    await h.runEnds(sessionId, 2)
    expect(await readFile(join(h.root, 'b.txt'), 'utf8')).toBe('b')
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'goal')
        .map((e) => (e.payload as Goal).phase),
    ).toEqual(['running', 'complete'])
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'approval_decision')
        .map((e) => (e.payload as { by?: string }).by ?? 'user'),
    ).toEqual(['reviewer', 'user'])
    expect((await h.reviews()).map((r) => r.actions.pending_call.arguments.command)).toEqual(['printf a > a.txt', 'printf b > b.txt'])
  })

  it('定时任务触发的 Run：未被规则覆盖的命令有审查请求、放行后执行；schedule_create 不送审，允许后仍为 schedule-not-allowed', async () => {
    const h = await boot(
      [
        allow(),
        { content: [bash('b1', 'printf s > s.txt'), call('sc', 'schedule_create', { title: 'more', prompt: 'again', every_seconds: 60 })] },
        { content: 'done' },
      ],
      { env: { COKO_TEST_CLOCK: '1' } },
    )
    const sessionId = await h.open()
    const created = await h.api.post(schedulePaths.sessionSchedules(sessionId), {
      title: 'nightly',
      prompt: 'write s.txt',
      rule: { kind: 'after', seconds: 60 },
    })
    expect(created.status).toBe(201)
    await advanceClock(h.api, 60_000)
    const asked = await waitApproval(h.stream, sessionId, 2)
    expect(asked).toMatchObject({ toolCallId: 'sc', toolName: 'schedule_create' })
    await h.answer(sessionId, asked.requestId, { decision: 'allow' })
    await h.runEnds(sessionId, 1)
    expect(h.entries(sessionId).find((e) => e.kind === 'run_start')!.payload).toMatchObject({ trigger: 'schedule', schedule: { scheduleId: created.body.id } })
    expect(await readFile(join(h.root, 's.txt'), 'utf8')).toBe('s')
    expect(text(toolResults(h.entries(sessionId)).find((r) => r.toolCallId === 'sc'))).toMatch(/^schedule-not-allowed: /)
    expect((await h.api.get(schedulePaths.list(sessionId))).body).toHaveLength(1)
    const reviews = await h.reviews()
    expect(reviews.map((r) => r.actions.pending_call)).toEqual([{ tool: 'bash', arguments: { command: 'printf s > s.txt' } }])
    // 定时任务的 prompt 不授予用户权限。
    expect(reviews[0]!.user_authorization.user_messages).toEqual([])
    expect(
      h
        .entries(sessionId)
        .filter((e) => e.kind === 'approval_decision')
        .map((e) => (e.payload as { by?: string }).by ?? 'user'),
    ).toEqual(['reviewer', 'user'])
  })
})

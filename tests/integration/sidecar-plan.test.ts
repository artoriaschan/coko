// Plan Mode（ADR 0005）：真实 Sidecar（faux 模型）经协议驱动 /plan 进入、plan 中的限制（写入询问、命令只读沙箱）、exit_plan_mode 的提交与审阅
// （编辑后批准、带反馈继续规划、批准为 accept-edits）、回答的校验、/plan off 与模式菜单退出、压缩后的 <approved_plan> 与分叉。
// 本票不新增文件读取（没有读取根或注入点涉及路径），不需要符号链接越界用例。
import { access, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'
type Logged = { role: string; content: unknown; sections?: Record<string, string> }[]
type ToolResult = { toolCallId: string; isError: boolean; content: { text?: string }[]; details?: unknown }

const call = (name: string, id: string, args: Record<string, unknown>) => ({ content: [{ type: 'toolCall', name, id, arguments: args }] })
const exit = (id: string, plan: string) => call('exit_plan_mode', id, { plan })
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const text = (r: ToolResult) => r.content.map((b) => b.text ?? '').join('')

async function boot(responses: unknown[], extra: Record<string, unknown> = {}) {
  const root = await realpath(await tempDir())
  const requestLog = join(root, '.requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses, ...extra }, '.faux.json')
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const open = async () => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const sessionId = await open()
  const entries = (id = sessionId) => stream.entries(id)
  const runEnds = (n: number, id = sessionId) => stream.waitFor(() => entries(id).filter((e) => e.kind === 'run_end').length >= n, 30_000)
  const results = (id = sessionId) =>
    entries(id)
      .filter((e) => kindOf(e) === 'toolResult')
      .map((e) => e.payload as ToolResult)
  const resultOf = async (toolCallId: string, id = sessionId) => {
    await stream.waitFor(() => results(id).some((r) => r.toolCallId === toolCallId), 30_000)
    return results(id).find((r) => r.toolCallId === toolCallId)!
  }
  const plans = (id = sessionId) =>
    entries(id)
      .filter((e) => e.kind === 'plan')
      .map((e) => e.payload as { planId: string; revision: number; markdown: string; status: string; feedback?: string })
  const modes = (id = sessionId) =>
    entries(id)
      .filter((e) => e.kind === 'permission_mode')
      .map((e) => e.payload)
  const requests = async (): Promise<Logged[]> =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Logged)
  const sections = (logged: Logged) =>
    logged.filter((m) => m.role === 'system').flatMap((m) => Object.entries(m.sections ?? {}).map(([name, text]) => ({ name, text })))
  const answer = (requestId: string, body: unknown, id = sessionId) => api.post(apiPaths.sessionApproval(id, requestId), body)
  return { root, sidecar, api, stream, sessionId, open, entries, runEnds, results, resultOf, plans, modes, requests, sections, answer }
}

const PLAN = '# Fix the parser\n\n1. Read src/parse.ts\n2. Add a test'
const EDITED = '# Fix the parser\n\n1. Add a test first\n2. Then fix src/parse.ts'

describe('Plan Mode', { timeout: 120_000 }, () => {
  it('/plan 进入（prior = default）→ <plan_mode> → 写入询问、命令只读沙箱 → exit_plan_mode 提交 → 编辑后批准：新 revision、default、结果含编辑后的计划、Run 继续', async () => {
    const h = await boot([
      call('write', 'w1', { path: 'notes.md', content: 'x' }),
      call('bash', 'b1', { command: 'echo hi > touched.txt' }),
      exit('e1', PLAN),
      { content: 'implementing now' },
    ])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan 调研 X' })).status).toBe(202)
    expect(h.modes().at(-1)).toEqual({ mode: 'plan', prior: 'default' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'plan', prior: 'default', rules: [] })

    const write = await waitApproval(h.stream, h.sessionId, 1)
    expect(write).toMatchObject({ kind: 'tool', toolName: 'write' })
    expect((await h.answer(write.requestId, { decision: 'deny', feedback: 'no writes while planning' })).status).toBe(204)
    const bash = await waitApproval(h.stream, h.sessionId, 2)
    expect(bash).toMatchObject({ kind: 'tool', toolName: 'bash' })
    expect((await h.answer(bash.requestId, { decision: 'allow' })).status).toBe(204)
    const bashResult = await h.resultOf('b1')
    expect(bashResult.isError).toBe(true)
    // darwin：Seatbelt 以只读档位拒绝写入；其他平台没有 sandbox-exec，受限档位的命令 fail-closed（ADR 0005）。
    expect(text(bashResult)).toContain(darwin ? '[sandbox: file access denied under read-only mode]' : 'sandbox-unavailable')
    expect(bashResult.details).toMatchObject(darwin ? { sandbox: { mode: 'read-only', denied: true } } : {})
    expect(
      await access(join(h.root, 'touched.txt')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)

    const review = await waitApproval(h.stream, h.sessionId, 3)
    expect(review).toMatchObject({ kind: 'plan', toolName: 'exit_plan_mode', subject: 'Fix the parser', suggestions: [] })
    const proposed = h.plans()
    expect(proposed).toEqual([{ planId: expect.any(String), revision: 1, markdown: PLAN, status: 'proposed' }])
    expect(review).toMatchObject({ planId: proposed[0]!.planId, revision: 1 })

    // 回答的校验：mode 不能是 full-access，editedPlan 须以 # 标题开头，只能允许一次；都不改变请求。
    for (const body of [
      { decision: 'allow', mode: 'full-access' },
      { decision: 'allow', mode: 'plan' },
      { decision: 'allow', editedPlan: 'no heading' },
      { decision: 'allow', scope: 'session' },
    ])
      expect([body, (await h.answer(review.requestId, body)).status]).toEqual([body, 400])
    expect((await h.answer(review.requestId, { decision: 'allow', editedPlan: EDITED })).status).toBe(204)
    await h.runEnds(1)

    expect(h.plans().map((p) => [p.revision, p.status, p.markdown])).toEqual([
      [1, 'proposed', PLAN],
      [2, 'approved', EDITED],
    ])
    expect(h.modes().at(-1)).toEqual({ mode: 'default' })
    const approved = await h.resultOf('e1')
    expect(approved.isError).toBe(false)
    expect(text(approved)).toBe(`The user approved the plan. Proceed under default.\n\n${EDITED}`)
    expect(h.entries().at(-1)!.payload).toMatchObject({ status: 'completed' })
    // 顺序：proposed → 审批请求 → 决定 → approved → 恢复的模式 → 工具结果。
    const order = h.entries().filter((e) => ['approval_request', 'approval_decision', 'plan', 'permission_mode'].includes(e.kind) || kindOf(e) === 'toolResult')
    expect(order.slice(-6).map(kindOf)).toEqual(['plan', 'approval_request', 'approval_decision', 'plan', 'permission_mode', 'toolResult'])

    // 发给模型的请求：plan 模式的 Run 带 <plan_mode>，模型看到了 exit_plan_mode 的结果并继续。
    const logged = await h.requests()
    expect(logged).toHaveLength(4)
    for (const request of logged) expect(h.sections(request).map((s) => s.name)).toContain('plan_mode')
    expect(h.sections(logged[0]!).find((s) => s.name === 'plan_mode')!.text).toContain('exit_plan_mode')
    expect(JSON.stringify(logged[3]!.at(-1))).toContain('The user approved the plan. Proceed under default.')
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('带反馈拒绝 → rejected 与反馈、Run 继续规划；再次提交为同一计划的新 revision；从 accept-edits 进入后批准回到 accept-edits；editedPlan 不能用于工具审批', async () => {
    const h = await boot([
      call('bash', 'b0', { command: 'ls' }),
      { content: 'listed' },
      exit('e1', '# One'),
      exit('e2', '# Two'),
      { content: 'going' },
      { content: 'next run' },
    ])
    // 普通工具审批不接受 editedPlan 与 mode。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'look' })).status).toBe(202)
    const tool = await waitApproval(h.stream, h.sessionId, 1)
    expect((await h.answer(tool.requestId, { decision: 'allow', editedPlan: '# X' })).status).toBe(400)
    expect((await h.answer(tool.requestId, { decision: 'allow', mode: 'default' })).status).toBe(400)
    expect((await h.answer(tool.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)

    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })).status).toBe(200)
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'plan' })).body).toEqual({
      mode: 'plan',
      prior: 'accept-edits',
      rules: [],
    })
    // 已在 plan 时再进入不改 prior。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan' })).status).toBe(204)
    expect(h.modes().at(-1)).toEqual({ mode: 'plan', prior: 'accept-edits' })
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'plan it' })).status).toBe(202)

    const first = await waitApproval(h.stream, h.sessionId, 2)
    expect(first).toMatchObject({ kind: 'plan', revision: 1 })
    expect((await h.answer(first.requestId, { decision: 'deny', feedback: 'add tests' })).status).toBe(204)
    expect(text(await h.resultOf('e1'))).toContain('The user did not approve the plan and said:\nadd tests')
    const second = await waitApproval(h.stream, h.sessionId, 3)
    expect(second).toMatchObject({ kind: 'plan', planId: first.planId, revision: 2, subject: 'Two' })
    expect((await h.answer(second.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(2)
    expect(h.plans().map((p) => [p.planId === first.planId, p.revision, p.status, p.feedback])).toEqual([
      [true, 1, 'proposed', undefined],
      [true, 1, 'rejected', 'add tests'],
      [true, 2, 'proposed', undefined],
      [true, 2, 'approved', undefined],
    ])
    expect(h.modes().at(-1)).toEqual({ mode: 'accept-edits' })
    expect(text(await h.resultOf('e2'))).toBe('The user approved the plan. Proceed under accept-edits.\n\n# Two')
    expect(
      h
        .entries()
        .filter((e) => e.kind === 'run_end')
        .map((e) => (e.payload as { status: string }).status),
    ).toEqual(['completed', 'completed'])

    // 不在 plan 时的 Run 没有 <plan_mode>，也没有 exit_plan_mode。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go on' })).status).toBe(202)
    await h.runEnds(3)
    const logged = await h.requests()
    expect(h.sections(logged.at(-1)!).map((s) => s.name)).not.toContain('plan_mode')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/plan off 与模式菜单回到 prior；/plan 带消息时随后提交；approval 批准时指定 accept-edits', async () => {
    const h = await boot([exit('e1', '# Plan A'), { content: 'done' }])
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'read-only' })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan' })).status).toBe(204)
    expect(h.modes().at(-1)).toEqual({ mode: 'plan', prior: 'read-only' })
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan off' })).status).toBe(204)
    expect(h.modes().at(-1)).toEqual({ mode: 'read-only' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'read-only', rules: [] })
    // /plan off 不在 plan 时不提交条目；动作都不产生 user message。
    const before = h.modes().length
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan off' })).status).toBe(204)
    expect(h.modes()).toHaveLength(before)

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan draft a plan for Y' })).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    const users = h
      .entries()
      .filter((e) => kindOf(e) === 'user')
      .map((e) => JSON.stringify(e.payload))
    expect(users).toHaveLength(1)
    expect(users[0]).toContain('draft a plan for Y')
    expect((await h.answer(review.requestId, { decision: 'allow', mode: 'accept-edits' })).status).toBe(204)
    await h.runEnds(1)
    expect(h.modes().at(-1)).toEqual({ mode: 'accept-edits' })
    expect(text(await h.resultOf('e1'))).toContain('Proceed under accept-edits.')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('压缩把已批准计划摘要掉后注入 <approved_plan>；分叉 plan 模式的 Session：仍为 plan（permission_mode 被复制），没有 plan 条目', async () => {
    // Run 1：提交并批准（两次请求）；Run 2–4 建立历史；/compact 的摘要；Run 6；Run 7 在 plan 中再次提交后停止。
    const h = await boot(
      [
        exit('e1', PLAN),
        { content: 'ok1' },
        { content: 'ok2' },
        { content: 'ok3' },
        { content: 'ok4' },
        { content: 'summary of everything' },
        { content: 'after' },
        exit('e2', '# Draft'),
        { content: 'still planning' },
      ],
      { contextWindow: 200_000 },
    )
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan make a plan' })
    await h.answer((await waitApproval(h.stream, h.sessionId, 1)).requestId, { decision: 'allow' })
    await h.runEnds(1)
    for (const [n, t] of [
      [2, 'a'.repeat(40_000)],
      [3, 'b'.repeat(40_000)],
      [4, 'c'.repeat(40_000)],
    ] as const) {
      await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: t })
      await h.runEnds(n)
    }
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/compact' })).status).toBe(202)
    await h.runEnds(5)
    const compaction = h.entries().find((e) => e.kind === 'compaction')
    expect(compaction).toBeDefined()
    const approvedSeq = h.entries().find((e) => e.kind === 'plan' && (e.payload as { status: string }).status === 'approved')!.seq
    expect(approvedSeq).toBeLessThan((compaction!.payload as { firstKeptSeq: number }).firstKeptSeq)
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'continue' })
    await h.runEnds(6)
    const logged = await h.requests()
    const injected = h.sections(logged.at(-1)!).find((s) => s.name === 'approved_plan')
    expect(injected?.text).toContain('<approved_plan>')
    expect(injected?.text).toContain(PLAN)
    // 压缩之前的请求没有 <approved_plan>（计划仍在上下文中）。
    expect(h.sections(logged[1]!).map((s) => s.name)).not.toContain('approved_plan')

    // 再进入 plan 并提交一份（不批准就停止），之后在 plan 中再发一条消息，以它为分叉目标：plan 条目在目标之前，但不随分叉复制。
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan draft' })
    await waitApproval(h.stream, h.sessionId, 2)
    await h.api.post(apiPaths.sessionAbort(h.sessionId))
    await h.runEnds(7)
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'more research' })
    await h.runEnds(8)
    const target = h
      .entries()
      .filter((e) => kindOf(e) === 'user')
      .at(-1)!.seq
    expect(h.entries().some((e) => e.kind === 'plan' && e.seq < target && (e.payload as { markdown: string }).markdown === '# Draft')).toBe(true)
    const forked = await h.api.post(checkpointPaths.sessionFork(h.sessionId), { targetSeq: target })
    expect(forked.status).toBe(201)
    const forkId = forked.body.sessionId as string
    const detail = (await h.api.get(apiPaths.session(forkId))).body.entries as SessionEntryRecord[]
    expect(detail.filter((e) => e.kind === 'plan')).toEqual([])
    expect(detail.filter((e) => e.kind === 'permission_mode').at(-1)!.payload).toEqual({ mode: 'plan', prior: 'default' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(forkId))).body).toEqual({ mode: 'plan', prior: 'default', rules: [] })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

// Plan Mode（ADR 0005、ADR 0028）：真实 Sidecar（faux 模型）经协议驱动 /plan 与计划接口进入和退出（不改变 Permission Mode）、规划中的约束（写入拒绝、命令只读
// 沙箱且不能提权，其余调用按当前模式）、Run 中途进入与退出、exit_plan_mode 的提交与审阅（编辑后批准、带反馈继续规划，批准只结束规划）、回答的校验、压缩后的
// <approved_plan> 与分叉。
// 本票不新增文件读取（没有读取根或注入点涉及路径），不需要符号链接越界用例。
import { access, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCurrentTools, type Context } from '@earendil-works/pi-ai'
import { API_ROUTES, apiPaths, checkpointPaths, permissionPaths, planPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval as waitRequest, type Stream } from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'
type Logged = { role: string; content: unknown; sections?: Record<string, string> }[]
type ToolResult = { toolCallId: string; isError: boolean; content: { text?: string }[]; details?: unknown }

const call = (name: string, id: string, args: Record<string, unknown>) => ({ content: [{ type: 'toolCall', name, id, arguments: args }] })
const exit = (id: string, plan: string) => call('exit_plan_mode', id, { plan })
/** approval_request 的 payload（kind plan 另带 planId 与 revision）。 */
const waitApproval = async (stream: Stream, sessionId: string, n = 1) =>
  (await waitRequest(stream, sessionId, n)) as Awaited<ReturnType<typeof waitRequest>> & { planId?: string; revision?: number }
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const text = (r: ToolResult) => r.content.map((b) => b.text ?? '').join('')

async function boot(responses: unknown[], extra: Record<string, unknown> = {}) {
  const root = await realpath(await tempDir())
  const requestLog = join(root, '.requests.jsonl')
  const detailsLog = join(root, '.request-details.jsonl')
  await writeFile(requestLog, '')
  await writeFile(detailsLog, '')
  const script = await fauxScript(root, { requestLog, requestDetailsLog: detailsLog, responses, ...extra }, '.faux.json')
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
  /** 每次带工具的模型请求注册的工具名（faux 的 requestDetailsLog；标题请求不带工具，不计入）。 */
  const tools = async (): Promise<string[][]> =>
    (await readFile(detailsLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => (getCurrentTools((JSON.parse(line) as Context).messages) ?? []).map((tool) => tool.name))
      .filter((names) => names.length > 0)
  const sections = (logged: Logged) =>
    logged.filter((m) => m.role === 'system').flatMap((m) => Object.entries(m.sections ?? {}).map(([name, text]) => ({ name, text })))
  const answer = (requestId: string, body: unknown, id = sessionId) => api.post(apiPaths.sessionApproval(id, requestId), body)
  return { root, sidecar, api, stream, sessionId, open, entries, runEnds, results, resultOf, plans, modes, requests, tools, sections, answer }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
/** 模型可见文本（设计稿 T1 最终版、T3、T4、T5、T7）。 */
const PLAN_MODE_T1 = [
  '<plan_mode>',
  'Plan mode is active. Research and design only: the user reviews your plan before anything in the Workspace changes.',
  '- File writes (write, edit) are refused while planning. Put the changes you intend to make in the plan instead.',
  '- Commands run in a read-only sandbox and cannot be escalated; a command that writes files fails.',
  "- Other calls (reads, searches, MCP tools, memory, todo and goal tools) follow the session's current permission mode.",
  'When the plan is ready, call exit_plan_mode with the complete plan as Markdown starting with a # heading. If the user sends feedback, keep planning and submit a revised plan. Once the user approves, plan mode ends and the tool result tells you how to proceed.',
  '</plan_mode>',
].join('\n')
const PLANNING_WRITE_REFUSED =
  'Refused: plan mode is active, so file writes are blocked until the user approves a plan. Do not retry or work around this; describe the intended change in the plan (or in your report to the parent agent) instead.'
const PLANNING_ESCALATION_REFUSED =
  'invalid escalation: plan mode is active, so commands run in a read-only sandbox and cannot be escalated. Do not retry; describe the step that needs write access in the plan instead.'
const PLANNING_SANDBOX_MARKER = '[sandbox: escalation is not available in plan mode]'
const APPROVED_T7 = (markdown: string) =>
  `The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan.\n\n${markdown}`

const PLAN = '# Fix the parser\n\n1. Read src/parse.ts\n2. Add a test'
const EDITED = '# Fix the parser\n\n1. Add a test first\n2. Then fix src/parse.ts'

describe('Plan Mode', { timeout: 120_000 }, () => {
  it('规划中的约束是硬性的：允许规则不能放行写入（文件逐字节不变、无审批）；被放行的写文件命令因只读沙箱失败；提权参数直接出错不询问', async () => {
    const h = await boot([
      call('edit', 'w1', { path: 'keep.txt', edits: [{ oldText: 'original', newText: 'changed' }] }),
      call('write', 'w2', { path: 'new.txt', content: 'x' }),
      call('bash', 'b1', { command: 'echo hi > touched.txt' }),
      call('bash', 'b2', { command: 'echo hi > touched.txt', sandbox_permissions: 'workspace-write', justification: 'write the file' }),
      { content: 'planning only' },
    ])
    await writeFile(join(h.root, 'keep.txt'), 'original\n')
    for (const rule of [
      { behavior: 'allow', tool: 'Edit' },
      { behavior: 'allow', tool: 'Bash' },
    ])
      expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan 调研 X' })).status).toBe(202)
    await h.runEnds(1)

    expect(text(await h.resultOf('w1'))).toBe(PLANNING_WRITE_REFUSED)
    expect(text(await h.resultOf('w2'))).toBe(PLANNING_WRITE_REFUSED)
    expect(await readFile(join(h.root, 'keep.txt'), 'utf8')).toBe('original\n')
    expect(await exists(join(h.root, 'new.txt'))).toBe(false)
    const b1 = await h.resultOf('b1')
    expect(b1.isError).toBe(true)
    // darwin：Seatbelt 以只读档位拒绝写入；其他平台没有 sandbox-exec，受限档位的命令 fail-closed（ADR 0005）。
    expect(text(b1)).toContain(darwin ? `[sandbox: file access denied under read-only mode]\n${PLANNING_SANDBOX_MARKER}` : 'sandbox-unavailable')
    expect([(await h.resultOf('b2')).isError, text(await h.resultOf('b2'))]).toEqual([true, PLANNING_ESCALATION_REFUSED])
    expect(await exists(join(h.root, 'touched.txt'))).toBe(false)
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toEqual([])
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/plan 进入不改变模式（default 读回不变）→ <plan_mode> 最终版 → 写入拒绝；命令按 default 询问、只读沙箱 → exit_plan_mode 提交 → 带 mode 的批准 400 → 编辑后批准：新 revision、不提交 permission_mode、T7、Run 继续', async () => {
    const h = await boot([
      call('write', 'w1', { path: 'notes.md', content: 'x' }),
      call('bash', 'b1', { command: 'echo hi > touched.txt' }),
      exit('e1', PLAN),
      { content: 'implementing now' },
    ])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan 调研 X' })).status).toBe(202)
    // 票 04（ADR 0028）起进入规划不提交 permission_mode：只有创建时的初始模式（原先断言切到 plan 并记下 prior）。
    expect(h.modes()).toEqual([{ mode: 'default' }])
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'default', rules: [] })
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'planning', plan: null })

    const write = await h.resultOf('w1')
    expect([write.isError, text(write)]).toEqual([true, PLANNING_WRITE_REFUSED])
    expect(await exists(join(h.root, 'notes.md'))).toBe(false)
    // 命令按当前 Permission Mode（default）询问，与未规划时相同。
    const bash = await waitApproval(h.stream, h.sessionId, 1)
    expect(bash).toMatchObject({ kind: 'tool', toolName: 'bash' })
    expect((await h.answer(bash.requestId, { decision: 'allow' })).status).toBe(204)
    const bashResult = await h.resultOf('b1')
    expect(bashResult.isError).toBe(true)
    // darwin：Seatbelt 以只读档位拒绝写入；其他平台没有 sandbox-exec，受限档位的命令 fail-closed（ADR 0005）。
    expect(text(bashResult)).toContain(darwin ? `[sandbox: file access denied under read-only mode]\n${PLANNING_SANDBOX_MARKER}` : 'sandbox-unavailable')
    expect(text(bashResult)).not.toContain('escalation available')
    expect(bashResult.details).toMatchObject(darwin ? { sandbox: { mode: 'read-only', denied: true } } : {})
    expect(await exists(join(h.root, 'touched.txt'))).toBe(false)

    const review = await waitApproval(h.stream, h.sessionId, 2)
    expect(review).toMatchObject({ kind: 'plan', toolName: 'exit_plan_mode', subject: 'Fix the parser', suggestions: [] })
    const proposed = h.plans()
    expect(proposed).toEqual([{ planId: expect.any(String), revision: 1, markdown: PLAN, status: 'proposed' }])
    expect(review).toMatchObject({ planId: proposed[0]!.planId, revision: 1 })

    // 回答的校验：批准不再接受 mode（票 04），editedPlan 须以 # 标题开头，只能允许一次；都不改变请求。
    for (const body of [
      { decision: 'allow', mode: 'full-access' },
      { decision: 'allow', mode: 'plan' },
      { decision: 'allow', mode: 'default' },
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
    // 批准只结束规划，不恢复也不改变模式（原先断言回到 prior）。
    expect(h.modes()).toEqual([{ mode: 'default' }])
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'default', rules: [] })
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'none', plan: null })
    const approved = await h.resultOf('e1')
    expect(approved.isError).toBe(false)
    expect(text(approved)).toBe(APPROVED_T7(EDITED))
    expect(h.entries().at(-1)!.payload).toMatchObject({ status: 'completed' })
    // 顺序：proposed → 审批请求 → 决定 → 工具执行 → approved → 计划阶段“无” → 工具结果；没有 permission_mode。
    const order = h
      .entries()
      .filter(
        (e) => ['approval_request', 'approval_decision', 'tool_exec', 'plan', 'plan_phase', 'permission_mode'].includes(e.kind) || kindOf(e) === 'toolResult',
      )
    expect(order.slice(-7).map(kindOf)).toEqual(['plan', 'approval_request', 'approval_decision', 'tool_exec', 'plan', 'plan_phase', 'toolResult'])

    // 发给模型的请求：规划中开始的 Run 带 <plan_mode>（最终版），模型看到了 exit_plan_mode 的结果并继续。
    const logged = await h.requests()
    expect(logged).toHaveLength(4)
    for (const request of logged) expect(h.sections(request).map((s) => s.name)).toContain('plan_mode')
    expect(h.sections(logged[0]!).find((s) => s.name === 'plan_mode')!.text).toBe(PLAN_MODE_T1)
    expect(JSON.stringify(logged[3]!.at(-1))).toContain('carry out the plan.')
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('完全访问权限下规划：命令不逐条询问（只读沙箱）、计划审阅仍询问；批准后模式仍为 full-access', async () => {
    const h = await boot([call('bash', 'b1', { command: 'ls' }), call('bash', 'b2', { command: 'echo hi > touched.txt' }), exit('e1', PLAN), { content: 'go' }])
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'full-access' })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan look around' })).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    expect(review).toMatchObject({ kind: 'plan' })
    expect((await h.resultOf('b1')).isError).toBe(false)
    const b2 = await h.resultOf('b2')
    expect(b2.isError).toBe(true)
    expect(text(b2)).toContain(darwin ? `[sandbox: file access denied under read-only mode]\n${PLANNING_SANDBOX_MARKER}` : 'sandbox-unavailable')
    expect(await exists(join(h.root, 'touched.txt'))).toBe(false)
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(h.modes().at(-1)).toEqual({ mode: 'full-access' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'full-access', rules: [] })
    expect(text(await h.resultOf('e1'))).toBe(APPROVED_T7(PLAN))
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('带反馈拒绝 → rejected 与反馈、Run 继续规划；再次提交为同一计划的新 revision；accept-edits 下进入与批准模式都不变；切换接口拒绝 plan；editedPlan 与 mode 不能用于工具审批', async () => {
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
    // 切换 Permission Mode 的接口不再接受 plan（票 04）：400，模式不变。
    const refused = await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'plan' })
    expect([refused.status, refused.body.error?.code]).toEqual([400, 'bad-request'])
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'enter' })).body).toEqual({ phase: 'planning', plan: null })
    // 已在规划中时再进入不提交；模式仍为 accept-edits（原先断言为 plan 且 prior = accept-edits）。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan' })).status).toBe(204)
    expect(h.entries().filter((e) => e.kind === 'plan_phase')).toHaveLength(1)
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'accept-edits', rules: [] })
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
    expect(h.modes()).toEqual([{ mode: 'default' }, { mode: 'accept-edits' }])
    expect(text(await h.resultOf('e2'))).toBe(APPROVED_T7('# Two'))
    expect(
      h
        .entries()
        .filter((e) => e.kind === 'run_end')
        .map((e) => (e.payload as { status: string }).status),
    ).toEqual(['completed', 'completed'])

    // 不在规划中的 Run 没有 <plan_mode>，也没有 exit_plan_mode。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go on' })).status).toBe(202)
    await h.runEnds(3)
    const logged = await h.requests()
    expect(h.sections(logged.at(-1)!).map((s) => s.name)).not.toContain('plan_mode')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/plan off 与计划接口退出不改模式；规划中切换模式不退出规划；审阅等待中退出规划后批准不再提交阶段条目；Run 进行中 /plan 为 409、计划接口照常可用', async () => {
    const h = await boot([exit('e1', '# Plan A'), exit('e2', '# Plan B'), { content: 'done' }])
    const phases = () =>
      h
        .entries()
        .filter((e) => e.kind === 'plan_phase')
        .map((e) => (e.payload as { phase: string }).phase)
    const read = async () => (await h.api.get(planPaths.sessionPlan(h.sessionId))).body as { phase: string }
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'read-only' })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan' })).status).toBe(204)
    expect((await read()).phase).toBe('planning')
    // 规划中切换 Permission Mode：模式变化，仍在规划中。
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })).body).toEqual({ mode: 'default', rules: [] })
    expect((await read()).phase).toBe('planning')
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan OFF' })).status).toBe(204)
    expect((await read()).phase).toBe('none')
    expect(h.modes()).toEqual([{ mode: 'default' }, { mode: 'read-only' }, { mode: 'default' }])
    // 不在规划中时 /plan off 与 exit 不提交条目；动作都不产生 user message。
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan off' })).status).toBe(204)
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    expect(phases()).toEqual(['planning', 'none'])

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan draft a plan for Y' })).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    const users = h
      .entries()
      .filter((e) => kindOf(e) === 'user')
      .map((e) => JSON.stringify(e.payload))
    expect(users).toHaveLength(1)
    expect(users[0]).toContain('draft a plan for Y')
    // Run 进行中：/plan 与 /plan off 以 run-in-progress 拒绝；计划接口照常可用。
    for (const t of ['/plan', '/plan off'])
      expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: t })).body.error?.code).toBe('run-in-progress')
    const proposed = h.plans()[0]!
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    // 退出不改动待审阅的 plan 条目，也不取消等待中的审批。
    expect(h.plans()).toEqual([proposed])
    expect((await h.answer(review.requestId, { decision: 'allow', mode: 'read-only' })).status).toBe(400)
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    expect(text(await h.resultOf('e1'))).toBe(APPROVED_T7('# Plan A'))
    // 同一 Run 中已不在规划中：再次 exit_plan_mode 直接报错，不再审阅。
    expect(await h.resultOf('e2')).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Not in plan mode/) }] })
    await h.runEnds(1)
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(h.plans().at(-1)).toMatchObject({ status: 'approved', markdown: '# Plan A' })
    expect(phases()).toEqual(['planning', 'none', 'planning', 'none'])
    expect(h.modes().at(-1)).toEqual({ mode: 'default' })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Run 中途进入与退出规划：等待中的写入审批被重新判定为拒绝，之后的写入立即拒绝；退出后写入恢复询问；<plan_mode> 到下一个 Run 才出现', async () => {
    const h = await boot([
      call('write', 'w1', { path: 'a.txt', content: 'a' }),
      call('bash', 'b1', { command: 'ls' }),
      call('write', 'w2', { path: 'b.txt', content: 'b' }),
      call('write', 'w3', { path: 'c.txt', content: 'c' }),
      { content: 'run one done' },
      { content: 'run two' },
    ])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })).status).toBe(202)
    const w1 = await waitApproval(h.stream, h.sessionId, 1)
    expect(w1).toMatchObject({ kind: 'tool', toolName: 'write' })
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'enter' })).body).toEqual({ phase: 'planning', plan: null })
    expect(text(await h.resultOf('w1'))).toBe(PLANNING_WRITE_REFUSED)
    // 命令在规划中照常按 default 询问；等待期间退出规划，之后的写入恢复询问。
    const b1 = await waitApproval(h.stream, h.sessionId, 2)
    expect(b1).toMatchObject({ kind: 'tool', toolName: 'bash' })
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    expect((await h.answer(b1.requestId, { decision: 'allow' })).status).toBe(204)
    const w2 = await waitApproval(h.stream, h.sessionId, 3)
    expect(w2).toMatchObject({ kind: 'tool', toolName: 'write' })
    // 再进入：w2 被重新判定为拒绝；w3 立即拒绝且不询问。
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'enter' })).status).toBe(200)
    expect(text(await h.resultOf('w2'))).toBe(PLANNING_WRITE_REFUSED)
    expect(text(await h.resultOf('w3'))).toBe(PLANNING_WRITE_REFUSED)
    await h.runEnds(1)
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(3)
    for (const f of ['a.txt', 'b.txt', 'c.txt']) expect(await exists(join(h.root, f))).toBe(false)
    expect(h.modes()).toEqual([{ mode: 'default' }])

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'next' })).status).toBe(202)
    await h.runEnds(2)
    const logged = await h.requests()
    // Run 1 开始时不在规划中：它的全部请求没有 <plan_mode>；Run 2 开始时在规划中。
    for (const request of logged.slice(0, -1)) expect(h.sections(request).map((s) => s.name)).not.toContain('plan_mode')
    expect(h.sections(logged.at(-1)!).find((s) => s.name === 'plan_mode')!.text).toBe(PLAN_MODE_T1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('计划接口：进入与退出各提交一条 plan_phase（已在 / 不在时不提交），切换模式不提交；GET / POST 读回；校验与 404；批准的条目顺序；审计；首次发送拒绝 plan，/plan 消息以规划开始', async () => {
    const h = await boot([exit('e1', PLAN), { content: 'done' }, { content: 'first send reply' }])
    const phases = (id = h.sessionId) =>
      h
        .entries(id)
        .filter((e) => e.kind === 'plan_phase')
        .map((e) => (e.payload as { phase: string }).phase)
    const read = async (id = h.sessionId) => (await h.api.get(planPaths.sessionPlan(id))).body
    const act = (action: unknown, id = h.sessionId) => h.api.post(planPaths.sessionPlan(id), { action })
    const slash = (text: string) => h.api.post(apiPaths.sessionMessages(h.sessionId), { text })

    expect(await read()).toEqual({ phase: 'none', plan: null })
    for (const [response, status, code] of [
      [await h.api.get(planPaths.sessionPlan('no-such-session')), 404, 'not-found'],
      [await act('enter', 'no-such-session'), 404, 'not-found'],
      [await act('pause'), 400, 'bad-request'],
      [await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'enter', extra: true }), 400, 'bad-request'],
    ] as const)
      expect([response.status, response.body.error?.code]).toEqual([status, code])

    expect((await act('enter')).body).toEqual({ phase: 'planning', plan: null })
    expect((await act('enter')).status).toBe(200)
    expect((await slash('/plan')).status).toBe(204)
    expect(phases()).toEqual(['planning'])
    for (const mode of ['read-only', 'accept-edits', 'full-access', 'default'])
      expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode })).body).toEqual({ mode, rules: [] })
    expect(await read()).toEqual({ phase: 'planning', plan: null })
    expect((await slash('/plan off')).status).toBe(204)
    expect((await act('exit')).body).toEqual({ phase: 'none', plan: null })
    expect(phases()).toEqual(['planning', 'none'])
    expect(h.modes()).toEqual([{ mode: 'default' }, { mode: 'read-only' }, { mode: 'accept-edits' }, { mode: 'full-access' }, { mode: 'default' }])

    // /plan 带消息：规划中提交的计划经 GET 读回；批准：approved → plan_phase none → 工具结果，没有 permission_mode。
    expect((await slash('/plan draft it')).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    const proposed = h.plans()[0]!
    expect(await read()).toEqual({ phase: 'planning', plan: { planId: review.planId, revision: 1, markdown: PLAN, status: 'proposed' } })
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)
    expect(await read()).toEqual({ phase: 'none', plan: null })
    const tail = h
      .entries()
      .filter((e) => ['approval_decision', 'tool_exec', 'plan', 'plan_phase', 'permission_mode'].includes(e.kind) || kindOf(e) === 'toolResult')
    expect(tail.slice(-5).map(kindOf)).toEqual(['approval_decision', 'tool_exec', 'plan', 'plan_phase', 'toolResult'])
    expect(phases().slice(-2)).toEqual(['planning', 'none'])
    expect(h.plans().at(-1)).toMatchObject({ planId: proposed.planId, status: 'approved' })
    expect(h.modes()).toHaveLength(5)
    const logged = await h.requests()
    expect(h.sections(logged[0]!).map((s) => s.name)).toContain('plan_mode')

    // 审计序列包含每次阶段转换。
    const audit = (await h.api.get(apiPaths.sessionAudit(h.sessionId))).body as { kind: string; phase?: string }[]
    expect(audit.filter((e) => e.kind === 'plan_phase').map((e) => e.phase)).toEqual(['planning', 'none', 'planning', 'none'])

    // 首次发送：permissionMode plan 为 400（不创建 Session）；text 为 /plan 消息时以规划开始并提交该消息，模式为所选模式。
    const refused = await h.api.post(API_ROUTES.firstSend, { draftId: 'plan-first-send-mode', text: 'research first', permissionMode: 'plan' })
    expect([refused.status, refused.body.error?.code]).toEqual([400, 'bad-request'])
    const empty = await h.api.post(API_ROUTES.firstSend, { draftId: 'plan-first-send-empty', text: '/plan' })
    expect([empty.status, empty.body.error?.message]).toEqual([400, 'A message is required'])
    const sent = await h.api.post(API_ROUTES.firstSend, { draftId: 'plan-first-send', text: '/plan research first', permissionMode: 'accept-edits' })
    expect(sent.status).toBe(201)
    const firstId = sent.body.session.id as string
    expect(await read(firstId)).toMatchObject({ phase: 'planning' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(firstId))).body).toEqual({ mode: 'accept-edits', rules: [] })
    const firstEntries = (await h.api.get(apiPaths.session(firstId))).body.entries as SessionEntryRecord[]
    expect(firstEntries.filter((e) => e.kind === 'permission_mode' || e.kind === 'plan_phase').map((e) => [e.kind, e.payload])).toEqual([
      ['permission_mode', { mode: 'accept-edits' }],
      ['plan_phase', { phase: 'planning' }],
    ])
    expect(JSON.stringify(firstEntries.find((e) => kindOf(e) === 'user')!.payload)).toContain('research first')
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  // 票 06：计划阶段按有效条目回放，回退后重新计算；Permission Mode 的回退口径不变（仍按原始条目，回退区间内的切换照常生效）。
  it('回退到 /plan 消息本身仍在规划中；回退到进入规划之前：读回无，下一个 Run 没有 <plan_mode> 与提交工具，写入按 Permission Mode；模式不随回退还原', async () => {
    const h = await boot([{ content: 'one' }, { content: 'researching' }, call('write', 'w1', { path: 'notes.md', content: 'x' }), { content: 'written' }])
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'first' })
    await h.runEnds(1)
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })).status).toBe(200)
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan 调研' })
    await h.runEnds(2)
    const [first, planned] = h.entries().filter((e) => kindOf(e) === 'user')
    expect(h.entries().find((e) => e.kind === 'plan_phase')!.seq).toBeLessThan(planned!.seq)
    expect((await h.tools()).at(-1)).toContain('exit_plan_mode')

    const rewind = (targetSeq: number) => h.api.post(checkpointPaths.sessionRewind(h.sessionId), { targetSeq, mode: 'conversation' })
    expect((await rewind(planned!.seq)).status).toBe(200)
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'planning', plan: null })
    expect((await rewind(first!.seq)).status).toBe(200)
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'none', plan: null })
    // Permission Mode 的回退行为保持现状：回退区间内切换的 accept-edits 仍生效（另开问题，不在本票范围）。
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'accept-edits', rules: [] })

    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'write now' })
    await h.runEnds(3)
    expect((await h.resultOf('w1')).isError).toBe(false)
    expect(await readFile(join(h.root, 'notes.md'), 'utf8')).toBe('x')
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toEqual([])
    const logged = await h.requests()
    expect(h.sections(logged.at(-1)!).map((s) => s.name)).not.toContain('plan_mode')
    expect((await h.tools()).at(-1)).not.toContain('exit_plan_mode')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('回退到批准所在 Run 的用户消息：读回规划中，写入再次被拒，提交工具可用；被回退的已批准记录不算当前计划，修订沿用回退后最后一条 plan 续号', async () => {
    const h = await boot([
      exit('e0', PLAN),
      { content: 'revising' },
      exit('e1', EDITED),
      { content: 'implementing' },
      call('write', 'w1', { path: 'notes.md', content: 'x' }),
      exit('e2', PLAN),
    ])
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan 调研' })
    const first = await waitApproval(h.stream, h.sessionId, 1)
    expect((await h.answer(first.requestId, { decision: 'deny', feedback: 'add tests' })).status).toBe(204)
    await h.runEnds(1)
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'submit' })
    const second = await waitApproval(h.stream, h.sessionId, 2)
    expect(second).toMatchObject({ planId: first.planId, revision: 2 })
    expect((await h.answer(second.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(2)
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'none', plan: null })

    const submit = h
      .entries()
      .filter((e) => kindOf(e) === 'user')
      .at(-1)!
    expect((await h.api.post(checkpointPaths.sessionRewind(h.sessionId), { targetSeq: submit.seq, mode: 'conversation' })).status).toBe(200)
    // 被回退的是 revision 2 的 proposed 与 approved、计划阶段“无”；之前带反馈拒绝的 revision 1 不是待审阅的计划。
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'planning', plan: null })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(h.sessionId))).body).toEqual({ mode: 'default', rules: [] })

    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'try again' })
    const write = await h.resultOf('w1')
    expect([write.isError, text(write)]).toEqual([true, PLANNING_WRITE_REFUSED])
    expect(await exists(join(h.root, 'notes.md'))).toBe(false)
    const third = await waitApproval(h.stream, h.sessionId, 3)
    expect(third).toMatchObject({ kind: 'plan', planId: first.planId, revision: 2 })
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(3)
    const logged = await h.requests()
    expect(h.sections(logged.at(-1)!).find((s) => s.name === 'plan_mode')?.text).toBe(PLAN_MODE_T1)
    expect((await h.tools()).at(-1)).toContain('exit_plan_mode')
    await h.api.post(apiPaths.sessionAbort(h.sessionId))
    await h.runEnds(3)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('压缩把已批准计划摘要掉后注入 <approved_plan>；分叉规划中的 Session：仍在规划中、模式随 permission_mode 复制（default），没有 plan 条目', async () => {
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
    // 票 04 起进入规划不改模式：复制的 permission_mode 为 default（原先断言 plan 与 prior）。
    expect(detail.filter((e) => e.kind === 'permission_mode').at(-1)!.payload).toEqual({ mode: 'default' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(forkId))).body).toEqual({ mode: 'default', rules: [] })
    // 分叉得到“规划中”，待审阅的计划不随分叉复制。
    expect((await h.api.get(planPaths.sessionPlan(forkId))).body).toEqual({ phase: 'planning', plan: null })
    expect(detail.filter((e) => e.kind === 'plan_phase').map((e) => e.payload)).toEqual([{ phase: 'planning' }])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

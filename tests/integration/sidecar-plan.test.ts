// Plan Mode（ADR 0005、ADR 0028）：真实 Sidecar（faux 模型）经协议驱动 /plan 与计划接口进入和退出（不改变 Permission Mode）、规划中的约束（写入拒绝、命令只读
// 沙箱且不能提权，其余调用按当前模式）、Run 中途进入与退出、exit_plan_mode 的提交与审阅（编辑后批准、带反馈继续规划，批准后执行中，审阅等待中切换模式后
// 按新模式执行）、回答的校验、执行中的放弃与重新规划、压缩后的 <approved_plan> 与分叉。
// 本票不新增文件读取（没有读取根或注入点涉及路径），不需要符号链接越界用例。
import { execFileSync } from 'node:child_process'
import { access, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { getCurrentTools, type Context } from '@earendil-works/pi-ai'
import {
  API_ROUTES,
  apiPaths,
  checkpointPaths,
  permissionPaths,
  planPaths,
  runPaths,
  tracePaths,
  type SessionEntryRecord,
  type TraceResponse,
} from '@coko/protocol'
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
/** 模型可见文本（ADR 0028 的契约：<plan_mode>、写入与提权拒绝、沙箱拒绝标记、批准结果、执行中的 State Update）。 */
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
const APPROVED = (markdown: string) =>
  [
    'The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan:',
    '1. First break the plan into steps with todo_write.',
    '2. Do the work and verify it, for example by running the relevant tests or checks.',
    '3. When the work is done, call complete_plan with a report that goes through the plan item by item: what you did, how you verified it, and anything you did not do or did differently, with the reason.',
    '',
    markdown,
  ].join('\n')
const PLAN_STATE = (title: string, revision: number) =>
  `<state_update name="plan">\nAn approved plan is still in progress: "${title}" (revision ${revision}). Keep carrying it out; when the work is done and verified, call complete_plan with a report against the plan.\n</state_update>`
const PLAN_STATE_CLEARED = '<state_update name="plan">\nThis item currently has no content. Previous updates with this name no longer apply.\n</state_update>'
/** 一次请求中最后一条 user message 的各块文本。 */
const userBlocks = (logged: Logged): string[] => {
  const content = logged.filter((m) => m.role === 'user').at(-1)?.content
  return Array.isArray(content) ? content.map((b) => (b as { text?: string }).text ?? '') : [String(content)]
}
const firstBlock = (logged: Logged) => userBlocks(logged)[0]
/** 最后一条 user message 中的 plan State Update 块（没有时 undefined）。 */
const planBlock = (logged: Logged) => userBlocks(logged).find((t) => t.startsWith('<state_update name="plan">'))

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
    // ADR 0028 起进入规划不提交 permission_mode：只有创建时的初始模式（原先断言切到 plan 并记下 prior）。
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

    // 回答的校验：批准不再接受 mode（ADR 0028），editedPlan 须以 # 标题开头，只能允许一次；都不改变请求。
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
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({
      phase: 'executing',
      plan: { planId: proposed[0]!.planId, revision: 2, markdown: EDITED, status: 'approved' },
    })
    const approved = await h.resultOf('e1')
    expect(approved.isError).toBe(false)
    expect(text(approved)).toBe(APPROVED(EDITED))
    expect(h.entries().at(-1)!.payload).toMatchObject({ status: 'completed' })
    // 顺序：proposed → 审批请求 → 决定 → 工具执行 → approved → 计划阶段“执行中” → 工具结果；没有 permission_mode。
    const order = h
      .entries()
      .filter(
        (e) => ['approval_request', 'approval_decision', 'tool_exec', 'plan', 'plan_phase', 'permission_mode'].includes(e.kind) || kindOf(e) === 'toolResult',
      )
    expect(order.slice(-7).map(kindOf)).toEqual(['plan', 'approval_request', 'approval_decision', 'tool_exec', 'plan', 'plan_phase', 'toolResult'])
    expect(h.entries().findLast((e) => e.kind === 'plan_phase')!.payload).toEqual({ phase: 'executing', planId: proposed[0]!.planId })

    // 发给模型的请求：规划中开始的 Run 带 <plan_mode>（最终版），模型看到了 exit_plan_mode 的结果并继续。
    const logged = await h.requests()
    expect(logged).toHaveLength(4)
    for (const request of logged) expect(h.sections(request).map((s) => s.name)).toContain('plan_mode')
    expect(h.sections(logged[0]!).find((s) => s.name === 'plan_mode')!.text).toBe(PLAN_MODE_T1)
    expect(JSON.stringify(logged[3]!.at(-1))).toContain('carry out the plan:')
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('批准后执行中：不先调用 todo_write 的写入照常按模式询问并写入、命令回到 workspace-write 沙箱；下一个带新输入的 Run 首块为 plan State Update，值不变不重复；Run 结束后不自动发起 Run；放弃后送达一次清空', async () => {
    const h = await boot([
      exit('e1', PLAN),
      call('write', 'w1', { path: 'notes.md', content: 'x' }),
      call('bash', 'b1', { command: 'echo hi > touched.txt' }),
      { content: 'run one done' },
      { content: 'run two' },
      { content: 'run three' },
      { content: 'run four' },
      { content: 'run five' },
    ])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan fix it' })).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    expect(text(await h.resultOf('e1'))).toBe(APPROVED(PLAN))
    // 宿主不检查是否拆了 Todo：写入按 default 询问后执行，命令在 Permission Mode 对应的档位运行。
    const write = await waitApproval(h.stream, h.sessionId, 2)
    expect(write).toMatchObject({ kind: 'tool', toolName: 'write' })
    expect((await h.answer(write.requestId, { decision: 'allow' })).status).toBe(204)
    const bash = await waitApproval(h.stream, h.sessionId, 3)
    expect(bash).toMatchObject({ kind: 'tool', toolName: 'bash' })
    expect((await h.answer(bash.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)
    expect((await h.resultOf('w1')).isError).toBe(false)
    expect(await readFile(join(h.root, 'notes.md'), 'utf8')).toBe('x')
    // darwin：workspace-write 的 Seatbelt 允许写 Workspace；其他平台没有 sandbox-exec，受限档位的命令 fail-closed（ADR 0005）。
    expect((await h.resultOf('b1')).isError).toBe(!darwin)
    expect(await readFile(join(h.root, 'touched.txt'), 'utf8').catch(() => null)).toBe(darwin ? 'hi\n' : null)
    expect(h.entries().some((e) => e.kind === 'todo')).toBe(false)
    const planId = h.plans()[0]!.planId
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({
      phase: 'executing',
      plan: { planId, revision: 1, markdown: PLAN, status: 'approved' },
    })
    // 批准所在的 Run 不额外送达。
    const updates = () => h.entries().filter((e) => e.kind === 'state_update' && (e.payload as { name: string }).name === 'plan')
    expect(updates()).toEqual([])

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'continue' })).status).toBe(202)
    await h.runEnds(2)
    let logged = await h.requests()
    expect(firstBlock(logged.at(-1)!)).toBe(PLAN_STATE('Fix the parser', 1))
    // 条目：state_update 在该 Run 的 user message 之前，值为计划的标识、修订与标题。
    const [delivered] = updates()
    expect(delivered!.payload).toEqual({ name: 'plan', value: { planId, revision: 1, title: 'Fix the parser' } })
    const user = h.entries().findLast((e) => kindOf(e) === 'user')!
    expect([delivered!.runId, delivered!.seq < user.seq]).toEqual([user.runId, true])
    // 执行中没有 <plan_mode> 与 exit_plan_mode。
    expect(h.sections(logged.at(-1)!).map((s) => s.name)).not.toContain('plan_mode')
    expect((await h.tools()).at(-1)).not.toContain('exit_plan_mode')

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'and more' })).status).toBe(202)
    await h.runEnds(3)
    expect(updates()).toHaveLength(1)
    logged = await h.requests()
    expect(planBlock(logged.at(-1)!)).toBeUndefined()
    // 有执行中的 Plan、没有 Goal：Run 结束后宿主不发起新的 Run。
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(h.entries().filter((e) => e.kind === 'run_start')).toHaveLength(3)

    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    expect(h.plans().at(-1)).toMatchObject({ planId, status: 'abandoned' })
    for (const [n, t] of [
      [4, 'after exit'],
      [5, 'once more'],
    ] as const) {
      expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: t })).status).toBe(202)
      await h.runEnds(n)
    }
    logged = await h.requests()
    expect(firstBlock(logged.at(-2)!)).toBe(PLAN_STATE_CLEARED)
    expect(planBlock(logged.at(-1)!)).toBeUndefined()
    expect(updates().map((e) => (e.payload as { value: unknown }).value)).toEqual([{ planId, revision: 1, title: 'Fix the parser' }, null])
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
    expect(text(await h.resultOf('e1'))).toBe(APPROVED(PLAN))
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it.each(['abort', 'pause'] as const)('无反馈拒绝后 Run 结束、仍在规划中；%s 时待审阅的计划审批 cancelled，计划保持 proposed、仍在规划中', async (how) => {
    const h = await boot([exit('e1', PLAN), exit('e2', EDITED), { content: 'should not be used' }])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan look around' })).status).toBe(202)
    const first = await waitApproval(h.stream, h.sessionId, 1)
    expect((await h.answer(first.requestId, { decision: 'deny' })).status).toBe(204)
    await h.runEnds(1)
    expect(h.plans().map((p) => p.status)).toEqual(['proposed', 'rejected'])
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'planning', plan: null })

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'try again' })).status).toBe(202)
    const second = await waitApproval(h.stream, h.sessionId, 2)
    expect(second).toMatchObject({ kind: 'plan', revision: 2 })
    const path = how === 'abort' ? apiPaths.sessionAbort(h.sessionId) : runPaths.sessionPause(h.sessionId)
    expect((await h.api.post(path)).status).toBeLessThan(300)
    await h.runEnds(2)
    const decisions = h.entries().filter((e) => e.kind === 'approval_decision')
    expect(decisions.at(-1)?.payload).toEqual({ requestId: second.requestId, outcome: 'cancelled' })
    expect(h.plans().at(-1)).toMatchObject({ revision: 2, status: 'proposed', markdown: EDITED })
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toMatchObject({ phase: 'planning', plan: { revision: 2, status: 'proposed' } })
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
    // 切换 Permission Mode 的接口不再接受 plan（ADR 0028）：400，模式不变。
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
    expect(text(await h.resultOf('e2'))).toBe(APPROVED('# Two'))
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

  it('/plan off 与计划接口退出不改模式；规划中切换模式不退出规划；审阅等待中退出规划后批准仍进入执行中；执行中 /plan off 即放弃；Run 进行中 /plan 为 409、计划接口照常可用', async () => {
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
    expect(text(await h.resultOf('e1'))).toBe(APPROVED('# Plan A'))
    // 同一 Run 中已不在规划中：再次 exit_plan_mode 直接报错，不再审阅。
    expect(await h.resultOf('e2')).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Not in plan mode/) }] })
    await h.runEnds(1)
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(h.plans().at(-1)).toMatchObject({ status: 'approved', markdown: '# Plan A' })
    // 批准是用户的明确动作：审阅等待期间已退出规划，批准后同样进入执行中。
    expect(phases()).toEqual(['planning', 'none', 'planning', 'none', 'executing'])
    expect((await read()).phase).toBe('executing')
    // 执行中退出即放弃：先提交 abandoned 的 plan 条目，再提交计划阶段“无”。
    const before = h.plans()
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan off' })).status).toBe(204)
    expect(await read()).toEqual({ phase: 'none', plan: null })
    expect(h.plans()).toEqual([...before, { ...before.at(-1)!, status: 'abandoned' }])
    expect(phases()).toEqual(['planning', 'none', 'planning', 'none', 'executing', 'none'])
    expect(h.modes().at(-1)).toEqual({ mode: 'default' })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  /** 在 from 下进入规划，计划审阅等待中切到 to 后批准：计划的审批请求仍在等待、不被重新判定；返回时 Run 仍在继续（下一个调用是写入 w1）。 */
  async function approveAfterSwitch(from: string, to: string) {
    const h = await boot([exit('e1', PLAN), call('write', 'w1', { path: 'out.txt', content: 'x' }), { content: 'done' }])
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: from })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan fix it' })).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    expect(review).toMatchObject({ kind: 'plan' })
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: to })).body).toEqual({ mode: to, rules: [] })
    // 切换在锁内提交并重新判定 kind tool 的请求；kind plan 的请求保持等待（没有决定条目），审阅仍可回答。
    expect(h.entries().filter((e) => e.kind === 'approval_decision')).toEqual([])
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toMatchObject({ phase: 'planning' })
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    expect(text(await h.resultOf('e1'))).toBe(APPROVED(PLAN))
    return h
  }
  async function finished(h: Awaited<ReturnType<typeof boot>>, to: string) {
    expect((await h.resultOf('w1')).isError).toBe(false)
    await h.runEnds(1)
    expect(await readFile(join(h.root, 'out.txt'), 'utf8')).toBe('x')
    expect(h.modes().at(-1)).toEqual({ mode: to })
    expect(h.entries().filter((e) => e.kind === 'run_start')).toHaveLength(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  }

  it('审阅等待中放宽（default → accept-edits）：计划审批仍在等待；批准后同一个 Run 的写入不再询问', async () => {
    const h = await approveAfterSwitch('default', 'accept-edits')
    await finished(h, 'accept-edits')
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(1)
  })

  it('审阅等待中收紧（accept-edits → default）：计划审批仍在等待；批准后同一个 Run 的写入询问', async () => {
    const h = await approveAfterSwitch('accept-edits', 'default')
    const write = await waitApproval(h.stream, h.sessionId, 2)
    expect(write).toMatchObject({ kind: 'tool', toolName: 'write' })
    expect((await h.answer(write.requestId, { decision: 'allow', scope: 'once' })).status).toBe(204)
    await finished(h, 'default')
    expect(h.entries().filter((e) => e.kind === 'approval_request')).toHaveLength(2)
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

    // /plan 带消息：规划中提交的计划经 GET 读回；批准：approved → plan_phase executing → 工具结果，没有 permission_mode。
    expect((await slash('/plan draft it')).status).toBe(202)
    const review = await waitApproval(h.stream, h.sessionId, 1)
    const proposed = h.plans()[0]!
    expect(await read()).toEqual({ phase: 'planning', plan: { planId: review.planId, revision: 1, markdown: PLAN, status: 'proposed' } })
    expect((await h.answer(review.requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)
    expect(await read()).toEqual({ phase: 'executing', plan: { ...proposed, status: 'approved' } })
    const tail = h
      .entries()
      .filter((e) => ['approval_decision', 'tool_exec', 'plan', 'plan_phase', 'permission_mode'].includes(e.kind) || kindOf(e) === 'toolResult')
    expect(tail.slice(-5).map(kindOf)).toEqual(['approval_decision', 'tool_exec', 'plan', 'plan_phase', 'toolResult'])
    expect(phases().slice(-2)).toEqual(['planning', 'executing'])
    expect(h.plans().at(-1)).toMatchObject({ planId: proposed.planId, status: 'approved' })
    expect(h.modes()).toHaveLength(5)
    const logged = await h.requests()
    expect(h.sections(logged[0]!).map((s) => s.name)).toContain('plan_mode')

    // 审计序列包含每次阶段转换。
    const audit = (await h.api.get(apiPaths.sessionAudit(h.sessionId))).body as { kind: string; phase?: string }[]
    expect(audit.filter((e) => e.kind === 'plan_phase').map((e) => e.phase)).toEqual(['planning', 'none', 'planning', 'executing'])

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

  it('旧数据（permission_mode v2 的 plan）：模式读为 prior、没有 prior 读为 default，库中行不改写；不在规划中、没有 <plan_mode> 与 exit_plan_mode；已提交的计划仍可读', async () => {
    const root = await realpath(await tempDir())
    const script = await fauxScript(root, { responses: [{ content: 'continuing' }] }, '.faux.json')
    const dirs = await sidecarDirs()
    const env = { COKO_FAUX_SCRIPT: script }
    const before = await startSidecar({ dirs, env })
    const seeding = client(before, await exchange(before))
    const workspaceId = (await seeding.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const withPrior = (await seeding.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    const withoutPrior = (await seeding.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect(await before.stop()).toEqual({ code: 0, signal: null })
    // 升级前的版本写下的条目：permission_mode v2 停在 plan，plan v1 的计划；没有 plan_phase。经存储的公开接口在 Sidecar 停止时写入。
    const proposed = { planId: 'p0', revision: 1, markdown: '# Old plan', status: 'proposed' }
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      const { openSqliteStore } = await import(process.argv[1]);
      const { createPayloadRegistry } = await import(process.argv[6]);
      const { SESSION_ENTRY_PAYLOADS } = await import(process.argv[7]);
      const store = await openSqliteStore({ path: process.argv[2], payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) });
      const [withPrior, withoutPrior, proposed] = [process.argv[3], process.argv[4], JSON.parse(process.argv[5])];
      try {
        await store.sessions.appendEntries(withPrior, [
          { kind: 'permission_mode', payloadVersion: 2, payload: { mode: 'plan', prior: 'accept-edits' } },
          { kind: 'plan', payloadVersion: 1, payload: proposed },
        ]);
        await store.sessions.appendEntries(withoutPrior, [{ kind: 'permission_mode', payloadVersion: 2, payload: { mode: 'plan' } }]);
      } finally { await store.close(); }
    `,
        new URL('../../packages/session/src/sqlite/index.ts', import.meta.url).href,
        join(dirs.dataDir, 'coko.db'),
        withPrior,
        withoutPrior,
        JSON.stringify(proposed),
        new URL('../../packages/session/src/payloads.ts', import.meta.url).href,
        new URL('../../packages/agent/src/session-entries/index.ts', import.meta.url).href,
      ],
      { stdio: 'pipe' },
    )

    const sidecar = await startSidecar({ dirs, env })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    expect((await api.get(permissionPaths.sessionPermissionRules(withPrior))).body).toEqual({ mode: 'accept-edits', rules: [] })
    expect((await api.get(permissionPaths.sessionPermissionRules(withoutPrior))).body).toEqual({ mode: 'default', rules: [] })
    for (const id of [withPrior, withoutPrior]) expect((await api.get(planPaths.sessionPlan(id))).body).toEqual({ phase: 'none', plan: null })
    // 读取结果为当前版本（v3，不带 prior）；已提交的计划仍在条目中（时间线的计划卡与右栏 Plan 页由它派生）。
    const entries = (await api.get(apiPaths.session(withPrior))).body.entries as SessionEntryRecord[]
    expect(entries.filter((e) => e.kind === 'permission_mode').map((e) => [e.payloadVersion, e.payload])).toEqual([
      [3, { mode: 'default' }],
      [3, { mode: 'accept-edits' }],
    ])
    expect(entries.filter((e) => e.kind === 'plan').map((e) => e.payload)).toEqual([proposed])
    // 数据库行不改写：原始版本号仍为 2。
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    try {
      const rows = db
        .prepare("SELECT payload_version, payload FROM session_entries WHERE kind = 'permission_mode' AND session_id = ? ORDER BY seq")
        .all(withPrior)
      expect(rows.map((row) => [row.payload_version, JSON.parse(String(row.payload))])).toEqual([
        [3, { mode: 'default' }],
        [2, { mode: 'plan', prior: 'accept-edits' }],
      ])
    } finally {
      db.close()
    }
    // 审计的权限模式事件不带 prior。
    const audit = (await api.get(apiPaths.sessionAudit(withPrior))).body as { kind: string }[]
    expect(
      audit.filter((e) => e.kind === 'permission_mode').map(({ seq: _seq, at: _at, ...event }: { kind: string; seq?: number; at?: number }) => event),
    ).toEqual([
      { kind: 'permission_mode', mode: 'default' },
      { kind: 'permission_mode', mode: 'accept-edits' },
    ])

    // 下一个 Run 不在规划中：没有 <plan_mode>，没有 exit_plan_mode。
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: withPrior, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === withPrior)
    expect((await api.post(apiPaths.sessionMessages(withPrior), { text: 'continue' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(withPrior).some((e) => e.kind === 'run_end'), 30_000)
    const [sent] = ((await api.get(tracePaths.trace(withPrior))).body as TraceResponse).runs.flatMap((run) => run.requests)
    expect(sent!.snapshot!.system).toContain('<environment>')
    expect(sent!.snapshot!.system).not.toContain('<plan_mode>')
    const tools = (sent!.snapshot!.tools as { name: string }[]).map((t) => t.name)
    expect(tools).toContain('read')
    expect(tools).not.toContain('exit_plan_mode')
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('执行中 /plan off 放弃：依次提交 abandoned 与阶段无，文件与 Checkpoint 不变；下一个 Run 送达一次清空；回退到放弃之前回到执行中；执行中再 /plan：旧计划放弃、进入规划、写入被拒、新计划新编号从修订 1 开始', async () => {
    const h = await boot([
      exit('e1', PLAN),
      call('write', 'w1', { path: 'notes.md', content: 'kept' }),
      { content: 'run one done' },
      { content: 'run two' },
      { content: 'run three' },
      call('write', 'w2', { path: 'other.md', content: 'x' }),
      exit('e2', '# New direction'),
    ])
    const phases = () =>
      h
        .entries()
        .filter((e) => e.kind === 'plan_phase')
        .map((e) => e.payload)
    const read = async () => (await h.api.get(planPaths.sessionPlan(h.sessionId))).body
    const checkpoints = async () => (await h.api.get(checkpointPaths.sessionCheckpoints(h.sessionId))).body
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })).status).toBe(200)
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan fix it' })).status).toBe(202)
    expect((await h.answer((await waitApproval(h.stream, h.sessionId, 1)).requestId, { decision: 'allow' })).status).toBe(204)
    await h.runEnds(1)
    const approved = h.plans().at(-1)!
    expect(approved).toMatchObject({ status: 'approved', revision: 1 })
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'continue' })).status).toBe(202)
    await h.runEnds(2)
    expect(planBlock((await h.requests()).at(-1)!)).toBe(PLAN_STATE('Fix the parser', 1))

    // 放弃：不弹确认、不触碰文件与 Checkpoint；plan 条目沿用被执行计划的编号、修订与正文。
    const bytes = await readFile(join(h.root, 'notes.md'))
    const before = await checkpoints()
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan off' })).status).toBe(204)
    expect(await read()).toEqual({ phase: 'none', plan: null })
    expect(h.plans().at(-1)).toEqual({ ...approved, status: 'abandoned' })
    const tail = h.entries().filter((e) => e.kind === 'plan' || e.kind === 'plan_phase')
    expect(tail.slice(-2).map((e) => [e.kind, (e.payload as { status?: string; phase?: string }).status ?? (e.payload as { phase: string }).phase])).toEqual([
      ['plan', 'abandoned'],
      ['plan_phase', 'none'],
    ])
    expect(await readFile(join(h.root, 'notes.md'))).toEqual(bytes)
    expect(await checkpoints()).toEqual(before)
    expect(h.modes().at(-1)).toEqual({ mode: 'accept-edits' })
    // 再次退出不提交。
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    expect(h.plans().filter((p) => p.status === 'abandoned')).toHaveLength(1)

    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'after abandon' })).status).toBe(202)
    await h.runEnds(3)
    let logged = (await h.requests()).at(-1)!
    expect(firstBlock(logged)).toBe(PLAN_STATE_CLEARED)
    expect(h.sections(logged).map((s) => s.name)).not.toContain('approved_plan')

    // 回退到放弃之前的消息：abandoned 与阶段条目被回退，回到执行中、计划回到已批准。
    const continued = h.entries().filter((e) => kindOf(e) === 'user')[1]!
    expect((await h.api.post(checkpointPaths.sessionRewind(h.sessionId), { targetSeq: continued.seq, mode: 'conversation' })).status).toBe(200)
    expect(await read()).toEqual({ phase: 'executing', plan: approved })

    // 执行中再 /plan：先放弃（abandoned → 无），再进入规划；同一时刻只有一份活动的 Plan。
    const count = phases().length
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan rethink' })).status).toBe(202)
    expect(phases().slice(count)).toEqual([{ phase: 'none' }, { phase: 'planning' }])
    expect(
      h
        .plans()
        .filter((p) => p.status === 'abandoned')
        .at(-1),
    ).toEqual({ ...approved, status: 'abandoned' })
    const write = await h.resultOf('w2')
    expect([write.isError, text(write)]).toEqual([true, PLANNING_WRITE_REFUSED])
    expect(await exists(join(h.root, 'other.md'))).toBe(false)
    const review = await waitApproval(h.stream, h.sessionId, 2)
    expect(review.planId).not.toBe(approved.planId)
    expect(review.revision).toBe(1)
    expect(await read()).toEqual({ phase: 'planning', plan: { planId: review.planId, revision: 1, markdown: '# New direction', status: 'proposed' } })
    logged = (await h.requests()).at(-1)!
    expect(h.sections(logged).find((s) => s.name === 'plan_mode')?.text).toBe(PLAN_MODE_T1)
    await h.api.post(apiPaths.sessionAbort(h.sessionId))
    await h.runEnds(4)
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Run 进行中经计划接口放弃：等待中的写入审批不受影响，之后写入照常；Run 结束后读回无且没有活动的 Plan', async () => {
    const h = await boot([exit('e1', PLAN), call('write', 'w1', { path: 'notes.md', content: 'x' }), { content: 'done' }])
    expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan fix it' })).status).toBe(202)
    expect((await h.answer((await waitApproval(h.stream, h.sessionId, 1)).requestId, { decision: 'allow' })).status).toBe(204)
    const write = await waitApproval(h.stream, h.sessionId, 2)
    expect(write).toMatchObject({ kind: 'tool', toolName: 'write' })
    const approved = h.plans().at(-1)!
    expect((await h.api.post(planPaths.sessionPlan(h.sessionId), { action: 'exit' })).body).toEqual({ phase: 'none', plan: null })
    expect(h.plans().at(-1)).toEqual({ ...approved, status: 'abandoned' })
    expect(h.entries().filter((e) => e.kind === 'approval_decision')).toHaveLength(1)
    expect((await h.answer(write.requestId, { decision: 'allow' })).status).toBe(204)
    expect((await h.resultOf('w1')).isError).toBe(false)
    await h.runEnds(1)
    expect(await readFile(join(h.root, 'notes.md'), 'utf8')).toBe('x')
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toEqual({ phase: 'none', plan: null })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  // ADR 0028：计划阶段按有效条目回放，回退后重新计算；Permission Mode 的回退口径不变（仍按原始条目，回退区间内的切换照常生效）。
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
    expect((await h.api.get(planPaths.sessionPlan(h.sessionId))).body).toMatchObject({
      phase: 'executing',
      plan: { planId: first.planId, revision: 2, status: 'approved' },
    })

    const submit = h
      .entries()
      .filter((e) => kindOf(e) === 'user')
      .at(-1)!
    expect((await h.api.post(checkpointPaths.sessionRewind(h.sessionId), { targetSeq: submit.seq, mode: 'conversation' })).status).toBe(200)
    // 被回退的是 revision 2 的 proposed 与 approved、计划阶段“执行中”；之前带反馈拒绝的 revision 1 不是待审阅的计划。
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

  it('执行中：压缩把计划摘要掉后注入 <approved_plan> 并重发 plan State Update；再进入规划后不再注入；分叉规划中的 Session：仍在规划中、模式随 permission_mode 复制（default），没有 plan 条目', async () => {
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
    // plan State Update：Run 2 送达，Run 3、4 值不变不重复；压缩把 Run 2 的送达摘要掉后 Run 6 重发。
    const planUpdates = () =>
      h
        .entries()
        .filter((e) => e.kind === 'state_update' && (e.payload as { name: string }).name === 'plan')
        .map((e) => h.entries().find((r) => r.kind === 'run_start' && r.runId === e.runId)!.seq)
    const runStarts = h
      .entries()
      .filter((e) => e.kind === 'run_start')
      .map((e) => e.seq)
    expect(planUpdates()).toEqual([runStarts[1], runStarts[5]])
    expect(planBlock(logged.at(-1)!)).toBe(PLAN_STATE('Fix the parser', 1))

    // 再进入 plan 并提交一份（不批准就停止），之后在 plan 中再发一条消息，以它为分叉目标：plan 条目在目标之前，但不随分叉复制。
    await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/plan draft' })
    await waitApproval(h.stream, h.sessionId, 2)
    // 执行中再进入规划：不再是执行中，不注入 <approved_plan>；提醒送达一次清空。
    const drafting = (await h.requests()).at(-1)!
    expect(h.sections(drafting).map((s) => s.name)).not.toContain('approved_plan')
    expect(planBlock(drafting)).toBe(PLAN_STATE_CLEARED)
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
    // ADR 0028 起进入规划不改模式：复制的 permission_mode 为 default（原先断言 plan 与 prior）。
    expect(detail.filter((e) => e.kind === 'permission_mode').at(-1)!.payload).toEqual({ mode: 'default' })
    expect((await h.api.get(permissionPaths.sessionPermissionRules(forkId))).body).toEqual({ mode: 'default', rules: [] })
    // 分叉得到“规划中”，待审阅的计划不随分叉复制。
    expect((await h.api.get(planPaths.sessionPlan(forkId))).body).toEqual({ phase: 'planning', plan: null })
    expect(detail.filter((e) => e.kind === 'plan_phase').map((e) => e.payload)).toEqual([{ phase: 'planning' }])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

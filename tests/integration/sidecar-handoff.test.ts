// 交接（docs/subsystems/handoff.md）：真实 Sidecar（faux）经协议驱动。/handoff 只发一次无工具的摘要请求（有效上下文 + 指令），Run 正常结束后
// 创建目标 Session（首条 handoff_origin，模型、档位、模式与 Session 规则相同，不继承 Goal / Todo / 计划 / Job），源 Session 记 handoff；
// 目标为新的或已有的 worktree（git 夹具）；准入的 409 / 400；停止时不创建目标；对手用例：Goal 预算耗尽时不发摘要请求，交接用量计入 Goal。
// 不新增读取根：目标 worktree 的创建与工作目录检查在 Worktree 的实现中（sidecar-worktrees）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, goalPaths, handoffPaths, permissionPaths, worktreePaths, type SessionEntryRecord } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

type Logged = { role: string; content: string | { type: string; text?: string }[] }[]
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const usage = (input: number, output: number) => ({ usage: { input, output } })
const SUMMARY = '## Context\nlogin form uses zod\n## Files\n- src/login.tsx\n## Open items\nNone\n## Task\nbuild the login page'

async function boot(responses: unknown[], options: { workspaceDir?: string; env?: Record<string, string>; script?: Record<string, unknown> } = {}) {
  const root = await tempDir()
  const workspaceDir = options.workspaceDir ?? join(root, 'ws')
  await mkdir(workspaceDir, { recursive: true })
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const path = await fauxScript(root, { ...options.script, requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...options.env, COKO_FAUX_SCRIPT: path } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
  const subscribe = async (sessionId: string) => {
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  }
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await subscribe(sessionId)
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Logged)
  const of = (id: string, kind: string) => stream.entries(id).filter((e) => e.kind === kind)
  /** 提交一条消息并等待它开始的 Run 结束。 */
  const send = async (text: string, id = sessionId) => {
    const ends = of(id, 'run_end').length
    const response = await api.post(apiPaths.sessionMessages(id), { text })
    expect(response.status).toBe(202)
    await stream.waitFor(() => of(id, 'run_end').length > ends, 30_000)
    return response.body as { runId: string }
  }
  /** 等待源 Session 的第 n 个 handoff 条目，并订阅目标 Session 直到 handoff_origin 与权限条目到达。 */
  const handedOff = async (n = 1) => {
    await stream.waitFor(() => of(sessionId, 'handoff').length >= n, 30_000)
    const entry = of(sessionId, 'handoff')[n - 1]!
    const targetId = (entry.payload as { targetSessionId: string }).targetSessionId
    await subscribe(targetId)
    await stream.waitFor(() => of(targetId, 'permission_mode').length > 0, 10_000)
    return { entry, targetId }
  }
  /**
   * 等待交接处理结束（Run 结束之后的目标创建或放弃）：处理中再次交接为 409 run-in-progress；结束之后以不存在的 worktree 为目标时 404，
   * 不开始 Run。
   */
  const settled = async () => {
    const deadline = Date.now() + 10_000
    for (;;) {
      const probe = await api.post(handoffPaths.handoff(sessionId), { instructions: 'probe', target: { kind: 'worktree', worktreeId: 'missing' } })
      if (probe.status === 404) return
      expect([probe.status, probe.body.error?.code]).toEqual([409, 'run-in-progress'])
      if (Date.now() > deadline) throw new Error('handoff still pending')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  return { sidecar, api, stream, workspaceId, sessionId, requests, of, send, handedOff, subscribe, settled }
}

const kinds = (entries: SessionEntryRecord[]) => entries.map((e) => e.kind)
const lastText = (request: Logged) => {
  const last = request.at(-1)!
  return typeof last.content === 'string' ? last.content : last.content.map((b) => b.text ?? '').join('')
}

describe('交接：摘要与目标 Session', { timeout: 120_000 }, () => {
  it('/handoff 接着实现登录页：一次 trigger handoff 的摘要请求（有效上下文 + 指令、无工具）；目标继承模型、档位、模式与规则，不继承状态', async () => {
    const h = await boot([
      { content: [call('todo_write', 't1', { items: [{ content: 'draft the form', status: 'in_progress' }] })] },
      { content: 'form drafted' },
      { content: SUMMARY, ...usage(300, 40) },
    ])
    const rule = { behavior: 'allow', tool: 'Bash', content: 'pnpm test *' }
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })).status).toBe(200)
    expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule })).status).toBe(200)
    await h.send('start the login form')
    const before = h.stream.entries(h.sessionId).map((e) => e.seq)
    const sessionsBefore = (await h.api.get(API_ROUTES.sessions)).body.sessions as { id: string }[]

    const { runId } = await h.send('/handoff 接着实现登录页')
    const { entry, targetId } = await h.handedOff()

    // 摘要 Run：run_start / run_end 之外只有 handoff（同一 runId），之前的条目不变。
    const runEntries = h.stream.entries(h.sessionId).filter((e) => e.runId === runId)
    expect(kinds(runEntries)).toEqual(['run_start', 'run_end', 'handoff'])
    expect(runEntries[0]!.payload).toEqual({ trigger: 'handoff' })
    expect(runEntries[1]!.payload).toEqual({ status: 'completed' })
    expect(
      h.stream
        .entries(h.sessionId)
        .filter((e) => e.runId !== runId)
        .map((e) => e.seq),
    ).toEqual(before)
    expect(entry.payload).toEqual({
      targetSessionId: targetId,
      instructions: '接着实现登录页',
      summary: SUMMARY,
      target: 'current',
      usage: expect.objectContaining({ input: 300, output: 40 }),
    })

    // requestLog：第三次请求是摘要请求，含之前的有效上下文，最后一条是带指令的摘要提示；之后没有请求。
    const requests = await h.requests()
    expect(requests).toHaveLength(3)
    const summary = requests[2]!
    expect(JSON.stringify(summary)).toContain('start the login form')
    expect(JSON.stringify(summary)).toContain('form drafted')
    expect(lastText(summary)).toContain('## Open items')
    expect(lastText(summary)).toContain('<next-goal>\n接着实现登录页\n</next-goal>')

    // 目标 Session：首条 handoff_origin 指向源 handoff 条目；权限与源相同；没有消息、Goal、Todo、计划与 Job 条目。
    const target = h.stream.entries(targetId)
    expect(kinds(target)).toEqual(['handoff_origin', 'permission_mode', 'permission_mode', 'permission_rule'])
    expect(target[0]!.payload).toEqual({ sessionId: h.sessionId, seq: entry.seq })
    const [sourcePerms, targetPerms] = await Promise.all([
      h.api.get(permissionPaths.sessionPermissionRules(h.sessionId)),
      h.api.get(permissionPaths.sessionPermissionRules(targetId)),
    ])
    expect(targetPerms.body).toEqual(sourcePerms.body)
    expect(targetPerms.body).toEqual({ mode: 'accept-edits', rules: [rule] })
    const [source, created] = await Promise.all([h.api.get(apiPaths.session(h.sessionId)), h.api.get(apiPaths.session(targetId))])
    expect(created.body.session).toMatchObject({ workspaceId: h.workspaceId, title: '接着实现登录页', running: false })
    expect(created.body.session.model).toEqual(source.body.session.model)
    expect(created.body.session.thinkingLevel).toBe(source.body.session.thinkingLevel)
    expect(created.body.session.worktree).toBeUndefined()
    expect((await h.api.get(goalPaths.sessionGoal(targetId))).body.goal).toBeNull()
    expect(h.of(h.sessionId, 'todo_list')).toHaveLength(1)
    const sessionsAfter = (await h.api.get(API_ROUTES.sessions)).body.sessions as { id: string }[]
    expect(sessionsAfter.map((s) => s.id).sort()).toEqual([...sessionsBefore.map((s) => s.id), targetId].sort())
    expect(h.stream.invalidEntries).toEqual([])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('POST /api/sessions/:id/handoff 202 { runId }；没有用户消息 400；Run 进行中 409；摘要 Run 被停止时不创建目标 Session 与 worktree', async () => {
    const fixture = await createGitWorkspace()
    onTestFinished(() => fixture.dispose())
    // 摘要回复以每秒 50 token 流出：Run 进行中可以再次交接（409）与停止。
    const h = await boot([{ content: 'hello there' }, { content: 'z'.repeat(20_000) }], {
      workspaceDir: fixture.root,
      env: fixture.env,
      script: { tokensPerSecond: 50 },
    })
    const handoff = (body: unknown) => h.api.post(handoffPaths.handoff(h.sessionId), body)
    const empty = await handoff({ instructions: 'next', target: { kind: 'current' } })
    expect([empty.status, empty.body.error?.code]).toEqual([400, 'nothing-to-hand-off'])
    expect((await handoff({ instructions: '', target: { kind: 'current' } })).status).toBe(400)
    await h.send('hi')

    const started = await handoff({ instructions: 'continue elsewhere', target: { kind: 'new-worktree', name: 'stopped' } })
    expect(started.status).toBe(202)
    const runId = (started.body as { runId: string }).runId
    expect(typeof runId).toBe('string')
    const again = await handoff({ instructions: 'again', target: { kind: 'current' } })
    expect([again.status, again.body.error?.code]).toEqual([409, 'run-in-progress'])
    const typed = await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: '/handoff again' })
    expect([typed.status, typed.body.error?.code]).toEqual([409, 'run-in-progress'])
    expect((await h.api.post(apiPaths.sessionAbort(h.sessionId), {})).status).toBe(200)
    await h.stream.waitFor(() => h.of(h.sessionId, 'run_end').length >= 2, 30_000)
    expect(h.of(h.sessionId, 'run_end').at(-1)!.payload).toMatchObject({ status: 'aborted' })
    // Run 结束之后的交接处理（放弃这次交接）完成之后再检查。
    await h.settled()

    // 停止：没有 handoff 条目、没有新 Session、没有 worktree（git 与记录都没有）。
    expect(h.of(h.sessionId, 'handoff')).toEqual([])
    expect((await h.api.get(API_ROUTES.sessions)).body.sessions.length).toBe(1)
    expect((await h.api.get(worktreePaths.workspaceWorktrees(h.workspaceId))).body).toEqual([])
    expect((await fixture.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1)
    expect((await fixture.git('branch', '--list', 'coko/*')).trim()).toBe('')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('交接：目标 worktree', { timeout: 120_000 }, () => {
  it('新 worktree：git-status 为源的未提交文件数；目标绑定新 worktree，工作目录为其路径；再次交接到已有 worktree 时复用', async () => {
    const fixture = await createGitWorkspace({ files: { 'README.md': '# app\n', 'src/a.ts': 'export {}\n' } })
    onTestFinished(() => fixture.dispose())
    const h = await boot(
      [
        { match: 'work on it', content: 'working' },
        { match: 'into login', content: SUMMARY },
        { match: 'print cwd', content: [call('bash', 'b1', { command: 'pwd -P' })] },
        { match: 'print cwd', content: 'done' },
        { match: 'reuse login', content: '## Task\nreuse' },
      ],
      { workspaceDir: fixture.root, env: fixture.env },
    )
    await writeFile(join(fixture.root, 'README.md'), '# changed\n')
    await writeFile(join(fixture.root, 'notes.txt'), 'untracked\n')
    expect((await h.api.get(worktreePaths.sessionGitStatus(h.sessionId))).body).toEqual({ repo: true, branch: 'main', dirtyFiles: 2 })
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'full-access' })).status).toBe(200)
    await h.send('work on it')

    const started = await h.api.post(handoffPaths.handoff(h.sessionId), { instructions: 'move into login', target: { kind: 'new-worktree', name: 'login' } })
    expect(started.status).toBe(202)
    const first = await h.handedOff(1)
    expect(first.entry.payload).toMatchObject({ target: 'worktree', summary: SUMMARY })
    const created = (await h.api.get(apiPaths.session(first.targetId))).body.session
    expect(created.worktree).toMatchObject({ name: 'login', branch: 'coko/login', status: 'active' })
    const path = join(fixture.root, '.coko-worktrees', 'login')
    expect(await fixture.git('worktree', 'list', '--porcelain')).toContain('worktree ' + path)
    // 未提交的改动不随交接复制：新 worktree 干净。
    expect((await h.api.get(worktreePaths.sessionGitStatus(first.targetId))).body).toEqual({ repo: true, branch: 'coko/login', dirtyFiles: 0 })
    // 目标 Session 的模式（full-access）与源相同；bash 在 worktree 中执行。
    await h.send('print cwd', first.targetId)
    const result = h.stream.entries(first.targetId).find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'b1')!
    expect(JSON.stringify(result.payload)).toContain(path)

    const worktreeId = created.worktree.id as string
    await h.api.post(handoffPaths.handoff(h.sessionId), { instructions: 'reuse login', target: { kind: 'worktree', worktreeId } })
    const second = await h.handedOff(2)
    expect((await h.api.get(apiPaths.session(second.targetId))).body.session.worktree?.id).toBe(worktreeId)
    const worktrees = (await h.api.get(worktreePaths.workspaceWorktrees(h.workspaceId))).body as { id: string; sessionCount: number }[]
    expect(worktrees.map((w) => [w.id, w.sessionCount])).toEqual([[worktreeId, 2]])
    expect((await fixture.git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(2)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('交接：Goal 预算', { timeout: 120_000 }, () => {
  const failed = (input: number, output: number) => ({ content: [], stopReason: 'error', errorMessage: 'invalid request', ...usage(input, output) })

  /**
   * Goal running 且 Session 空闲：建 Goal 的 Run 不属于 Goal（开始时 Goal 还不存在），之后用户提交的 Run 以不重试的模型错误结束时不推进 Goal，
   * 它的 usage 计入 Goal（与 sidecar-goal-budget 的 /compact 用例相同的构造）。
   */
  async function idleGoal(goalRunUsage: [number, number], rest: unknown[]) {
    const h = await boot([
      { content: [call('create_goal', 'cg', { objective: 'o', criteria: ['done'], budget: { max_tokens: 1000 } })] },
      failed(1, 1),
      failed(...goalRunUsage),
      ...rest,
    ])
    await h.send('set a goal')
    await h.send('keep going')
    const state = (await h.api.get(goalPaths.sessionGoal(h.sessionId))).body
    expect(state).toMatchObject({ goal: { phase: 'running' }, usage: { tokens: goalRunUsage[0] + goalRunUsage[1] } })
    expect(await h.requests()).toHaveLength(3)
    return h
  }

  it('对手用例：Goal running 且 Token 已耗尽时 /handoff 不发摘要请求，Run 以 paused + budget_exhausted 结束，没有目标 Session', async () => {
    const h = await idleGoal([900, 200], [{ content: '## Task\nMUST-NOT-SUMMARIZE' }])
    await h.send('/handoff 接着实现登录页')
    const start = h.of(h.sessionId, 'run_start').at(-1)!
    expect(start.payload).toEqual({ trigger: 'handoff' })
    expect(h.of(h.sessionId, 'run_end').at(-1)!.payload).toEqual({
      status: 'paused',
      error: { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens (1100 / 1000)' },
    })
    await h.stream.waitFor(() => h.of(h.sessionId, 'goal').some((e) => (e.payload as { phase: string }).phase === 'budget-exhausted'), 10_000)
    expect(await h.requests()).toHaveLength(3)
    expect(h.of(h.sessionId, 'handoff')).toEqual([])
    expect((await h.api.get(API_ROUTES.sessions)).body.sessions.length).toBe(1)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('正常交接的 handoff.usage 计入 Goal 的 tokens；交接完成后源 Goal 暂停（handed-off），不再发起 Goal Round', async () => {
    const h = await idleGoal([1, 1], [{ content: SUMMARY, ...usage(1000, 98) }, { content: 'MUST-NOT-BE-REQUESTED' }])
    await h.send('/handoff 接着实现登录页')
    await h.handedOff()
    expect(h.of(h.sessionId, 'handoff')[0]!.payload).toMatchObject({ usage: { input: 1000, output: 98 } })
    await h.stream.waitFor(() => h.of(h.sessionId, 'goal').some((e) => (e.payload as { phase: string }).phase === 'paused'), 30_000)
    const state = (await h.api.get(goalPaths.sessionGoal(h.sessionId))).body
    expect(state.usage.tokens).toBe(1100)
    expect(state.goal).toMatchObject({ phase: 'paused', reason: { code: 'handed-off' } })
    // 交接之后没有 Goal Round：只有建 Goal、两次失败与摘要请求。
    expect(h.of(h.sessionId, 'run_start').filter((e) => (e.payload as { trigger: string }).trigger === 'goal').length).toBe(
      h.of(h.sessionId, 'run_start').filter((e) => (e.payload as { trigger: string }).trigger === 'goal' && e.seq < h.of(h.sessionId, 'handoff')[0]!.seq)
        .length,
    )
    expect(await h.requests()).toHaveLength(4)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

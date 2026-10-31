// HandoffService：内存存储、伪造的 Run 与 worktree 能力。准入（子 Session、Run 进行中、没有用户消息、目标校验）、摘要 Run 结束后的目标创建与
// 停止时不创建、目标仍在创建时之后 Run 的请求等待 handoff 条目再重查 Goal 预算。端到端行为见 tests/integration/sidecar-handoff.test.ts。
import { SESSION_ENTRY_PAYLOADS, type RunEntry, type RunResult } from '@coko/agent'
import type { Worktree } from '@coko/protocol'
import { createPayloadRegistry, type SessionStore } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import type { RunRequest } from './context/types.ts'
import { AppError } from './errors.ts'
import { HandoffService, handoffTitle, type HandoffWorktrees } from './handoff.ts'
import { toNewEntry } from './session-runtimes.ts'

const user = (text: string): RunEntry => ({ kind: 'message', payload: { role: 'user', content: [{ type: 'text', text }], timestamp: 0 } })
const worktree = (extra: Partial<Worktree>): Worktree => ({
  id: 'wt1',
  workspaceId: 'w',
  name: 'feat',
  path: '/r/.coko-worktrees/feat',
  branch: 'coko/feat',
  baseCommit: 'abc',
  status: 'active',
  createdBy: 'user',
  sessionCount: 0,
  ...extra,
})

async function setup(options: { worktrees?: Partial<HandoffWorktrees>; goalStop?: boolean } = {}) {
  const store: SessionStore = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: '/tmp/handoff-unit' })
  const commit = async (sessionId: string, entry: RunEntry) => (await store.sessions.appendEntries(sessionId, [toNewEntry(entry)]))[0]!
  const started: { sessionId: string; request: RunRequest }[] = []
  let running = false
  let next = 0
  const created: string[] = []
  const goalChecks: string[] = []
  const service = new HandoffService({
    store,
    entries: { list: (id) => store.sessions.listEntries(id), commit },
    runs: {
      isRunning: () => running,
      createSession: (input) => store.sessions.createSession(input),
      async startRun(sessionId, request) {
        started.push({ sessionId, request })
        const runId = `r${++next}`
        await commit(sessionId, { kind: 'run_start', runId, payload: { trigger: request.trigger === 'handoff' ? 'handoff' : 'submit' } })
        return { runId }
      },
    },
    worktrees: {
      get: async (id) => {
        if (id !== 'wt1' && id !== 'wt-removed' && id !== 'wt-other') throw new AppError('not-found', 'no')
        return worktree({ id, workspaceId: id === 'wt-other' ? 'elsewhere' : workspace.id, status: id === 'wt-removed' ? 'removed' : 'active' })
      },
      list: async () => [worktree({ workspaceId: workspace.id })],
      create: async (_workspaceId, input) => {
        created.push(input.name ?? '')
        const record = await store.worktrees.create({
          workspaceId: workspace.id,
          name: input.name ?? 'wt-gen',
          path: '/r/.coko-worktrees/' + (input.name ?? 'wt-gen'),
          branch: 'coko/' + (input.name ?? 'wt-gen'),
          baseCommit: 'abc',
          repoRoot: '/r',
          createdBy: 'user',
        })
        return worktree({ id: record.id, workspaceId: workspace.id, name: record.name })
      },
      gitStatus: async () => ({ repo: true }),
      ...options.worktrees,
    },
    goals: {
      handedOff: async () => undefined,
      beforeRequest: async (sessionId, runId) => {
        goalChecks.push(`${sessionId}:${runId}`)
        return options.goalStop ? { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens', dimension: 'tokens' } : undefined
      },
    },
  })
  const session = await store.sessions.createSession({
    workspaceId: workspace.id,
    title: 'src',
    model: { providerId: 'p', modelId: 'm' },
    thinkingLevel: 'high',
  })
  await commit(session.id, { kind: 'permission_mode', payload: { mode: 'accept-edits' } })
  const setRunning = (value: boolean) => void (running = value)
  return { store, workspace, session, service, started, created, goalChecks, commit, setRunning }
}

const completed = (summary: string): RunResult => ({
  runId: 'r1',
  status: 'completed',
  summary,
  summaryUsage: {
    input: 5,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 7,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } as never,
})

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof AppError ? `${error.status} ${error.code}` : String(error)),
  )

describe('HandoffService.start 准入', () => {
  it('没有用户消息 400 nothing-to-hand-off；指令为空 400；子 Session 409 child-session；Run 进行中 409 run-in-progress；都不开始 Run', async () => {
    const h = await setup()
    expect(await code(h.service.start(h.session.id, { instructions: 'next', target: { kind: 'current' } }))).toBe('400 nothing-to-hand-off')
    await h.commit(h.session.id, user('hello'))
    expect(await code(h.service.start(h.session.id, { instructions: '   ', target: { kind: 'current' } }))).toBe('400 bad-request')
    const child = await h.store.sessions.createSession({ workspaceId: h.workspace.id, parentSessionId: h.session.id })
    await h.commit(child.id, user('child work'))
    expect(await code(h.service.start(child.id, { instructions: 'next', target: { kind: 'current' } }))).toBe('409 child-session')
    h.setRunning(true)
    expect(await code(h.service.start(h.session.id, { instructions: 'next', target: { kind: 'current' } }))).toBe('409 run-in-progress')
    expect(h.started).toEqual([])
  })

  it('目标校验：不存在 404、别的 Workspace 400、已移除 409、名字不合法 400、不是 git 仓库 400、重名 409', async () => {
    const h = await setup()
    await h.commit(h.session.id, user('hello'))
    const start = (target: Parameters<HandoffService['start']>[1]['target']) => code(h.service.start(h.session.id, { instructions: 'n', target }))
    expect(await start({ kind: 'worktree', worktreeId: 'missing' })).toBe('404 not-found')
    expect(await start({ kind: 'worktree', worktreeId: 'wt-other' })).toBe('400 bad-request')
    expect(await start({ kind: 'worktree', worktreeId: 'wt-removed' })).toBe('409 worktree-removed')
    expect(await start({ kind: 'new-worktree', name: 'Bad Name' })).toBe('400 invalid-name')
    expect(await start({ kind: 'new-worktree', name: 'feat' })).toBe('409 worktree-exists')
    const plain = await setup({ worktrees: { gitStatus: async () => ({ repo: false }) } })
    await plain.commit(plain.session.id, user('hello'))
    expect(await code(plain.service.start(plain.session.id, { instructions: 'n', target: { kind: 'new-worktree' } }))).toBe('400 not-a-git-repo')
    expect(h.started).toEqual([])
    expect(h.created).toEqual([])
  })

  it('开始 trigger handoff 的 Run（提示含下一步目标）；目标仍在创建时再次交接 409', async () => {
    const h = await setup()
    await h.commit(h.session.id, user('hello'))
    expect(await h.service.start(h.session.id, { instructions: ' build the login page ', target: { kind: 'current' } })).toEqual({ runId: 'r1' })
    expect(h.started).toHaveLength(1)
    const request = h.started[0]!.request
    expect(request.trigger).toBe('handoff')
    expect(request.trigger === 'handoff' && request.input.text).toContain('<next-goal>\nbuild the login page\n</next-goal>')
    expect(await code(h.service.start(h.session.id, { instructions: 'again', target: { kind: 'current' } }))).toBe('409 run-in-progress')
  })
})

describe('HandoffService.runEnded', () => {
  it('正常结束：目标 Session 同 Workspace、模型与档位，首条 handoff_origin 指向源 handoff 条目，之后为权限条目；源 handoff 带同一 runId 与 usage', async () => {
    const h = await setup()
    await h.commit(h.session.id, user('hello'))
    await h.commit(h.session.id, { kind: 'todo_list', payload: { items: [{ id: 't1', content: 'x', status: 'pending' }] } })
    await h.service.start(h.session.id, { instructions: 'build the login page', target: { kind: 'new-worktree', name: 'login' } })
    await h.service.runEnded({ sessionId: h.session.id, runId: 'r1', trigger: 'handoff', result: completed('  ## Task\nlogin  ') })
    const source = await h.store.sessions.listEntries(h.session.id)
    const handoff = source.find((e) => e.kind === 'handoff')!
    expect(handoff.runId).toBe('r1')
    expect(handoff.payload).toMatchObject({
      instructions: 'build the login page',
      summary: '## Task\nlogin',
      target: 'worktree',
      usage: { input: 5, output: 2 },
    })
    const targetId = (handoff.payload as { targetSessionId: string }).targetSessionId
    const target = (await h.store.sessions.getSession(targetId))!
    expect(target).toMatchObject({
      workspaceId: h.workspace.id,
      model: { providerId: 'p', modelId: 'm' },
      thinkingLevel: 'high',
      title: 'build the login page',
    })
    expect((await h.store.worktrees.get(target.worktreeId!))?.name).toBe('login')
    expect((await h.store.sessions.listEntries(targetId)).map((e) => [e.kind, e.payload])).toEqual([
      ['handoff_origin', { sessionId: h.session.id, seq: handoff.seq }],
      ['permission_mode', { mode: 'accept-edits' }],
    ])
  })

  it.each([
    ['aborted', { runId: 'r1', status: 'aborted' }],
    ['paused（预算）', { runId: 'r1', status: 'paused', error: { code: 'budget_exhausted', message: 'Goal budget exhausted' } }],
    ['error', { runId: 'r1', status: 'error', error: { code: 'model_error', message: 'x' } }],
  ] as [string, RunResult][])('%s：不创建 worktree 与目标 Session，可以再次交接', async (_name, result) => {
    const h = await setup()
    await h.commit(h.session.id, user('hello'))
    await h.service.start(h.session.id, { instructions: 'n', target: { kind: 'new-worktree', name: 'login' } })
    await h.service.runEnded({ sessionId: h.session.id, runId: 'r1', trigger: 'handoff', result })
    expect(h.created).toEqual([])
    expect((await h.store.sessions.listSessions({})).map((s) => s.id)).toEqual([h.session.id])
    expect((await h.store.sessions.listEntries(h.session.id)).some((e) => e.kind === 'handoff')).toBe(false)
    expect(await code(h.service.start(h.session.id, { instructions: 'n', target: { kind: 'current' } }))).toBe('ok')
  })

  it('不是交接的 Run 结束时不处理', async () => {
    const h = await setup()
    await h.commit(h.session.id, user('hello'))
    await h.service.start(h.session.id, { instructions: 'n', target: { kind: 'current' } })
    await h.service.runEnded({ sessionId: h.session.id, runId: 'r9', trigger: 'goal', result: completed('x') })
    expect((await h.store.sessions.listEntries(h.session.id)).some((e) => e.kind === 'handoff')).toBe(false)
  })
})

describe('交接目标在摘要之后没能创建', () => {
  it('worktree 名在校验之后被占用：提交带 usage 与摘要的 handoff_failed，不创建目标；之后可以再交接', async () => {
    const h = await setup({
      worktrees: {
        create: async () => {
          throw new AppError('worktree-exists', 'A worktree named late already exists')
        },
      },
    })
    await h.commit(h.session.id, user('hello'))
    await h.service.start(h.session.id, { instructions: 'next', target: { kind: 'new-worktree', name: 'late' } })
    await h.service.runEnded({ sessionId: h.session.id, runId: 'r1', trigger: 'handoff', result: completed('## Task') })
    const entries = await h.store.sessions.listEntries(h.session.id)
    expect(entries.some((e) => e.kind === 'handoff')).toBe(false)
    expect(entries.filter((e) => e.kind === 'handoff_failed').map((e) => [e.runId, e.payload])).toEqual([
      [
        'r1',
        expect.objectContaining({
          instructions: 'next',
          error: { code: 'worktree-exists', message: expect.any(String) },
          usage: expect.objectContaining({ input: 5 }),
        }),
      ],
    ])
    expect((entries.find((e) => e.kind === 'handoff_failed')!.payload as { summary: string }).summary).toContain('## Task')
    expect((await h.store.sessions.listSessions({})).map((s) => s.id)).toEqual([h.session.id])
    expect(await code(h.service.start(h.session.id, { instructions: 'again', target: { kind: 'current' } }))).toBe('ok')
  })
})

describe('HandoffService.beforeRequest', () => {
  it('摘要 Run 自身不等待、不重查；之后的 Run 等到 handoff 条目提交再按 Goal 预算重查（对手用例：之后的请求不能先于交接用量）', async () => {
    const h = await setup({ goalStop: true })
    await h.commit(h.session.id, user('hello'))
    await h.service.start(h.session.id, { instructions: 'n', target: { kind: 'current' } })
    expect(await h.service.beforeRequest(h.session.id, 'r1')).toBeUndefined()
    expect(h.goalChecks).toEqual([])
    // Goal 的下一轮在 handoff 条目提交之前开始。
    await h.commit(h.session.id, { kind: 'run_start', runId: 'r2', payload: { trigger: 'goal', goal: { goalId: 'g1', round: 1 } } })
    // 屏障：beforeRequest 读完条目（之后才等待 pending.done）时放行断言，不用固定 sleep。
    const listEntries = h.store.sessions.listEntries.bind(h.store.sessions)
    let listed!: () => void
    const read = new Promise<void>((r) => (listed = r))
    h.store.sessions.listEntries = async (...args) => {
      const entries = await listEntries(...args)
      listed()
      return entries
    }
    let settled: unknown = 'pending'
    const verdict = h.service.beforeRequest(h.session.id, 'r2').then((v) => (settled = v))
    await read
    for (let i = 0; i < 5; i++) await Promise.resolve()
    h.store.sessions.listEntries = listEntries
    expect(settled).toBe('pending')
    expect(h.goalChecks).toEqual([])
    await h.service.runEnded({ sessionId: h.session.id, runId: 'r1', trigger: 'handoff', result: completed('## Task') })
    await verdict
    expect(settled).toMatchObject({ code: 'budget_exhausted' })
    expect(h.goalChecks).toEqual([`${h.session.id}:r2`])
    // 没有进行中的交接时不检查。
    expect(await h.service.beforeRequest(h.session.id, 'r3')).toBeUndefined()
    expect(h.goalChecks).toHaveLength(1)
  })
})

describe('handoffTitle', () => {
  it('首行，过长截断为 60 字符', () => {
    expect(handoffTitle('  first line\nsecond')).toBe('first line')
    expect(handoffTitle('x'.repeat(80))).toHaveLength(60)
  })
})

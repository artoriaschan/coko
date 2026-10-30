// Goal：真实 Sidecar（faux 模型）经协议驱动。create_goal 之后无人操作时 Goal Round 依次开始直到给出完整证据；证据不完整时拒绝；轮次上限进入
// budget-exhausted；Goal Round 中的审批、停止（waiting-input）与用户追加指令（不重复发起同一轮）；wait_jobs 后 Job 结束时下一轮开始；
// POST …/goal 的动作与 409；取消的停止传播（Run 与该 Goal 的 Job）；/goal 的动作；分叉不复制 Goal、回退对话不改变 Goal。
// Goal 的条目与注入来自已提交的快照，不读取文件，不涉及符号链接越界。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, goalPaths, jobPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>
type LoggedMessage = { role: string; content?: unknown; sections?: Record<string, string | null> }
type Goal = { id: string; revision: number; phase: string; reason?: { code: string; message: string }; [key: string]: unknown }

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const createGoal = (criteria: string[], extra: Record<string, unknown> = {}) => call('create_goal', 'cg', { objective: 'fix the tests', criteria, ...extra })

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  return { sidecar, api, stream, workspaceId, workspaceDir, requests }
}

async function newSession(api: Api, stream: Stream, workspaceId: string, mode?: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  if (mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })
    if (changed.status !== 200) throw new Error('permission mode not set: ' + changed.status)
  }
  await subscribe(stream, sessionId)
  return sessionId
}

async function subscribe(stream: Stream, sessionId: string) {
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
}

const of = (stream: Stream, sessionId: string, kind: string) => stream.entries(sessionId).filter((e) => e.kind === kind)
const goals = (stream: Stream, sessionId: string) => of(stream, sessionId, 'goal').map((e) => e.payload as Goal)
const starts = (stream: Stream, sessionId: string) => of(stream, sessionId, 'run_start').map((e) => e.payload)
const phases = (stream: Stream, sessionId: string) => goals(stream, sessionId).map((g) => g.phase)
const waitGoal = (stream: Stream, sessionId: string, test: (goal: Goal) => boolean, n = 1) =>
  stream.waitFor(() => goals(stream, sessionId).filter(test).length >= n, 30_000)
const toolResults = (stream: Stream, sessionId: string, toolName: string) =>
  of(stream, sessionId, 'message')
    .map((e) => e.payload as { role: string; toolName?: string; isError?: boolean; content?: { text: string }[] })
    .filter((m) => m.role === 'toolResult' && m.toolName === toolName)
    .map((m) => ({ isError: m.isError, text: m.content?.[0]?.text ?? '' }))
const textOf = (message: LoggedMessage | undefined) =>
  !message ? '' : typeof message.content === 'string' ? message.content : ((message.content ?? []) as { text?: string }[]).map((b) => b.text ?? '').join('')
const lastUser = (messages: LoggedMessage[]) => textOf(messages.filter((m) => m.role === 'user').at(-1))
function sectionsOf(messages: LoggedMessage[]) {
  const sections: Record<string, string> = {}
  for (const m of messages) {
    if (m.role !== 'system') continue
    for (const [name, text] of Object.entries(m.sections ?? {})) {
      if (text === null) delete sections[name]
      else sections[name] = text
    }
  }
  return sections
}

async function submit(api: Api, sessionId: string, text: string) {
  const res = await api.post(apiPaths.sessionMessages(sessionId), { text })
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 202 })
  return res.body.runId as string
}
const action = (api: Api, sessionId: string, body: Record<string, unknown>) => api.post(goalPaths.sessionGoal(sessionId), body)

describe('Goal', { timeout: 120_000 }, () => {
  it('create_goal 后 Goal Round 依次开始；证据不完整被拒，完整证据后 complete，不再推进', async () => {
    const evidence = [
      { criterion_id: 'c1', text: 'echo printed ok', tool_call_ids: ['b1'] },
      { criterion_id: 'c2', text: 'summary given' },
    ]
    const { sidecar, api, stream, workspaceId, requests } = await boot([
      { content: [createGoal(['tests pass', 'summary given'], { budget: { max_rounds: 5 } })] },
      { content: 'goal set' },
      // Goal Round 1。
      { content: [call('bash', 'b1', { command: 'echo ok' })] },
      { content: 'round 1 progress' },
      // Goal Round 2：缺 c2、引用不存在的调用、完整证据。
      { content: [call('update_goal', 'u1', { goal_id: 'goal-1', revision: 1, action: 'complete', evidence: [evidence[0]] })] },
      {
        content: [
          call('update_goal', 'u2', {
            goal_id: 'goal-1',
            revision: 1,
            action: 'complete',
            evidence: [evidence[0], { ...evidence[1], tool_call_ids: ['nope'] }],
          }),
        ],
      },
      { content: [call('update_goal', 'u3', { goal_id: 'goal-1', revision: 1, action: 'complete', evidence })] },
      { content: 'all done' },
    ])
    const sessionId = await newSession(api, stream, workspaceId, 'full-access')
    await submit(api, sessionId, 'make the tests pass')
    await waitGoal(stream, sessionId, (g) => g.phase === 'complete')
    await stream.waitFor(() => of(stream, sessionId, 'run_end').length >= 3, 30_000)

    expect(starts(stream, sessionId)).toEqual([
      { trigger: 'submit' },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 1 } },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } },
    ])
    expect(goals(stream, sessionId).map((g) => [g.revision, g.phase, g.source])).toEqual([
      [1, 'running', 'model'],
      [2, 'complete', 'model'],
    ])
    expect(goals(stream, sessionId)[0]).toMatchObject({
      criteria: [
        { id: 'c1', text: 'tests pass' },
        { id: 'c2', text: 'summary given' },
      ],
      budget: { maxRounds: 5 },
      resumedAtRound: 0,
    })
    expect(goals(stream, sessionId)[1]).toMatchObject({
      completedBy: 'model',
      evidence: [
        { criterionId: 'c1', text: 'echo printed ok', toolCallIds: ['b1'] },
        { criterionId: 'c2', text: 'summary given' },
      ],
    })
    const results = toolResults(stream, sessionId, 'update_goal')
    expect(results.map((r) => r.isError)).toEqual([true, true, false])
    expect(results[0]!.text).toMatch(/Missing evidence for criterion c2/)
    expect(results[1]!.text).toMatch(/cites tool call nope, which has no successful result/)
    expect(JSON.parse(results[2]!.text)).toMatchObject({ goal: { id: 'goal-1', revision: 2, phase: 'complete', round: 2 } })
    expect(JSON.parse(toolResults(stream, sessionId, 'create_goal')[0]!.text)).toMatchObject({
      goal: { id: 'goal-1', revision: 1, phase: 'running', round: 0 },
    })

    const goal = await api.get(goalPaths.sessionGoal(sessionId))
    expect(goal.status).toBe(200)
    expect(goal.body).toMatchObject({ goal: { id: 'goal-1', revision: 2, phase: 'complete' }, usage: { rounds: 2 } })

    // 有序关闭等待全部 Run：之后的 requestLog 是确定的（complete 之后没有第三轮）。
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const log = await requests()
    expect(log).toHaveLength(8)
    // 第一个 Run 开始时没有 Goal；Goal Round 的输入为 <goal_round>，每个 Run 注入 <goal>。
    expect(sectionsOf(log[0]!).goal).toBeUndefined()
    expect(lastUser(log[2]!)).toMatch(/^<goal_round>\nObjective: "fix the tests"\nSuccess criteria:\n- c1: tests pass\n- c2: summary given\nRound: 1 \/ 5\n/)
    expect(lastUser(log[4]!)).toContain('Round: 2 / 5')
    expect(lastUser(log[4]!)).toContain('Treat the current workspace, tool results and committed session state as authoritative')
    for (const i of [2, 4]) {
      const section = sectionsOf(log[i]!).goal
      expect(section).toMatch(/^<goal>\nCurrent goal goal-1 \(revision 1\), phase running\./)
      expect(section).toContain('- c2: summary given')
    }
    // 轮次计入本轮（其 run_start 在 section 取值之前已提交）。
    expect(sectionsOf(log[2]!).goal).toContain('- rounds: 1 / 5')
    expect(sectionsOf(log[4]!).goal).toContain('- rounds: 2 / 5')
    expect(stream.invalidEntries).toEqual([])
  })

  it('轮次上限耗尽进入 budget-exhausted（rounds）；POST …/goal 的动作、revision-conflict 与 invalid-transition', async () => {
    const { sidecar, api, stream, workspaceId } = await boot([
      { content: [createGoal(['done'], { budget: { max_rounds: 2 } })] },
      { content: 'set' },
      { content: 'r1' },
      { content: 'r2' },
      { content: 'r3' },
    ])
    const sessionId = await newSession(api, stream, workspaceId)
    await submit(api, sessionId, 'go')
    await waitGoal(stream, sessionId, (g) => g.phase === 'budget-exhausted')
    expect(starts(stream, sessionId).map((s) => (s as { goal?: { round: number } }).goal?.round)).toEqual([undefined, 1, 2])
    expect(goals(stream, sessionId).at(-1)).toMatchObject({
      revision: 2,
      source: 'system',
      reason: { code: 'rounds', message: 'Goal budget exhausted: rounds (2 / 2)' },
    })

    const resume = await action(api, sessionId, { action: 'resume', revision: 2 })
    expect([resume.status, resume.body.error?.code]).toEqual([409, 'invalid-transition'])
    const stale = await action(api, sessionId, { action: 'pause', revision: 1 })
    expect([stale.status, stale.body.error?.code, stale.body.error?.details]).toEqual([409, 'revision-conflict', { expected: 1, actual: 2 }])
    expect((await action(api, sessionId, { action: 'jump', revision: 2 })).status).toBe(400)
    expect((await action(api, 'nope', { action: 'pause', revision: 1 })).status).toBe(404)

    const edited = await action(api, sessionId, { action: 'edit', revision: 2, budget: { maxRounds: 3 }, objective: 'fix all the tests' })
    expect(edited.status).toBe(200)
    expect(edited.body.goal).toMatchObject({
      revision: 3,
      phase: 'budget-exhausted',
      objective: 'fix all the tests',
      budget: { maxRounds: 3 },
      resumedAtRound: 2,
      source: 'user',
    })
    const resumed = await action(api, sessionId, { action: 'resume', revision: 3 })
    expect(resumed.status).toBe(200)
    expect(resumed.body.goal).toMatchObject({ revision: 4, phase: 'running', resumedAtRound: 2 })
    await waitGoal(stream, sessionId, (g) => g.phase === 'budget-exhausted' && g.revision === 5)
    expect(starts(stream, sessionId).at(-1)).toEqual({ trigger: 'goal', goal: { goalId: 'goal-1', round: 3 } })

    expect((await action(api, sessionId, { action: 'pause', revision: 5 })).body.error?.code).toBe('invalid-transition')
    const completed = await action(api, sessionId, { action: 'complete', revision: 5 })
    expect(completed.body).toMatchObject({ goal: { phase: 'complete', completedBy: 'user', revision: 6 }, usage: { rounds: 3 } })
    expect(completed.body.goal).not.toHaveProperty('evidence')
    expect((await action(api, sessionId, { action: 'cancel', revision: 6 })).body.error?.code).toBe('invalid-transition')
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Goal Round 中的审批与停止（waiting-input）、用户提交后回到 running；用户追加指令授权 edit，同一轮不重复发起', async () => {
    const write = (id: string, path: string) => call('write', id, { path, content: id })
    const { sidecar, api, stream, workspaceId, workspaceDir } = await boot([
      { content: [createGoal(['files written'], { budget: { max_rounds: 3 } })] },
      { content: 'set' },
      // Round 1：Goal Round 中 pause 被拒；write 待审批、批准后继续。
      { content: [call('update_goal', 'p1', { goal_id: 'goal-1', revision: 1, action: 'pause' })] },
      { content: [write('w1', 'a.txt')] },
      { content: 'r1 done' },
      // Round 2：write 待审批时被停止。
      { content: [write('w2', 'b.txt')] },
      // 用户提交。
      { content: 'ok' },
      // Round 3：审批期间用户追加指令；之后 edit 被接受。
      { content: [write('w3', 'c.txt')] },
      { content: [call('update_goal', 'e1', { goal_id: 'goal-1', revision: 3, action: 'edit', objective: 'fix the tests and lint' })] },
      { content: 'r3 done' },
    ])
    const sessionId = await newSession(api, stream, workspaceId)
    await submit(api, sessionId, 'go')

    const first = await waitApproval(stream, sessionId, 1)
    expect(first.toolCallId).toBe('w1')
    expect(toolResults(stream, sessionId, 'update_goal')[0]).toMatchObject({ isError: true, text: expect.stringMatching(/pause needs a user request/) })
    expect((await api.post(apiPaths.sessionApproval(sessionId, first.requestId), { decision: 'allow' })).status).toBe(204)

    const second = await waitApproval(stream, sessionId, 2)
    expect(second.toolCallId).toBe('w2')
    expect((await api.post(apiPaths.sessionAbort(sessionId))).status).toBeLessThan(300)
    await waitGoal(stream, sessionId, (g) => g.phase === 'waiting-input')
    expect(goals(stream, sessionId).at(-1)).toMatchObject({ revision: 2, reason: { code: 'approval-unanswered' } })
    expect(of(stream, sessionId, 'run_end').at(-1)!.payload).toMatchObject({ status: 'aborted' })

    await submit(api, sessionId, 'go ahead')
    const third = await waitApproval(stream, sessionId, 3)
    expect(third.toolCallId).toBe('w3')
    expect(goals(stream, sessionId).at(-1)).toMatchObject({ revision: 3, phase: 'running', source: 'system' })
    // Goal Round 进行中：提交为 409，追加指令照常送达。
    const busy = await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })
    expect([busy.status, busy.body.error?.code]).toEqual([409, 'run-in-progress'])
    expect((await api.post(runPaths.sessionSteer(sessionId), { text: 'also check lint' })).status).toBe(204)
    expect((await api.post(apiPaths.sessionApproval(sessionId, third.requestId), { decision: 'allow' })).status).toBe(204)
    await waitGoal(stream, sessionId, (g) => g.phase === 'budget-exhausted')

    expect(starts(stream, sessionId)).toEqual([
      { trigger: 'submit' },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 1 } },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } },
      { trigger: 'submit' },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 3 } },
    ])
    expect(phases(stream, sessionId)).toEqual(['running', 'waiting-input', 'running', 'running', 'budget-exhausted'])
    expect(goals(stream, sessionId)[3]).toMatchObject({ objective: 'fix the tests and lint', source: 'model', resumedAtRound: 3 })
    expect(toolResults(stream, sessionId, 'update_goal')[1]!.isError).toBe(false)
    expect(await readFile(join(workspaceDir, 'a.txt'), 'utf8')).toBe('w1')
    expect(await readFile(join(workspaceDir, 'c.txt'), 'utf8')).toBe('w3')
    await expect(readFile(join(workspaceDir, 'b.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('wait_jobs：Goal 进入 waiting-external，等待的 Job 结束后下一轮开始（通知合并在 <goal_round> 之前）；job_start 带 goalId', async () => {
    const { sidecar, api, stream, workspaceId, requests } = await boot([
      { content: [createGoal(['build succeeds'])] },
      { content: 'set' },
      { content: [call('bash', 'bg1', { command: 'sleep 3; echo built', run_in_background: true })] },
      { content: [call('update_goal', 'wj', { goal_id: 'goal-1', revision: 1, action: 'wait_jobs', job_ids: ['$LAST_JOB_ID'], reason: 'build running' })] },
      { content: 'waiting for the build' },
      {
        content: [
          call('update_goal', 'u1', {
            goal_id: 'goal-1',
            revision: 3,
            action: 'complete',
            evidence: [{ criterion_id: 'c1', text: 'built', tool_call_ids: ['bg1'] }],
          }),
        ],
      },
      { content: 'done' },
    ])
    const sessionId = await newSession(api, stream, workspaceId, 'full-access')
    await submit(api, sessionId, 'build it')
    await waitGoal(stream, sessionId, (g) => g.phase === 'waiting-external')
    const jobId = (of(stream, sessionId, 'job_start')[0]!.payload as { jobId: string; goalId?: string }).jobId
    expect(of(stream, sessionId, 'job_start')[0]!.payload).toMatchObject({ goalId: 'goal-1' })
    expect(goals(stream, sessionId).at(-1)).toMatchObject({ waitingFor: { jobIds: [jobId] }, reason: { code: 'waiting-jobs', message: 'build running' } })
    await waitGoal(stream, sessionId, (g) => g.phase === 'complete')

    expect(phases(stream, sessionId)).toEqual(['running', 'waiting-external', 'running', 'complete'])
    expect(starts(stream, sessionId)).toEqual([
      { trigger: 'submit' },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 1 } },
      { trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } },
    ])
    // job_end 在第二轮的 run_start 之前。
    const kinds = stream.entries(sessionId).map((e) => e.kind)
    expect(kinds.indexOf('job_end')).toBeLessThan(kinds.lastIndexOf('run_start'))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const round2 = (await requests())[5]!
    expect(lastUser(round2)).toMatch(/^<job-notification>[\s\S]*<\/job-notification>[\s\S]*<goal_round>/)
  })

  it('取消：进行中的 Run 结束、该 Goal 的 Job 停止，cancelled 快照带 cleanup', async () => {
    const { sidecar, api, stream, workspaceId } = await boot([
      { content: [createGoal(['done'])] },
      { content: 'set' },
      { content: [call('bash', 'bg', { command: 'sleep 60', run_in_background: true })] },
      { content: [call('bash', 'fg', { command: 'sleep 30' })] },
    ])
    const sessionId = await newSession(api, stream, workspaceId, 'full-access')
    await submit(api, sessionId, 'go')
    await stream.waitFor(() => of(stream, sessionId, 'tool_exec').length >= 2, 30_000)
    const cancelled = await action(api, sessionId, { action: 'cancel', revision: 1 })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.goal).toMatchObject({ phase: 'cancelled', revision: 2, source: 'user', cleanup: { runsAborted: 1, jobsKilled: 1, failures: [] } })
    // 返回时 Run 已结束、Job 已结束（job_end 已提交）。
    const detail = (await api.get(apiPaths.session(sessionId))).body
    const entries = detail.entries as SessionEntryRecord[]
    expect(entries.filter((e) => e.kind === 'run_end').at(-1)!.payload).toMatchObject({ status: 'aborted' })
    expect(entries.find((e) => e.kind === 'job_end')!.payload).toMatchObject({ status: 'killed' })
    expect(entries.findIndex((e) => e.kind === 'job_end')).toBeLessThan(entries.findLastIndex((e) => e.kind === 'goal'))
    expect((await api.get(jobPaths.sessionJobs(sessionId))).body.jobs).toMatchObject([{ status: 'killed', goalId: 'goal-1' }])
    expect(detail.session).toMatchObject({ running: false })
    expect(starts(stream, sessionId)).toHaveLength(2)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/goal pause 与 /goal cancel 在 Run 进行中可用；/goal resume 继续；/goal <目标> 请模型调用 create_goal', async () => {
    const { sidecar, api, stream, workspaceId, requests } = await boot([
      { content: [createGoal(['done'])] },
      { content: 'set' },
      { content: [call('bash', 'b1', { command: 'sleep 2' })] },
      // /goal resume 之后的第二轮。
      { content: [call('bash', 'b2', { command: 'sleep 30' })] },
      // /goal <目标>。
      { content: [call('create_goal', 'cg2', { objective: 'ship the release', criteria: ['released'], budget: { max_rounds: 1 } })] },
      { content: 'set 2' },
      { content: 'r1 of goal 2' },
    ])
    const sessionId = await newSession(api, stream, workspaceId, 'full-access')
    await submit(api, sessionId, 'go')
    // create_goal 与第一轮的 bash。
    await stream.waitFor(() => of(stream, sessionId, 'tool_exec').length >= 2, 30_000)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal pause' })).status).toBe(204)
    expect(goals(stream, sessionId).at(-1)).toMatchObject({ phase: 'paused', reason: { code: 'user-paused' }, revision: 2 })
    await stream.waitFor(() => of(stream, sessionId, 'run_end').length >= 2, 30_000)
    expect(of(stream, sessionId, 'run_end').at(-1)!.payload).toMatchObject({ status: 'paused' })

    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal resume' })).status).toBe(204)
    await stream.waitFor(() => of(stream, sessionId, 'tool_exec').length >= 3, 30_000)
    expect(starts(stream, sessionId).at(-1)).toEqual({ trigger: 'goal', goal: { goalId: 'goal-1', round: 2 } })
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal cancel' })).status).toBe(204)
    expect(goals(stream, sessionId).at(-1)).toMatchObject({ phase: 'cancelled', cleanup: { runsAborted: 1, jobsKilled: 0, failures: [] } })
    const again = await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal resume' })
    expect([again.status, again.body.error?.code]).toEqual([409, 'invalid-transition'])

    await submit(api, sessionId, '/goal ship the release')
    await waitGoal(stream, sessionId, (g) => g.id === 'goal-2' && g.phase === 'budget-exhausted')
    expect(starts(stream, sessionId).at(-1)).toEqual({ trigger: 'goal', goal: { goalId: 'goal-2', round: 1 } })
    // 控制词不产生 user message：只有 'go'、两轮 <goal_round>、展开的 /goal 文本与 goal-2 的一轮。
    const users = of(stream, sessionId, 'message').filter((e) => (e.payload as { role: string }).role === 'user')
    expect(users).toHaveLength(5)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(lastUser((await requests())[4]!)).toMatch(/^Create a goal for this objective with create_goal[\s\S]*Objective: ship the release$/)
  })

  it('分叉不复制 Goal；回退对话不改变 Goal', async () => {
    const { sidecar, api, stream, workspaceId } = await boot([
      { content: [createGoal(['done'], { budget: { max_rounds: 1 } })] },
      { content: 'set' },
      { content: 'r1' },
    ])
    const sessionId = await newSession(api, stream, workspaceId)
    await submit(api, sessionId, 'go')
    await waitGoal(stream, sessionId, (g) => g.phase === 'budget-exhausted')
    await stream.waitFor(() => of(stream, sessionId, 'run_end').length >= 2, 30_000)
    const userSeqs = of(stream, sessionId, 'message')
      .filter((e) => (e.payload as { role: string }).role === 'user')
      .map((e) => e.seq)
    const before = (await api.get(goalPaths.sessionGoal(sessionId))).body

    // 分叉在 <goal_round> 处（之前已有 goal 条目）：新 Session 没有 Goal。
    const forked = await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: userSeqs[1] })
    expect(forked.status).toBe(201)
    const forkId = forked.body.sessionId as string
    const forkEntries = (await api.get(apiPaths.session(forkId))).body.entries as SessionEntryRecord[]
    expect(forkEntries.filter((e) => e.kind === 'goal')).toEqual([])
    expect((await api.get(goalPaths.sessionGoal(forkId))).body).toEqual({ goal: null, usage: { rounds: 0 } })

    const rewound = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: userSeqs[0], mode: 'conversation' })
    expect(rewound.status).toBe(200)
    expect((await api.get(goalPaths.sessionGoal(sessionId))).body).toEqual(before)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

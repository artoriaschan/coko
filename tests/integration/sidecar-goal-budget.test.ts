// Goal 预算（docs/subsystems/goal.md#预算）：真实 Sidecar（faux 模型，脚本给出每次请求的 usage）经协议驱动。每一维单独设上限：达到后 Run 以
// paused + budget_exhausted 结束、Goal 为 budget-exhausted 且 reason 写明维度；工具调用上限时超出的那次调用不执行（Workspace 文件逐字节不变）；
// 调高上限后恢复继续直到完成。设了费用上限而模型未定价：不发出 Goal 的模型请求，Goal 为 blocked（cost-unpriced）。
// 用量只来自已提交的条目，不读取文件，不涉及符号链接越界。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, goalPaths, permissionPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

type Goal = { id: string; revision: number; phase: string; reason?: { code: string; message: string }; budget: Record<string, number> }
type Message = { role: string; toolName?: string; isError?: boolean; content?: { text?: string }[]; usage?: { cost: Record<string, number> } }

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const usage = (input: number, output: number) => ({ usage: { input, output } })
const complete = (id: string, revision: number) => ({
  content: [call('update_goal', id, { goal_id: 'goal-1', revision, action: 'complete', evidence: [{ criterion_id: 'c1', text: 'done' }] })],
  ...usage(10, 1),
})

async function boot(script: Record<string, unknown>) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const path = await fauxScript(root, { requestLog, ...script })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: path } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const requests = async () => (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
  return { sidecar, api, stream, sessionId, workspaceDir, requests }
}

const of = (stream: Stream, sessionId: string, kind: string) => stream.entries(sessionId).filter((e) => e.kind === kind)
const goals = (stream: Stream, sessionId: string) => of(stream, sessionId, 'goal').map((e) => e.payload as Goal)
const messages = (stream: Stream, sessionId: string) => of(stream, sessionId, 'message').map((e) => e.payload as Message)
const waitGoal = (stream: Stream, sessionId: string, test: (goal: Goal) => boolean) => stream.waitFor(() => goals(stream, sessionId).some(test), 30_000)

/**
 * 一维的耗尽与恢复：r0 中 create_goal（只设该维度），Goal Round 1 在 rounds 中给出的回复后耗尽；POST edit 调高上限、resume，
 * 下一轮给出完整证据而完成。返回耗尽时的 Goal 与 run_end。
 */
async function exhaustAndResume(budget: Record<string, number>, round1: unknown[], raise: Record<string, number>, extra: Record<string, unknown> = {}) {
  const env = await boot({
    ...extra,
    responses: [
      { content: [call('create_goal', 'cg', { objective: 'fix the tests', criteria: ['done'], budget })], ...usage(10, 1) },
      { content: 'goal set', ...usage(10, 1) },
      ...round1,
      complete('u1', 4),
      { content: 'all done', ...usage(10, 1) },
    ],
  })
  const { api, stream, sessionId } = env
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
  await waitGoal(stream, sessionId, (g) => g.phase === 'budget-exhausted')
  const exhausted = goals(stream, sessionId).at(-1)!
  const runEnds = of(stream, sessionId, 'run_end').map((e) => e.payload as { status: string; error?: { code: string; message: string } })

  // 未调高时不能恢复。
  const early = await api.post(goalPaths.sessionGoal(sessionId), { action: 'resume', revision: exhausted.revision })
  expect([early.status, early.body.error?.code]).toEqual([409, 'invalid-transition'])
  const edited = await api.post(goalPaths.sessionGoal(sessionId), { action: 'edit', revision: exhausted.revision, budget: raise })
  expect(edited).toMatchObject({ status: 200, body: { goal: { phase: 'budget-exhausted', budget: raise } } })
  const resumed = await api.post(goalPaths.sessionGoal(sessionId), { action: 'resume', revision: exhausted.revision + 1 })
  expect(resumed).toMatchObject({ status: 200, body: { goal: { phase: 'running' } } })
  await waitGoal(stream, sessionId, (g) => g.phase === 'complete')
  await stream.waitFor(() => of(stream, sessionId, 'run_end').length >= runEnds.length + 1, 30_000)
  expect(of(stream, sessionId, 'run_start').map((e) => (e.payload as { goal?: { round: number } }).goal?.round)).toEqual([undefined, 1, 2])
  return { ...env, exhausted, runEnds }
}

describe('Goal 预算', { timeout: 120_000 }, () => {
  it('工具调用：超出的那次调用不执行（文件不变），Run 以 paused + budget_exhausted 结束，Goal 为 budget-exhausted（tool-calls）；调高后恢复', async () => {
    const { sidecar, api, stream, sessionId, workspaceDir, exhausted, runEnds } = await exhaustAndResume(
      { max_tool_calls: 2 },
      [
        { content: [call('bash', 'b1', { command: 'echo one' })], ...usage(10, 1) },
        { content: [call('bash', 'b2', { command: 'echo two' })], ...usage(10, 1) },
        { content: [call('write', 'w1', { path: 'keep.txt', content: 'overwritten' })], ...usage(10, 1) },
      ],
      { maxToolCalls: 10 },
      {},
    ).then(async (env) => env)
    expect(exhausted).toMatchObject({ reason: { code: 'tool-calls', message: 'Goal budget exhausted: tool calls (2 / 2)' }, source: 'system' })
    expect(runEnds.at(-1)).toEqual({ status: 'paused', error: { code: 'budget_exhausted', message: 'Goal budget exhausted: tool calls (2 / 2)' } })
    const blocked = messages(stream, sessionId).find((m) => m.role === 'toolResult' && m.toolName === 'write')!
    expect(blocked).toMatchObject({ isError: true, content: [{ text: 'Goal budget exhausted: tool calls (2 / 2)' }] })
    await expect(readFile(join(workspaceDir, 'keep.txt'))).rejects.toThrow(/ENOENT/)
    // 用量：两次 bash 与恢复后的 update_goal；拦下的调用不计。
    const after = await api.get(goalPaths.sessionGoal(sessionId))
    expect(after.body.usage).toMatchObject({ rounds: 2, toolCalls: 3, costUnpriced: true })
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('工具调用：Workspace 中已有的文件逐字节不变', async () => {
    const env = await boot({
      responses: [
        { content: [call('create_goal', 'cg', { objective: 'o', criteria: ['done'], budget: { max_tool_calls: 1 } })] },
        { content: 'set' },
        { content: [call('bash', 'b1', { command: 'echo one' }), call('write', 'w1', { path: 'keep.txt', content: 'overwritten' })] },
        { content: 'unused' },
      ],
    })
    const original = Buffer.from([0, 1, 2, 255, 10, 13])
    await writeFile(join(env.workspaceDir, 'keep.txt'), original)
    expect((await env.api.post(apiPaths.sessionMessages(env.sessionId), { text: 'go' })).status).toBe(202)
    await waitGoal(env.stream, env.sessionId, (g) => g.phase === 'budget-exhausted')
    expect(goals(env.stream, env.sessionId).at(-1)!.reason?.code).toBe('tool-calls')
    expect(Buffer.compare(await readFile(join(env.workspaceDir, 'keep.txt')), original)).toBe(0)
    // 同一批中先到的调用照常执行，超出的不执行。
    const results = messages(env.stream, env.sessionId).filter((m) => m.role === 'toolResult' && m.toolName !== 'create_goal')
    expect(results.map((m) => [m.toolName, m.isError])).toEqual([
      ['bash', false],
      ['write', true],
    ])
    expect(await env.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Token：模型请求前检查，达到上限后不再请求（tokens）；调高后恢复', async () => {
    const { sidecar, stream, sessionId, exhausted, runEnds, requests } = await exhaustAndResume(
      { max_tokens: 1000 },
      // 被扣下的请求不消耗脚本：下一条回复留给恢复后的 Goal Round 2。
      [{ content: [call('bash', 'b1', { command: 'echo one' })], ...usage(900, 150) }],
      { maxTokens: 100_000 },
    )
    expect(exhausted.reason).toEqual({ code: 'tokens', message: 'Goal budget exhausted: tokens (1050 / 1000)' })
    expect(runEnds.at(-1)).toEqual({ status: 'paused', error: { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens (1050 / 1000)' } })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    // r0 两次、Goal Round 1 一次（第二次被扣下）、Goal Round 2 两次。
    expect(await requests()).toHaveLength(5)
    expect(messages(stream, sessionId).filter((m) => m.role === 'assistant')).toHaveLength(5)
  })

  it('费用：有价格时 usage.cost 按价格计算；达到上限后不再请求（cost）；调高后恢复', async () => {
    // 每百万 token：输入 2、输出 10。100 000 输入 + 20 000 输出 = 0.2 + 0.2 = 0.4；两次 0.8 ≥ 0.5。
    const { sidecar, api, stream, sessionId, exhausted } = await exhaustAndResume(
      { max_cost: 0.5 },
      [
        { content: [call('bash', 'b1', { command: 'echo one' })], ...usage(100_000, 20_000) },
        { content: [call('bash', 'b2', { command: 'echo two' })], ...usage(100_000, 20_000) },
      ],
      { maxCost: 5 },
      { price: { input: 2, output: 10 } },
    )
    expect(exhausted.reason).toEqual({ code: 'cost', message: 'Goal budget exhausted: cost (0.8 / 0.5)' })
    const priced = messages(stream, sessionId).filter((m) => m.role === 'assistant' && (m.usage as { input?: number }).input === 100_000)
    expect(priced).toHaveLength(2)
    const close = (n: number) => expect.closeTo(n, 12)
    for (const m of priced) expect(m.usage!.cost).toEqual({ input: close(0.2), output: close(0.2), cacheRead: 0, cacheWrite: 0, total: close(0.4) })
    const body = (await api.get(goalPaths.sessionGoal(sessionId))).body
    expect(body.usage.costUnpriced).toBe(false)
    // 恢复后的 Goal Round 2 两次请求，各 10 输入 + 1 输出：(10 × 2 + 1 × 10) / 1e6。
    expect(body.usage.cost).toBeCloseTo(0.8 + (2 * (10 * 2 + 1 * 10)) / 1e6, 9)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('时间：Run 的时长（含工具执行）达到上限后不再请求（time）；调高后恢复', async () => {
    const { sidecar, exhausted } = await exhaustAndResume(
      { max_duration_ms: 1500 },
      [{ content: [call('bash', 'b1', { command: 'sleep 2' })], ...usage(10, 1) }],
      { maxDurationMs: 600_000 },
    )
    expect(exhausted.reason?.code).toBe('time')
    expect(exhausted.reason?.message).toMatch(/^Goal budget exhausted: time \(\d+ ms \/ 1500 ms\)$/)
    expect(Number(/time \((\d+) ms/.exec(exhausted.reason!.message)![1])).toBeGreaterThanOrEqual(2000)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('轮次：Goal Round 开始前检查（rounds）；调高后恢复', async () => {
    const { sidecar, exhausted, runEnds } = await exhaustAndResume({ max_rounds: 1 }, [{ content: 'round 1', ...usage(10, 1) }], { maxRounds: 2 })
    expect(exhausted.reason).toEqual({ code: 'rounds', message: 'Goal budget exhausted: rounds (1 / 1)' })
    // 轮次在开始前检查：Goal Round 1 正常结束，没有第二个 Run 被停下。
    expect(runEnds.map((r) => r.status)).toEqual(['completed', 'completed'])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('设了费用上限而模型未定价：不发出 Goal 的模型请求，Goal 为 blocked（cost-unpriced）；恢复后仍 blocked', async () => {
    const { sidecar, api, stream, sessionId, requests } = await boot({
      responses: [
        { content: [call('create_goal', 'cg', { objective: 'o', criteria: ['done'], budget: { max_cost: 1 } })] },
        { content: 'set' },
        { content: 'must not be requested' },
      ],
    })
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
    await waitGoal(stream, sessionId, (g) => g.phase === 'blocked')
    const blocked = goals(stream, sessionId).at(-1)!
    expect(blocked.reason).toEqual({ code: 'cost-unpriced', message: expect.stringContaining('the current model has no price') })
    expect(of(stream, sessionId, 'run_start').map((e) => e.payload)).toEqual([{ trigger: 'submit' }])
    expect((await api.get(goalPaths.sessionGoal(sessionId))).body.usage).toMatchObject({ rounds: 0, costUnpriced: true })

    const resumed = await api.post(goalPaths.sessionGoal(sessionId), { action: 'resume', revision: blocked.revision })
    expect(resumed).toMatchObject({ status: 200, body: { goal: { phase: 'blocked', reason: { code: 'cost-unpriced' } } } })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    // 只有创建 Goal 的 Run 的两次请求；Goal 的 requestLog 为空。
    expect(await requests()).toHaveLength(2)
    expect(of(stream, sessionId, 'run_start')).toHaveLength(1)
  })
})

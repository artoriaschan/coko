// 追踪、审计与导出（docs/subsystems/tracing.md）：真实 Sidecar（faux 模型，脚本给出每次请求的 usage）+ 仓库内的 Hook 夹具，经协议驱动。
// 一次含审批与 Hook 的 Goal Round 之后：GET …/trace 的请求数与 model_request 条目一致、工具耗时 ≥ 审批等待、Goal Round 的合计与 Goal 用量一致；
// GET …/audit 有 approval 与 hook 事件；GET …/export 为 ndjson（header + 条目），?children=1 另含子 Session 的条目；回放往返：导出 → loadExport →
// modelContext 与 deriveTrace 和 Sidecar 读回的条目派生结果相等。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveTrace } from '@coko/agent'
import { modelContext, pairedStateUpdates } from '@coko/agent/entries'
import { loadExport } from '@coko/agent/testing'
import {
  API_ROUTES,
  apiPaths,
  goalPaths,
  hookPaths,
  permissionPaths,
  SESSION_EXPORT_FORMAT,
  tracePaths,
  type AuditEvent,
  type SessionEntryRecord,
  type TraceResponse,
} from '@coko/protocol'
import { client, connect, exchange, fauxScript, hookCommand, pollUntil, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const usage = (input: number, output: number) => ({ usage: { input, output } })

async function boot(responses: unknown[], hooks?: Record<string, unknown>) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  if (hooks) {
    const saved = await api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })
    if (saved.status !== 200) throw new Error(`saving hooks failed: ${saved.status} ${JSON.stringify(saved.body)}`)
  }
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const runEnds = (n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n, 30_000)
  return { sidecar, api, stream, sessionId, runEnds }
}

/** ndjson 的各行（只有一行时 harness 已把它解析为对象）。 */
const lines = (body: unknown): unknown[] =>
  typeof body === 'string'
    ? body
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
    : [body]

describe('追踪、审计与导出', { timeout: 90_000 }, () => {
  it('含审批与 Hook 的 Goal Round：trace 的请求数、工具耗时 ≥ 审批等待、合计与 Goal 用量一致；audit 有 approval 与 hook', async () => {
    const h = await boot(
      [
        { content: [call('create_goal', 'cg', { objective: 'list files', criteria: ['listed'] })], ...usage(11, 1) },
        { content: 'goal set', ...usage(12, 2) },
        { content: [call('bash', 'b1', { command: 'echo traced' })], ...usage(13, 3) },
        {
          content: [call('update_goal', 'u1', { goal_id: 'goal-1', revision: 1, action: 'complete', evidence: [{ criterion_id: 'c1', text: 'echoed' }] })],
          ...usage(14, 4),
        },
        { content: 'all done', ...usage(15, 5) },
      ],
      {
        // PreToolUse 的 ask 使 bash 进入审批（default 模式下 echo 本可直接运行）；PostToolUse 的 exit 2 追加上下文。
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: hookCommand('--stdout', JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } })),
              },
            ],
          },
        ],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand('--exit', '2', '--stderr', 'post check') }] }],
      },
    )
    const { api, stream, sessionId } = h
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
    const approval = await waitApproval(stream, sessionId)
    expect(approval).toMatchObject({ toolCallId: 'b1', subject: 'echo traced' })
    // 审批等待至少 50 ms：按 approval_request 条目的提交时刻轮询（同一台机器的时钟）。
    const askedAt = stream.entries(sessionId).find((e) => e.kind === 'approval_request')!.createdAt
    await pollUntil(() => Date.now() - askedAt >= 50 || undefined, { timeoutMs: 5_000 })
    expect((await api.post(apiPaths.sessionApproval(sessionId, approval.requestId), { decision: 'allow', scope: 'once' })).status).toBe(204)
    await h.runEnds(2)

    const trace = (await api.get(tracePaths.trace(sessionId))).body as TraceResponse
    expect(trace.runs.map((r) => [r.trigger, r.status])).toEqual([
      ['submit', 'completed'],
      ['goal', 'completed'],
    ])
    expect(trace.totals.requests).toBe(stream.modelRequests(sessionId).length)
    expect(trace.totals.requests).toBe(5)
    expect(trace.runs.map((r) => r.requests.length)).toEqual([2, 3])
    const round = trace.runs[1]!
    const bash = round.tools.find((t) => t.toolCallId === 'b1')!
    expect(bash).toMatchObject({ name: 'bash', approval: 'allowed', approvalBy: 'user', isError: false })
    expect(bash.approvalWaitMs).toBeGreaterThanOrEqual(50)
    expect(bash.durationMs).toBeGreaterThanOrEqual(bash.approvalWaitMs!)
    expect(bash.execMs).toBeLessThanOrEqual(bash.durationMs!)
    expect(bash.hooks.map((x) => [x.event, x.outcome])).toEqual([
      ['PreToolUse', 'asked'],
      ['PostToolUse', 'context'],
    ])
    expect(round.tools.map((t) => t.name)).toEqual(['bash', 'update_goal'])
    expect(trace.totals).toMatchObject({ runs: 2, toolCalls: 3, tokens: 11 + 1 + 12 + 2 + 13 + 3 + 14 + 4 + 15 + 5 })

    // Goal 用量只计属于 Goal 的 Run（这里是 Goal Round）：与该 Run 的追踪一致。
    const goal = (await api.get(goalPaths.sessionGoal(sessionId))).body as { goal: { phase: string }; usage: Record<string, number> }
    expect(goal.goal.phase).toBe('complete')
    expect(goal.usage).toMatchObject({ rounds: 1, toolCalls: round.tools.length, tokens: round.tokens, durationMs: round.durationMs })
    expect(goal.usage.cost).toBeCloseTo(round.cost, 9)

    const audit = (await api.get(tracePaths.audit(sessionId))).body as AuditEvent[]
    expect(audit.filter((e) => e.kind === 'approval')).toEqual([
      expect.objectContaining({ requestId: approval.requestId, toolCallId: 'b1', subject: 'echo traced', outcome: 'allowed', by: 'user', scope: 'once' }),
    ])
    expect(audit.filter((e) => e.kind === 'hook').map((e) => (e.kind === 'hook' ? [e.event, e.outcome] : []))).toEqual([
      ['PreToolUse', 'asked'],
      ['PostToolUse', 'context'],
    ])
    expect(audit.map((e) => e.seq)).toEqual(audit.map((e) => e.seq).sort((a, b) => a - b))
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('export：ndjson（header + 已提交的条目）；?children=1 另含子 Session 的条目；回放往返与 Sidecar 读回的派生相等', async () => {
    const h = await boot([
      { match: 'PARENT', content: [call('agent', 'a1', { description: 'look', prompt: 'CHILD look around', subagent_type: 'explore' })], ...usage(5, 1) },
      { match: 'CHILD', content: [call('ls', 'l1', { path: '.' })], ...usage(3, 1) },
      { match: 'CHILD', content: 'nothing here', ...usage(4, 2) },
      { match: 'PARENT', content: 'parent done', ...usage(6, 2) },
    ])
    const { api, stream, sessionId } = h
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'PARENT go' })).status).toBe(202)
    await h.runEnds(1)
    const childId = (stream.entries(sessionId).find((e) => e.kind === 'agent_start')!.payload as { agentId: string }).agentId
    const detail = (id: string) => api.get(apiPaths.session(id)).then((r) => r.body.entries as SessionEntryRecord[])
    const parentEntries = await detail(sessionId)
    const childEntries = await detail(childId)

    const own = await api.get(tracePaths.export(sessionId))
    expect(own.status).toBe(200)
    expect(own.headers['content-type']).toMatch(/^application\/x-ndjson/)
    expect(own.headers['content-disposition']).toMatch(/attachment; filename=".+\.ndjson"/)
    const [header, ...rest] = lines(own.body)
    expect(header).toEqual({ type: 'header', format: SESSION_EXPORT_FORMAT, version: 1, sessionId, exportedAt: expect.any(Number) })
    expect(rest).toEqual(parentEntries)
    const exportedUpdates = parentEntries.filter((entry) => entry.kind === 'state_update')
    expect(exportedUpdates).toEqual([expect.objectContaining({ payload: { name: 'date', value: expect.any(Object) } })])

    const withChildren = lines((await api.get(tracePaths.export(sessionId, true))).body).slice(1) as SessionEntryRecord[]
    expect(withChildren.filter((e) => e.sessionId === sessionId)).toEqual(parentEntries)
    expect(withChildren.filter((e) => e.sessionId === childId)).toEqual(childEntries)
    expect(childEntries[0]!.kind).toBe('subagent_origin')

    // 回放：导出文本 → loadExport → 纯函数派生，与 Sidecar 读回的条目和接口一致。
    const text = (await api.get(tracePaths.export(sessionId, true))).body as string
    const loaded = loadExport(text)
    const replayParent = loaded.filter((e) => e.sessionId === sessionId)
    const replayChild = loaded.filter((e) => e.sessionId === childId)
    expect(modelContext(replayParent)).toEqual(modelContext(parentEntries))
    expect([...pairedStateUpdates(replayParent).values()].flatMap((pairs) => pairs.map((pair) => pair.entry))).toEqual(exportedUpdates)
    expect(modelContext(replayChild)).toEqual(modelContext(childEntries))
    expect(modelContext(replayChild).length).toBeGreaterThan(0)
    expect(deriveTrace(replayParent)).toEqual(((await api.get(tracePaths.trace(sessionId))).body as TraceResponse).runs)
    expect(deriveTrace(replayChild)).toEqual(((await api.get(tracePaths.trace(childId))).body as TraceResponse).runs)

    expect((await api.get(tracePaths.export('missing'))).status).toBe(404)
    expect((await api.get(tracePaths.trace('missing'))).status).toBe(404)
    expect((await api.get(tracePaths.audit('missing'))).status).toBe(404)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

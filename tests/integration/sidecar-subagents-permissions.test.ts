// 子代理的有效权限（ADR 0014）与审批（对手用例）：子级审批在子 Session 等待并经其 approvals 回答；"本会话总是允许"写入根 Session；PermissionRequest
// Hook 可代答；定义 full-access 不放宽根的 default；根中途切到 read-only 后子级下一次写入被询问、bash 在 read-only 沙箱中；子级没有 agent / create_goal /
// schedule_create / job_output（requestLog 中的工具表）且 bash run_in_background 为参数错误；Agent(general) 拒绝规则在 full-access 下生效。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiPaths, hookPaths, permissionPaths } from '@coko/protocol'
import { hookCommand } from './sidecar-harness.ts'
import { bootAgents, byUser, call, of, runEnds, starts, toolResults } from './sidecar-subagents-harness.ts'

type Logged = { role: string; content: unknown; toolsAdded?: { name: string }[] }[]
const entriesOf = async (env: Awaited<ReturnType<typeof bootAgents>>, id: string) =>
  (await env.api.get(apiPaths.session(id))).body.entries as { kind: string; payload: Record<string, unknown> }[]
/** 第 n 个调用（按 toolCallId 区分）的、尚未回答的审批请求（模式变化后的重新判定会以新的请求替换旧的）。 */
const pendingRequest = async (env: Awaited<ReturnType<typeof bootAgents>>, id: string, n = 1) => {
  let found: { requestId: string; toolName: string } | undefined
  await expect
    .poll(
      async () => {
        const entries = await entriesOf(env, id)
        const decided = new Set(entries.filter((e) => e.kind === 'approval_decision').map((e) => e.payload.requestId))
        const requests = entries.filter((e) => e.kind === 'approval_request')
        const calls = [...new Set(requests.map((e) => e.payload.toolCallId))]
        const open = calls.length >= n ? requests.filter((e) => e.payload.toolCallId === calls[n - 1] && !decided.has(e.payload.requestId)).at(-1) : undefined
        found = open?.payload as { requestId: string; toolName: string } | undefined
        return found !== undefined
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}
const childOf = async (env: Awaited<ReturnType<typeof bootAgents>>, parent: string) => {
  await expect.poll(() => starts(env.stream, parent).length, { timeout: 20_000 }).toBeGreaterThan(0)
  return starts(env.stream, parent)[0]!.agentId
}

describe('子代理：审批与有效权限', { timeout: 120_000 }, () => {
  it('审批在子 Session 中等待并经子 Session 回答；父 Session awaiting-approval；"本会话总是允许"写入根 Session 的规则', async () => {
    const env = await bootAgents([
      { match: 'PARENT-A', content: [call('agent', 'a1', { description: 'write', prompt: 'CHILD-A write', subagent_type: 'general' })] },
      { match: 'CHILD-A', content: [call('write', 'w1', { path: 'a.txt', content: 'A' })] },
      { match: 'CHILD-A', content: 'wrote a' },
      { match: 'PARENT-A', content: 'ok' },
    ])
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-A go')
    const child = await childOf(env, parent)
    const request = await pendingRequest(env, child)
    expect(request.toolName).toBe('write')
    await expect.poll(async () => (await env.api.get(apiPaths.session(parent))).body.session.activity).toBe('awaiting-approval')
    const answered = await env.api.post(apiPaths.sessionApproval(child, request.requestId), { decision: 'allow', scope: 'session' })
    expect(answered.status).toBe(204)
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    expect(existsSync(join(env.wsPath, 'a.txt'))).toBe(true)
    expect(of(env.stream, parent, 'permission_rule').map((e) => (e.payload as { rule: { tool: string } }).rule.tool)).toEqual(['Edit'])
    expect((await entriesOf(env, child)).filter((e) => e.kind === 'permission_rule')).toEqual([])
  })

  it('PermissionRequest Hook 代答子级的询问（approval_decision by hook）', async () => {
    const env = await bootAgents([
      { match: 'PARENT-H', content: [call('agent', 'a1', { description: 'write', prompt: 'CHILD-H write', subagent_type: 'general' })] },
      { match: 'CHILD-H', content: [call('write', 'w1', { path: 'h.txt', content: 'H' })] },
      { match: 'CHILD-H', content: 'wrote h' },
      { match: 'PARENT-H', content: 'ok' },
    ])
    const hooks = {
      PermissionRequest: [
        { hooks: [{ type: 'command', command: hookCommand('--stdout', JSON.stringify({ hookSpecificOutput: { decision: { behavior: 'allow' } } })) }] },
      ],
    }
    expect((await env.api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })).status).toBe(200)
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-H go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    const child = starts(env.stream, parent)[0]!.agentId
    expect((await entriesOf(env, child)).find((e) => e.kind === 'approval_decision')?.payload).toMatchObject({ outcome: 'allowed', by: 'hook' })
    expect(existsSync(join(env.wsPath, 'h.txt'))).toBe(true)
  })

  it('对手用例：根为 default、定义 permission-mode: full-access 时子级的写入仍询问；根切到 read-only 后下一次 write 被询问、bash 在 read-only 沙箱中', async () => {
    const env = await bootAgents([
      { match: 'PARENT-W', content: [call('agent', 'a1', { description: 'writer', prompt: 'CHILD-W write', subagent_type: 'writer' })] },
      { match: 'CHILD-W', content: [call('write', 'w1', { path: 'one.txt', content: '1' })] },
      { match: 'CHILD-W', content: [call('write', 'w2', { path: 'two.txt', content: '2' })] },
      { match: 'CHILD-W', content: [call('bash', 'b1', { command: 'touch sandboxed.txt' })] },
      { match: 'CHILD-W', content: 'writer done' },
      { match: 'PARENT-W', content: 'ok' },
    ])
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-W go')
    const child = await childOf(env, parent)
    const first = await pendingRequest(env, child, 1)
    expect(first.toolName).toBe('write')
    // 子代理运行中根切到 read-only：之后的判定按新模式。
    expect((await env.api.put(permissionPaths.sessionPermissionMode(parent), { mode: 'read-only' })).status).toBe(200)
    const reask = await pendingRequest(env, child, 1)
    const ans = await env.api.post(apiPaths.sessionApproval(child, reask.requestId), { decision: 'allow' })
    if (ans.status !== 204)
      throw new Error(
        JSON.stringify({
          ans: ans.body,
          entries: (await entriesOf(env, child)).map((e) => [e.kind, e.payload.requestId ?? e.payload.toolName ?? e.payload.role, e.payload.outcome]),
        }),
      )
    const second = await pendingRequest(env, child, 2)
    expect(second.toolName).toBe('write')
    expect((await env.api.post(apiPaths.sessionApproval(child, second.requestId), { decision: 'allow' })).status).toBe(204)
    const third = await pendingRequest(env, child, 3)
    expect(third.toolName).toBe('bash')
    expect((await env.api.post(apiPaths.sessionApproval(child, third.requestId), { decision: 'allow' })).status).toBe(204)
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    // 允许一次只放行这次调用；命令仍在 read-only 的沙箱中（Seatbelt 只在 darwin），不能写入。
    expect(existsSync(join(env.wsPath, 'sandboxed.txt'))).toBe(process.platform !== 'darwin')
    // 子 Session 不能直接切换模式。
    const set = await env.api.put(permissionPaths.sessionPermissionMode(child), { mode: 'full-access' })
    expect([set.status, set.body.error.code]).toEqual([409, 'child-session'])
  })

  it('对手用例：子级的工具表没有 agent、create_goal、schedule_create、job_output；调用它们失败；bash run_in_background 为参数错误', async () => {
    const env = await bootAgents([
      { match: 'PARENT-T', content: [call('agent', 'a1', { description: 'probe', prompt: 'CHILD-T probe', subagent_type: 'general' })] },
      {
        match: 'CHILD-T',
        content: [
          call('agent', 'x1', { description: 'nested', prompt: 'nested' }),
          call('create_goal', 'x2', { objective: 'o', criteria: ['c'] }),
          call('schedule_create', 'x3', { title: 't', prompt: 'p', after_seconds: 60 }),
          call('job_output', 'x4', { job_id: 'j' }),
          call('bash', 'x5', { command: 'sleep 5', run_in_background: true }),
        ],
      },
      { match: 'CHILD-T', content: 'probed' },
      { match: 'PARENT-T', content: 'ok' },
    ])
    const parent = await env.open('full-access')
    await env.submit(parent, 'PARENT-T go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    const child = starts(env.stream, parent)[0]!.agentId
    expect(starts(env.stream, parent)).toHaveLength(1)
    const logged = byUser(await env.requests(), 'CHILD-T probe') as Logged[]
    const advertised = logged.flatMap((r) => r.flatMap((m) => m.toolsAdded ?? []).map((t) => t.name))
    for (const name of ['agent', 'agent_wait', 'create_goal', 'get_goal', 'schedule_create', 'schedule_list', 'job_output', 'memory_write'])
      expect(advertised).not.toContain(name)
    expect(advertised).toContain('read')
    const results = (await entriesOf(env, child))
      .filter((e) => e.kind === 'message' && e.payload.role === 'toolResult')
      .map((e) => [e.payload.toolName, e.payload.isError])
    expect(results).toEqual([
      ['agent', true],
      ['create_goal', true],
      ['schedule_create', true],
      ['job_output', true],
      ['bash', true],
    ])
    expect(of(env.stream, child, 'job_start')).toHaveLength(0)
    expect(of(env.stream, parent, 'goal')).toHaveLength(0)
  })

  it('对手用例：Agent(general) 拒绝规则在 full-access 下生效（没有子 Session）', async () => {
    const env = await bootAgents([
      { match: 'PARENT-D', content: [call('agent', 'a1', { description: 'denied', prompt: 'CHILD-D never', subagent_type: 'general' })] },
      { match: 'PARENT-D', content: 'ok' },
    ])
    const parent = await env.open('full-access')
    const added = await env.api.post(permissionPaths.sessionPermissionRules(parent), { rule: { behavior: 'deny', tool: 'Agent', content: 'general' } })
    expect(added.status).toBe(200)
    await env.submit(parent, 'PARENT-D go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    expect(toolResults(env.stream, parent, 'agent')).toEqual([expect.objectContaining({ isError: true })])
    expect(starts(env.stream, parent)).toHaveLength(0)
    expect(byUser(await env.requests(), 'CHILD-D never')).toHaveLength(0)
  })
})

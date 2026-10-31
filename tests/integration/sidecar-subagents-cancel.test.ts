// 子代理的取消传播与 SubagentStart / SubagentStop Hook（ADR 0014）：停止父 Run abort 前台子代理（agent_end cancelled）、后台继续；取消 Goal 停止其子代理
// 并记 cleanup.agentsStopped；SubagentStart 的 additionalContext 在子代理首条消息中、SubagentStop 的 block 使子代理多请求（每 Run 至多继续 3 次）。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiPaths, goalPaths, hookPaths } from '@coko/protocol'
import { hookCommand } from './sidecar-harness.ts'
import { bootAgents, byUser, call, ends, flat, runEnds, starts, toolResults } from './sidecar-subagents-harness.ts'

type Entry = { kind: string; payload: Record<string, unknown> }
const entriesOf = async (env: Awaited<ReturnType<typeof bootAgents>>, id: string) => (await env.api.get(apiPaths.session(id))).body.entries as Entry[]
const waiting = async (env: Awaited<ReturnType<typeof bootAgents>>, id: string) => {
  await expect.poll(async () => (await entriesOf(env, id)).some((e) => e.kind === 'approval_request'), { timeout: 20_000 }).toBe(true)
}

describe('子代理：取消传播与 Hook', { timeout: 120_000 }, () => {
  it('停止父 Run：前台子代理 agent_end cancelled；后台子代理继续运行', async () => {
    const env = await bootAgents([
      {
        match: 'PARENT-S',
        content: [
          call('agent', 'b1', { description: 'bg', prompt: 'CHILD-SB write', subagent_type: 'general', run_in_background: true }),
          call('agent', 'f1', { description: 'fg', prompt: 'CHILD-SF write', subagent_type: 'general' }),
        ],
      },
      { match: 'CHILD-SB', content: [call('write', 'wb', { path: 'b.txt', content: 'b' })] },
      { match: 'CHILD-SF', content: [call('write', 'wf', { path: 'f.txt', content: 'f' })] },
    ])
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-S go')
    await expect.poll(() => starts(env.stream, parent).length, { timeout: 20_000 }).toBe(2)
    const bg = starts(env.stream, parent).find((s) => s.background)!.agentId
    const fg = starts(env.stream, parent).find((s) => !s.background)!.agentId
    await waiting(env, fg)
    await waiting(env, bg)
    expect((await env.api.post(apiPaths.sessionAbort(parent), {})).status).toBe(200)
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 30_000)
    expect(ends(env.stream, parent)).toEqual([expect.objectContaining({ agentId: fg, status: 'cancelled' })])
    expect((await env.api.get(apiPaths.session(bg))).body.session.running).toBe(true)
    expect((await env.api.post(`/api/sessions/${parent}/agents/${bg}/cancel`, {})).status).toBe(204)
  })

  it('取消 Goal 停止其 Run 派发的子代理，cleanup.agentsStopped 计数', async () => {
    const env = await bootAgents([
      { match: 'PARENT-X', content: [call('create_goal', 'cg', { objective: 'OBJ-CANCEL', criteria: ['done'] })] },
      { match: 'PARENT-X', content: 'created' },
      {
        match: 'OBJ-CANCEL',
        content: [call('agent', 'b1', { description: 'bg', prompt: 'CHILD-X write', subagent_type: 'general', run_in_background: true })],
      },
      { match: 'OBJ-CANCEL', content: 'waiting' },
      { match: 'CHILD-X', content: [call('write', 'wx', { path: 'x.txt', content: 'x' })] },
    ])
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-X go')
    await expect.poll(() => starts(env.stream, parent).length, { timeout: 20_000 }).toBe(1)
    const child = starts(env.stream, parent)[0]!.agentId
    await waiting(env, child)
    const goal = (await env.api.get(goalPaths.sessionGoal(parent))).body.goal as { revision: number }
    const cancelled = await env.api.post(goalPaths.sessionGoal(parent), { action: 'cancel', revision: goal.revision })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.goal).toMatchObject({ phase: 'cancelled', cleanup: { agentsStopped: 1 } })
    expect(ends(env.stream, parent)).toEqual([expect.objectContaining({ agentId: child, status: 'cancelled' })])
  })

  it('SubagentStart 的 additionalContext 在子代理首条消息中；SubagentStop 的 block 使子代理继续（至多 3 次），stdin 带 agent_type 与 parent_session_id', async () => {
    const env = await bootAgents([
      { match: 'PARENT-K', content: [call('agent', 'a1', { description: 'hooked', prompt: 'CHILD-K go', subagent_type: 'explore' })] },
      { match: 'CHILD-K', content: 'k1' },
      // 继续时最后一条 user message 是 Hook 的原因。
      { match: 'KEEP-GOING', content: 'k2' },
      { match: 'KEEP-GOING', content: 'k3' },
      { match: 'KEEP-GOING', content: 'k4' },
      { match: 'PARENT-K', content: 'ok' },
    ])
    const record = join(env.root, 'stop.jsonl')
    // 凭据形态的文本（没有登记为 Secret）也被替换：与其他 Hook 文本同一口径（redactText）。
    const startOut = JSON.stringify({ hookSpecificOutput: { additionalContext: 'EXTRA-START-CONTEXT key sk-shapedSUBAGENT0123456789' } })
    const hooks = {
      SubagentStart: [{ matcher: 'explore', hooks: [{ type: 'command', command: hookCommand('--stdout', startOut) }] }],
      SubagentStop: [{ matcher: 'explore', hooks: [{ type: 'command', command: hookCommand('--record', record, '--exit', '2', '--stderr', 'KEEP-GOING') }] }],
    }
    expect((await env.api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })).status).toBe(200)
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-K go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 1, 60_000)
    const logged = await env.requests()
    const first = logged.find((r) => flat(r).includes('CHILD-K go'))!
    const firstUser = first.filter((m) => m.role === 'user').at(0)!
    expect(JSON.stringify(firstUser.content)).toContain('EXTRA-START-CONTEXT key [REDACTED')
    expect(JSON.stringify(logged)).not.toContain('sk-shapedSUBAGENT0123456789')
    const childRequests = logged.filter((r) => flat(r).includes('CHILD-K go') && !flat(r).includes('PARENT-K'))
    expect(childRequests).toHaveLength(4)
    expect(flat(childRequests[1]!)).toContain('KEEP-GOING')
    const stdin = (await readFile(record, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(stdin[0]).toMatchObject({ hook_event_name: 'SubagentStop', agent_type: 'explore', parent_session_id: parent, stop_hook_active: false })
    expect(stdin[1]).toMatchObject({ stop_hook_active: true })
    expect(toolResults(env.stream, parent, 'agent')[0]!.text).toContain('k4')
    void byUser
  })
})

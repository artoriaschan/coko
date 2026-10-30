// 重启（ADR 0014，recovery.md）：子代理运行中 SIGKILL，重启后父级有 agent_end { status: interrupted }、父级 agent 调用的结果为中断说明、没有新的
// 子 Run、没有结果确认。
import { describe, expect, it } from 'vitest'
import { apiPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, killAndRestart } from './sidecar-harness.ts'
import { bootAgents, call, starts } from './sidecar-subagents-harness.ts'

type Entry = { kind: string; payload: Record<string, unknown>; runId: string | null }

describe('子代理：重启后中断', { timeout: 120_000 }, () => {
  it('SIGKILL 时前台子代理在等审批：重启后 agent_end interrupted、结果为中断说明、没有新的子 Run 与结果确认', async () => {
    const env = await bootAgents([
      { match: 'PARENT-R', content: [call('agent', 'a1', { description: 'stuck', prompt: 'CHILD-R write', subagent_type: 'general' })] },
      { match: 'CHILD-R', content: [call('write', 'w1', { path: 'r.txt', content: 'R' })] },
    ])
    const parent = await env.open('default')
    await env.submit(parent, 'PARENT-R go')
    await expect.poll(() => starts(env.stream, parent).length, { timeout: 20_000 }).toBe(1)
    const childId = starts(env.stream, parent)[0]!.agentId
    const entriesOf = async (api: ReturnType<typeof client>, id: string) => (await api.get(apiPaths.session(id))).body.entries as Entry[]
    await expect.poll(async () => (await entriesOf(env.api, childId)).some((e) => e.kind === 'approval_request'), { timeout: 20_000 }).toBe(true)

    const script = await fauxScript(env.root, { responses: [] }, 'after.json')
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' } })
    const api = client(restarted, await exchange(restarted))
    void connect
    const parentEntries = await entriesOf(api, parent)
    expect(parentEntries.filter((e) => e.kind === 'agent_end').map((e) => e.payload)).toEqual([
      expect.objectContaining({ agentId: childId, status: 'interrupted' }),
    ])
    const result = parentEntries.find((e) => e.kind === 'message' && e.payload.role === 'toolResult' && e.payload.toolName === 'agent')!
    expect(result.payload).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: `Subagent interrupted by a restart; partial results are in child session ${childId}.` }],
    })
    expect(parentEntries.filter((e) => e.kind === 'confirmation_request')).toEqual([])
    expect(parentEntries.filter((e) => e.kind === 'run_end').map((e) => e.payload.status)).toEqual(['interrupted'])
    const child = await entriesOf(api, childId)
    expect(child.filter((e) => e.kind === 'run_start')).toHaveLength(1)
    expect(child.filter((e) => e.kind === 'run_end').map((e) => e.payload.status)).toEqual(['interrupted'])
    expect(child.filter((e) => e.kind === 'approval_decision').map((e) => e.payload.outcome)).toEqual(['expired'])
    const session = (await api.get(apiPaths.session(parent))).body.session
    expect(session.activity).toBe('interrupted')
  })
})

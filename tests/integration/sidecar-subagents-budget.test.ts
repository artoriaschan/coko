// 对手用例（预算，ADR 0014）：Goal 设 maxTokens，子代理的用量计入 GET …/goal 的 usage；子代理用量使其耗尽后子 Run 在下一次请求前停止、父级在下一个
// 检查点停止、Goal 为 budget-exhausted；设了 maxCost 而子代理模型未定价时 agent 为错误结果且没有子 Session。
import { describe, expect, it } from 'vitest'
import { apiPaths, goalPaths } from '@coko/protocol'
import { customProvider } from './sidecar-harness.ts'
import { bootAgents, byUser, call, ends, runEnds, starts, toolResults } from './sidecar-subagents-harness.ts'

const usage = (input: number, output = 0) => ({ usage: { input, output } })

describe('子代理：预算汇入根 Goal', { timeout: 120_000 }, () => {
  it('子代理用量计入 Goal；耗尽后子 Run 在下一次请求前停止、父级在下一个检查点停止、Goal budget-exhausted', async () => {
    // 创建 Goal 的 Run 不属于 Goal（goalRunIds）；派发在之后的 Goal Round 中（其输入与 <goal> 含 objective）。
    const env = await bootAgents([
      {
        match: 'PARENT-G',
        content: [call('create_goal', 'cg', { objective: 'OBJ-INVESTIGATE', criteria: ['done'], budget: { max_tokens: 1000 } })],
        ...usage(10),
      },
      { match: 'PARENT-G', content: 'created', ...usage(10) },
      { match: 'OBJ-INVESTIGATE', content: [call('agent', 'a1', { description: 'burn', prompt: 'CHILD-G burn', subagent_type: 'general' })], ...usage(10) },
      { match: 'CHILD-G', content: [call('ls', 'l1', {})], ...usage(700) },
      { match: 'CHILD-G', content: [call('ls', 'l2', {})], ...usage(400) },
      { match: 'CHILD-G', content: 'must not be requested', ...usage(1) },
      { match: 'OBJ-INVESTIGATE', content: 'parent must not be requested', ...usage(1) },
    ])
    const parent = await env.open('full-access')
    await env.submit(parent, 'PARENT-G go')
    await env.stream.waitFor(() => runEnds(env.stream, parent).length >= 2, 60_000)
    const childId = starts(env.stream, parent)[0]!.agentId
    expect(starts(env.stream, parent)[0]).toMatchObject({ goalId: expect.any(String) })
    // 子 Run：第 3 次请求前停止（budget_exhausted）；父级收到的结果为失败。
    const childEntries = (await env.api.get(apiPaths.session(childId))).body.entries as {
      kind: string
      payload: { status?: string; error?: { code: string } }
    }[]
    expect(childEntries.find((e) => e.kind === 'run_end')!.payload).toMatchObject({ status: 'paused', error: { code: 'budget_exhausted' } })
    expect(ends(env.stream, parent)).toEqual([expect.objectContaining({ status: 'failed', usage: expect.objectContaining({ tokens: 1100 }) })])
    expect(toolResults(env.stream, parent, 'agent')[0]!.isError).toBe(true)
    // 父级：下一次请求前停止，Goal 进入 budget-exhausted；没有多余的请求。
    expect(runEnds(env.stream, parent)).toEqual([
      { status: 'completed' },
      expect.objectContaining({ status: 'paused', error: expect.objectContaining({ code: 'budget_exhausted' }) }),
    ])
    const logged = await env.requests()
    expect(byUser(logged, 'CHILD-G burn')).toHaveLength(2)
    expect(JSON.stringify(logged)).not.toContain('parent must not be requested')
    expect(JSON.stringify(logged)).not.toContain('must not be requested"')
    await expect.poll(async () => (await env.api.get(goalPaths.sessionGoal(parent))).body.goal.phase).toBe('budget-exhausted')
    const goal = (await env.api.get(goalPaths.sessionGoal(parent))).body
    expect(goal.usage.tokens).toBeGreaterThanOrEqual(1100)
  })

  it('设了 maxCost 而子代理模型未定价：agent 为错误结果，没有子 Session', async () => {
    // 父级的 faux 模型已定价（Goal Round 能运行）；子代理指定 Catalog 中的未定价模型（另一个 Provider）。
    const env = await bootAgents(
      [
        { match: 'PARENT-$', content: [call('create_goal', 'cg', { objective: 'OBJ-COST', criteria: ['done'], budget: { max_cost: 1 } })] },
        { match: 'PARENT-$', content: 'created' },
        { match: 'OBJ-COST', content: [call('agent', 'a1', { description: 'other', prompt: 'CHILD-$ x', subagent_type: 'general', model: 'other/m1' })] },
        { match: 'OBJ-COST', content: 'ok' },
      ],
      { script: { price: { input: 1, output: 1 } }, providers: [customProvider('other', 'http://127.0.0.1:9/v1', ['m1'])] },
    )
    const parent = await env.open('full-access')
    await env.submit(parent, 'PARENT-$ go')
    await env.stream.waitFor(() => toolResults(env.stream, parent, 'agent').length >= 1, 60_000)
    expect(toolResults(env.stream, parent, 'agent')).toEqual([
      expect.objectContaining({ isError: true, text: expect.stringMatching(/cost limit but model other\/m1 has no price/) }),
    ])
    expect(starts(env.stream, parent)).toHaveLength(0)
    expect(byUser(await env.requests(), 'CHILD-$ x')).toHaveLength(0)
  })
})

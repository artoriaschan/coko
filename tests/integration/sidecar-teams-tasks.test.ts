// 任务板（ADR 0018，docs/subsystems/teams.md）对手用例：两个 teammate 等同一个闸门文件，放行后用同一 expected_revision 认领同一任务——只有一个成功，
// 另一个为 stale-revision 且带当前快照；前置未完成的任务不能认领（task-not-claimable blocked）；teammate 不能把任务指派给他人（not-owner）；
// task_list 给出 ready 与 writeScopes 重叠警告，GET …/team 与之一致。读取交叠的确定性用例在 apps/server 的 teams.test.ts。
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiPaths, teamPaths, type TeamSnapshot } from '@coko/protocol'
import { tempDir } from './sidecar-harness.ts'
import { bootAgents, call, of, runEnds, texts } from './sidecar-subagents-harness.ts'

type Entry = { kind: string; payload: Record<string, unknown> }

const gateCall = (id: string, path: string) => call('bash', id, { command: "until [ -f '" + path + "' ]; do sleep 0.02; done; echo open" })
const teammate = (id: string, name: string, prompt: string) => call('agent', id, { description: name, prompt, subagent_type: 'general', name })

async function results(api: Awaited<ReturnType<typeof bootAgents>>['api'], sessionId: string, toolName: string) {
  const entries = (await api.get(apiPaths.session(sessionId))).body.entries as Entry[]
  return entries
    .filter((e) => e.kind === 'message' && e.payload.role === 'toolResult' && e.payload.toolName === toolName)
    .map((e) => ({ isError: e.payload.isError as boolean, text: texts(e.payload.content).join('') }))
}

describe('Agent Teams：任务板', { timeout: 180_000 }, () => {
  it('并发认领同一任务：一个成功、另一个 stale-revision 带快照；前置未完成不能认领；teammate 指派他人为 not-owner；task_list 的 ready 与警告', async () => {
    const gates = await tempDir('coko-team-gates-')
    const go = join(gates, 'claim')
    const env = await bootAgents([
      { match: 'LEAD-T', content: [teammate('a1', 'alice', 'MATE-ALICE claim'), teammate('a2', 'bob', 'MATE-BOB claim')] },
      {
        content: [
          call('task_create', 'c1', { subject: 'Shared task', write_scopes: ['src/api'] }),
          call('task_create', 'c2', { subject: 'Needs t1', blocked_by: ['t1'] }),
          call('task_create', 'c3', { subject: 'Lead task', write_scopes: ['src/api/routes.ts'] }),
        ],
      },
      { content: [call('task_update', 'u3', { id: 't3', expected_revision: 1, status: 'in_progress' })] },
      { content: 'lead set up' },
      // 两个 teammate 都先等闸门（任务创建之后由测试放行），再用 revision 1 认领 t1。
      { match: 'MATE-ALICE', content: [gateCall('ga', go)] },
      { match: 'MATE-BOB', content: [gateCall('gb', go)] },
      { match: 'MATE-ALICE', content: [call('task_update', 'ua', { id: 't1', expected_revision: 1, status: 'in_progress' })] },
      { match: 'MATE-BOB', content: [call('task_update', 'ub', { id: 't1', expected_revision: 1, status: 'in_progress' })] },
      { match: 'MATE-ALICE', content: [call('task_update', 'ua2', { id: 't2', expected_revision: 1, status: 'in_progress' })] },
      { match: 'MATE-BOB', content: [call('task_update', 'ub2', { id: 't2', expected_revision: 1, owner: 'alice' })] },
      { match: 'MATE-ALICE', content: [call('task_list', 'la', {})] },
      { match: 'MATE-BOB', content: 'bob done' },
      { match: 'MATE-ALICE', content: 'alice done' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const { api, stream, submit } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-T start')
    await stream.waitFor(() => runEnds(stream, lead).length >= 1, 60_000)
    const created = await results(api, lead, 'task_create')
    expect(created.map((r) => r.isError)).toEqual([false, false, false])
    expect((await results(api, lead, 'task_update'))[0]).toMatchObject({
      isError: false,
      text: expect.stringMatching(/^Updated t3 \(revision 2, in_progress, owner lead\)/),
    })
    const ids = Object.fromEntries(
      of(stream, lead, 'agent_start').map((e) => [(e.payload as { name: string }).name, (e.payload as { agentId: string }).agentId]),
    )

    await writeFile(go, 'open')
    for (const id of [ids.alice!, ids.bob!])
      await expect
        .poll(async () => ((await api.get(apiPaths.session(id))).body.entries as Entry[]).some((e) => e.kind === 'run_end'), { timeout: 60_000 })
        .toBe(true)
    const claims = [...(await results(api, ids.alice!, 'task_update')).slice(0, 1), ...(await results(api, ids.bob!, 'task_update')).slice(0, 1)]
    const won = claims.filter((r) => !r.isError)
    const lost = claims.filter((r) => r.isError)
    expect(won).toHaveLength(1)
    expect(won[0]!.text).toMatch(/^Updated t1 \(revision 2, in_progress, owner (alice|bob)\)/)
    const winner = /owner (alice|bob)/.exec(won[0]!.text)![1]!
    expect(lost).toEqual([{ isError: true, text: expect.stringMatching(/^stale-revision: [\s\S]*\nCurrent: \{.*"revision":2.*"status":"in_progress"/) }])
    expect(lost[0]!.text).toContain('"owner":"' + winner + '"')

    // 前置 t1 未完成：认领 t2 为 task-not-claimable（blocked）；bob 把 t2 指派给 alice 为 not-owner。
    expect((await results(api, ids.alice!, 'task_update'))[1]).toMatchObject({
      isError: true,
      text: expect.stringMatching(/^task-not-claimable: .*\(blocked\)/),
    })
    expect((await results(api, ids.bob!, 'task_update'))[1]).toMatchObject({ isError: true, text: expect.stringMatching(/^not-owner: /) })

    // task_list：t1 与 t3 都 in_progress 且 writeScopes 重叠 → 警告；t2 不 ready。GET …/team 与之一致。
    const listed = JSON.parse((await results(api, ids.alice!, 'task_list'))[0]!.text) as Pick<TeamSnapshot, 'tasks' | 'warnings'>
    expect(listed.tasks.map((t) => [t.taskId, t.status, t.ready])).toEqual([
      ['t1', 'in_progress', false],
      ['t2', 'pending', false],
      ['t3', 'in_progress', false],
    ])
    expect(listed.warnings).toEqual([expect.objectContaining({ code: 'write-scope-overlap', taskIds: ['t1', 't3'] })])
    const team = (await api.get(teamPaths.team(lead))).body as TeamSnapshot
    expect(team.tasks).toEqual(listed.tasks)
    expect(team.warnings).toEqual(listed.warnings)
    // 根 Session 的 team_task 条目：t1 只有一次认领（revision 2）。
    const t1 = of(stream, lead, 'team_task').map((e) => e.payload as { taskId: string; revision: number; by: string })
    expect(t1.filter((t) => t.taskId === 't1').map((t) => [t.revision, t.by])).toEqual([
      [1, 'lead'],
      [2, winner],
    ])
  })
})

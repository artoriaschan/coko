// Agent Teams（docs/subsystems/teams.md，ADR 0018）：真实 Sidecar 与 faux 模型（teammate 的回复按 match 取用：prompt 或 <team-message> 正文中的标记）。
// lead 以 agent { name } 创建后台 teammate；teammate 的 Run 结束后 lead 收到 agent_notification（lead 空闲时不唤醒、下一个 Run 送达）；send_message
// 唤醒空闲的 teammate（trigger subagent、输入为 <team-message from="lead">）、运行中的为 steering；广播；名字与人数上限；子代理继续对话；并发上限时排队。
// 需要确定先后的地方，teammate 在 bash 中等测试写出的闸门文件（不用固定 sleep）。
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentPaths, apiPaths, teamPaths, type SessionEntry, type TeamSnapshot } from '@coko/protocol'
import { buildTimeline } from '../../apps/desktop/src/renderer/features/conversation/timeline.ts'
import { client, connect, exchange, fauxScript, killAndRestart, tempDir } from './sidecar-harness.ts'
import { bootAgents, byUser, call, flat, of, runEnds, starts, texts, toolResults } from './sidecar-subagents-harness.ts'

type Entry = SessionEntry & { payload: Record<string, unknown> }
type Api = Awaited<ReturnType<typeof bootAgents>>['api']

/** bash 等待闸门文件出现（测试写出它时放行）。 */
const gate = (path: string) => call('bash', 'g-' + path.split('/').pop(), { command: "until [ -f '" + path + "' ]; do sleep 0.05; done; echo open" })
const release = (path: string) => writeFile(path, 'open')
const teammate = (id: string, name: string, prompt: string, extra: Record<string, unknown> = {}) =>
  call('agent', id, { description: name + ' work', prompt, subagent_type: 'general', name, ...extra })

async function entriesOf(api: Api, sessionId: string): Promise<Entry[]> {
  return (await api.get(apiPaths.session(sessionId))).body.entries as Entry[]
}

/** Session 的 Run：每个 run_start 的 payload 与其后第一条 user message 的文本。 */
function runInputs(entries: readonly Entry[]) {
  return entries.flatMap((e, i) => {
    if (e.kind !== 'run_start') return []
    const user = entries.slice(i + 1).find((x) => x.kind === 'message' && x.payload.role === 'user')
    return [{ start: e.payload, text: user ? texts(user.payload.content).join('') : '' }]
  })
}

const sendResults = (entries: readonly Entry[]) =>
  entries
    .filter((e) => e.kind === 'message' && e.payload.role === 'toolResult' && e.payload.toolName === 'send_message')
    .map((e) => ({ isError: e.payload.isError, text: texts(e.payload.content).join('') }))

/** 等第 n 个 Run 的输入（run_start 先于其 user message 提交）含该文本。 */
const waitInput = async (api: Api, sessionId: string, n: number, marker: string) => {
  await expect.poll(async () => runInputs(await entriesOf(api, sessionId))[n - 1]?.text ?? '', { timeout: 30_000 }).toContain(marker)
}

const memberStatuses = async (api: Api, sessionId: string) =>
  ((await api.get(teamPaths.team(sessionId))).body as TeamSnapshot).members.map((m) => [m.name, m.status])

describe('Agent Teams：teammate 与消息', { timeout: 180_000 }, () => {
  it('创建 teammate（后台、agent_start.name）；结束后 lead 收到 agent_notification；lead 空闲时不唤醒；send_message 唤醒 teammate（trigger subagent）', async () => {
    const gates = await tempDir('coko-team-gates-')
    const reviewerGate = join(gates, 'reviewer')
    const env = await bootAgents([
      { match: 'LEAD-1', content: [teammate('a1', 'reviewer', 'MATE-R review the notes')] },
      { match: 'MATE-R', content: [gate(reviewerGate)] },
      { match: 'MATE-R', content: 'REVIEW-ONE-DONE' },
      { content: 'lead dispatched' },
      { match: 'LEAD-2', content: [call('send_message', 's1', { to: 'reviewer', message: 'PING-REVIEWER check again', summary: 'check again' })] },
      { match: 'PING-REVIEWER', content: 'REVIEW-TWO-DONE' },
      { content: 'lead sent' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const { api, stream, submit, requests } = env
    const lead = await env.open('full-access')
    const run1 = await submit(lead, 'LEAD-1 build a team')
    await stream.waitFor(() => runEnds(stream, lead).length >= 1, 60_000)
    const [start] = of(stream, lead, 'agent_start').map((e) => e.payload as Record<string, unknown>)
    expect(start).toMatchObject({ name: 'reviewer', teammate: true, background: true, triggerRunId: run1 })
    const childId = start!.agentId as string
    expect(toolResults(stream, lead, 'agent')[0]!.text).toMatch(new RegExp('^Started teammate reviewer \\(' + childId + ', general\\)'))
    expect(await memberStatuses(api, lead)).toEqual([['reviewer', 'running']])
    // teammate 的 system section 有 <team name="reviewer">；它的 Run 是 trigger subagent、带触发的根 Run。
    await expect.poll(async () => byUser(await requests(), 'MATE-R review').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    const mateRequests = byUser(await requests(), 'MATE-R review')
    expect(Object.values(mateRequests[0]!.find((m) => m.role === 'system')!.sections ?? {}).join('\n')).toMatch(/^<team name="reviewer">/m)
    expect(runInputs(await entriesOf(api, childId))[0]!.start).toEqual({ trigger: 'subagent', subagent: { triggerRunId: run1 } })

    // lead 已空闲且没有 Goal 时放行 teammate：它结束后不唤醒 lead（只有一个 Run），通知挂起到下一个 Run。
    await release(reviewerGate)
    await expect.poll(() => memberStatuses(api, lead), { timeout: 30_000 }).toEqual([['reviewer', 'idle']])
    await expect.poll(async () => (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end').length, { timeout: 20_000 }).toBe(1)
    expect((await entriesOf(api, lead)).filter((e) => e.kind === 'run_start')).toHaveLength(1)
    const run2 = await submit(lead, 'LEAD-2 ask again')
    await stream.waitFor(() => runEnds(stream, lead).length >= 2, 60_000)
    const leadRun2 = (await requests()).filter((r) => flat(r).includes('LEAD-2 ask again'))[0]!
    expect(flat(leadRun2)).toContain('<agent-notification agent-id=\\"' + childId)
    expect(flat(leadRun2)).toContain('REVIEW-ONE-DONE')
    expect(of(stream, lead, 'agent_notification')[0]!.payload).toEqual({ agentIds: [childId] })
    expect(toolResults(stream, lead, 'send_message')[0]).toMatchObject({
      isError: false,
      text: expect.stringMatching(/^Sent to reviewer \(message [^)]+\)\.$/),
    })

    // send_message：teammate 开始新 Run（trigger subagent，triggerRunId 为 lead 的 Run 2），输入是 team_message 之后的 <team-message from="lead">。
    await waitInput(api, childId, 2, 'PING-REVIEWER')
    await expect.poll(async () => (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end').length, { timeout: 30_000 }).toBe(2)
    const child = await entriesOf(api, childId)
    const second = runInputs(child)[1]!
    expect(second.start).toEqual({ trigger: 'subagent', subagent: { triggerRunId: run2 } })
    expect(second.text).toMatch(/^<team-message from="lead" message-id="[^"]+">[\s\S]*PING-REVIEWER check again[\s\S]*<\/team-message>$/)
    const tm = child.findIndex((e) => e.kind === 'team_message')
    expect(child[tm]!.payload).toMatchObject({ from: 'lead', to: 'reviewer', summary: 'check again' })
    expect(child[tm + 1]).toMatchObject({ kind: 'message', payload: { role: 'user' } })
    const team = (await api.get(teamPaths.team(lead))).body as TeamSnapshot
    expect(team.members).toEqual([expect.objectContaining({ agentId: childId, name: 'reviewer', status: 'idle' })])
    // 子 Session id 取到的是其根的快照；team_update 在名册变化时推送。
    expect((await api.get(teamPaths.team(childId))).body).toEqual(team)
    expect(stream.messages.some((m) => m.type === 'progress' && m.sessionId === lead && m.event.type === 'team_update')).toBe(true)
    // 时间线（renderer 的 buildTimeline，用读回的条目）：<team-message> 包装不成用户气泡，显示为 team-message 行。
    const items = buildTimeline({ status: 'ready', entries: child, lastSeq: child.at(-1)!.seq, running: false, live: null })
    expect(items.some((i) => i.kind === 'team-message')).toBe(true)
    expect(JSON.stringify(items.filter((i) => i.kind === 'user'))).not.toContain('<team-message')
  })

  it('运行中的 teammate 收到消息为 steering（同一个 Run）；teammate 给空闲的 lead 发消息不唤醒、下一个 Run 送达；广播 * 每个目标一条', async () => {
    const gates = await tempDir('coko-team-gates-')
    const aliceGate = join(gates, 'alice')
    const bobGate = join(gates, 'bob')
    const env = await bootAgents([
      { match: 'LEAD-S', content: [teammate('a1', 'alice', 'MATE-ALICE wait'), teammate('a2', 'bob', 'MATE-BOB wait')] },
      { match: 'MATE-ALICE', content: [gate(aliceGate)] },
      { match: 'MATE-BOB', content: [gate(bobGate)] },
      { match: 'STEER-ALICE', content: 'ALICE-STEERED-OK' },
      { match: 'MATE-BOB', content: [call('send_message', 'b1', { to: 'lead', message: 'BOB-REPORT finished', summary: 'report' })] },
      { match: 'MATE-BOB', content: 'bob done' },
      // lead：派发后给 alice 发消息（alice 正在等闸门），之后结束。
      { content: [call('send_message', 's1', { to: 'alice', message: 'STEER-ALICE stop waiting' })] },
      { content: 'lead idle' },
      { match: 'LEAD-NEXT', content: [call('send_message', 's2', { to: '*', message: 'BROADCAST-ALL hello team' })] },
      { match: 'BROADCAST-ALL', content: 'got broadcast' },
      { match: 'BROADCAST-ALL', content: 'got broadcast' },
      { content: 'lead broadcast' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const { api, stream, submit, requests } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-S start')
    await stream.waitFor(() => runEnds(stream, lead).length >= 1, 60_000)
    expect(toolResults(stream, lead, 'send_message')[0]).toMatchObject({ isError: false })
    const ids = Object.fromEntries(
      of(stream, lead, 'agent_start').map((e) => [(e.payload as { name: string }).name, (e.payload as { agentId: string }).agentId]),
    )
    // alice 仍在等闸门：消息作为 steering 进入当前 Run；放行后同一个 Run 读到它。
    await release(aliceGate)
    await expect.poll(async () => (await entriesOf(api, ids.alice!)).filter((e) => e.kind === 'run_end').length, { timeout: 30_000 }).toBe(1)
    const alice = await entriesOf(api, ids.alice!)
    expect(alice.filter((e) => e.kind === 'run_start')).toHaveLength(1)
    expect(alice.filter((e) => e.kind === 'team_message').map((e) => e.payload)).toEqual([expect.objectContaining({ from: 'lead', to: 'alice' })])
    expect(JSON.stringify(alice)).toContain('ALICE-STEERED-OK')

    // lead 空闲、没有 Goal：放行 bob，bob 的消息挂起，不唤醒 lead。
    await release(bobGate)
    await expect.poll(async () => (await entriesOf(api, ids.bob!)).filter((e) => e.kind === 'run_end').length, { timeout: 30_000 }).toBe(1)
    expect(sendResults(await entriesOf(api, ids.bob!))).toEqual([{ isError: false, text: expect.stringMatching(/^Sent to lead \(message /) }])
    await expect.poll(async () => (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end').length, { timeout: 30_000 }).toBe(2)
    expect((await entriesOf(api, lead)).filter((e) => e.kind === 'run_start')).toHaveLength(1)
    expect((await entriesOf(api, lead)).filter((e) => e.kind === 'team_message')).toEqual([])

    // 下一个 Run：bob 的消息在 user message 开头送达（前置 team_message）。广播给 alice 与 bob 各一条（同一个 messageId）。
    await submit(lead, 'LEAD-NEXT go')
    await stream.waitFor(() => toolResults(stream, lead, 'send_message').length >= 2, 60_000)
    const next = (await requests()).filter((r) => flat(r).includes('LEAD-NEXT go'))[0]!
    expect(flat(next)).toMatch(/<team-message from=\\"bob\\" message-id=\\"[^"\\]+\\">[\s\S]*BOB-REPORT finished/)
    expect((await entriesOf(api, lead)).filter((e) => e.kind === 'team_message').map((e) => e.payload)).toEqual([
      expect.objectContaining({ from: 'bob', to: 'lead', summary: 'report' }),
    ])
    expect(toolResults(stream, lead, 'send_message')[1]!.text).toMatch(/^Sent to (alice, bob|bob, alice) \(message /)
    const broadcast = async (id: string) => (await entriesOf(api, id)).filter((e) => e.kind === 'team_message').map((e) => e.payload)
    await expect.poll(async () => (await broadcast(ids.alice!)).length, { timeout: 30_000 }).toBe(2)
    await expect.poll(async () => (await broadcast(ids.bob!)).length, { timeout: 30_000 }).toBe(1)
    const toAlice = (await broadcast(ids.alice!))[1]!
    const toBob = (await broadcast(ids.bob!))[0]!
    expect([toAlice.to, toBob.to]).toEqual(['alice', 'bob'])
    expect(toAlice.messageId).toBe(toBob.messageId)
    await expect.poll(async () => runInputs(await entriesOf(api, ids.bob!)).length, { timeout: 30_000 }).toBe(2)
  })

  it('同名为 teammate-exists、第 9 个为 team-full', async () => {
    const mates = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => teammate('m' + (from + i), 'm' + (from + i), 'FILL-MATE ' + (from + i)))
    const env = await bootAgents([
      { match: 'LEAD-F', content: mates(1, 4) },
      ...Array.from({ length: 8 }, () => ({ match: 'FILL-MATE', content: 'filled' })),
      { content: [call('agent_wait', 'w1', { timeout_ms: 30000 })] },
      { content: mates(5, 8) },
      { content: [call('agent_wait', 'w2', { timeout_ms: 30000 })] },
      { content: [teammate('dup', 'm1', 'FILL-MATE dup'), teammate('m9', 'm9', 'FILL-MATE 9')] },
      { content: 'lead full' },
      { content: 'lead spare' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const { stream, submit } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-F fill')
    await stream.waitFor(() => toolResults(stream, lead, 'agent').length >= 10, 120_000)
    const results = toolResults(stream, lead, 'agent')
    expect(results.slice(0, 8).filter((r) => r.isError)).toEqual([])
    expect(results.slice(8)).toEqual([
      expect.objectContaining({ isError: true, text: expect.stringMatching(/teammate-exists/) }),
      expect.objectContaining({ isError: true, text: expect.stringMatching(/team-full/) }),
    ])
    expect(starts(stream, lead)).toHaveLength(8)
  })
})

describe('Agent Teams：子代理继续对话与并发上限', { timeout: 180_000 }, () => {
  it('completed 的一次性子代理：send_message { to: agentId } 开始新 Run，结束时父级收到 agent_notification；cancelled 与解散的为 agent-not-reachable', async () => {
    const gates = await tempDir('coko-team-gates-')
    const env = await bootAgents([
      { match: 'LEAD-C', content: [call('agent', 'a1', { description: 'one shot', prompt: 'ONESHOT-A look', subagent_type: 'general' })] },
      { match: 'ONESHOT-A', content: 'ONESHOT-FIRST' },
      {
        match: 'LEAD-C',
        content: [call('agent', 'a2', { description: 'cancel me', prompt: 'ONESHOT-B wait', subagent_type: 'general', run_in_background: true })],
      },
      { match: 'ONESHOT-B', content: [gate(join(gates, 'never'))] },
      { content: [teammate('t1', 'temp', 'MATE-TEMP hi')] },
      { match: 'MATE-TEMP', content: 'temp idle' },
      { content: 'lead first done' },
      { content: 'lead spare' },
    ])
    const { api, stream, submit } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-C go')
    await stream.waitFor(() => starts(stream, lead).length >= 3 && runEnds(stream, lead).length >= 1, 60_000)
    const [oneShot, toCancel, temp] = starts(stream, lead).map((s) => s.agentId) as [string, string, string]
    expect((await api.post(agentPaths.cancel(lead, toCancel), {})).status).toBe(204)
    await expect.poll(() => memberStatuses(api, lead), { timeout: 30_000 }).toEqual([['temp', 'idle']])
    await expect.poll(async () => (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end').length, { timeout: 30_000 }).toBe(3)
    const endStatus = Object.fromEntries((await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end').map((e) => [e.payload.agentId, e.payload.status]))
    expect(endStatus).toEqual({ [oneShot]: 'completed', [toCancel]: 'cancelled', [temp]: 'completed' })
    // agentId 随机，脚本在得知它之后写出：重启 Sidecar 换脚本（completed 的子代理在重启后仍可继续，名册中的 teammate 仍可解散）。
    const script = await fauxScript(
      env.root,
      {
        requestLog: join(env.root, 'requests.jsonl'),
        responses: [
          { match: 'LEAD-D', content: [call('agent_cancel', 'x1', { agent_id: 'temp' })] },
          {
            match: 'LEAD-D',
            content: [
              call('send_message', 'c1', { to: oneShot, message: 'CONTINUE-ONESHOT what else?' }),
              call('send_message', 'c2', { to: toCancel, message: 'to cancelled' }),
              call('send_message', 'c3', { to: 'temp', message: 'to dismissed' }),
            ],
          },
          { match: 'CONTINUE-ONESHOT', content: 'ONESHOT-SECOND' },
          { content: 'lead continued' },
          { match: 'LEAD-E', content: 'lead notified' },
          { content: 'lead spare' },
          { content: 'lead spare' },
        ],
      },
      'continue.json',
    )
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' } })
    const cookie = await exchange(restarted)
    const api2 = client(restarted, cookie)
    const stream2 = await connect(restarted, cookie)
    stream2.send({ type: 'subscribe', sessionId: lead, afterSeq: 0 })
    expect((await api2.post(apiPaths.sessionMessages(lead), { text: 'LEAD-D continue' })).status).toBe(202)
    await stream2.waitFor(() => stream2.entries(lead).filter((e) => e.kind === 'run_end').length >= 2, 60_000)
    expect(sendResults(await entriesOf(api2, lead))).toEqual([
      { isError: false, text: expect.stringMatching(new RegExp('^Sent to ' + oneShot + ' \\(message ')) },
      { isError: true, text: expect.stringMatching(/agent-not-reachable/) },
      { isError: true, text: expect.stringMatching(/agent-not-reachable/) },
    ])
    const tempEnds = (await entriesOf(api2, lead)).filter((e) => e.kind === 'agent_end' && e.payload.agentId === temp)
    expect(tempEnds.at(-1)!.payload.status).toBe('dismissed')
    await waitInput(api2, oneShot, 2, 'CONTINUE-ONESHOT what else?')
    // 继续的 Run 结束：父级第二条 agent_end，通知（后台语义）在 lead 的 Run 中或下一个 Run 送达。
    await expect
      .poll(async () => (await entriesOf(api2, lead)).filter((e) => e.kind === 'agent_end' && e.payload.agentId === oneShot).length, {
        timeout: 30_000,
      })
      .toBe(2)
    await stream2.waitFor(() => stream2.entries(lead).filter((e) => e.kind === 'run_end').length >= 2, 30_000)
    // 通知或已在 LEAD-D 的 Run 中作为追加指令送达，或挂起到下一个 Run：再提交一次，两种情况都恰有一条。
    expect((await api2.post(apiPaths.sessionMessages(lead), { text: 'LEAD-E next' })).status).toBe(202)
    await stream2.waitFor(() => stream2.entries(lead).filter((e) => e.kind === 'run_end').length >= 3, 60_000)
    const notified = (await entriesOf(api2, lead)).filter((e) => e.kind === 'agent_notification' && (e.payload.agentIds as string[]).includes(oneShot))
    expect(notified).toHaveLength(1)
    await stream2.close()
  })

  it('根 Session 已有 4 个 running 时消息排队，有空位后开始（不是错误）', async () => {
    const gates = await tempDir('coko-team-gates-')
    const g = (n: number) => join(gates, 'w' + n)
    const env = await bootAgents([
      { match: 'LEAD-Q', content: [teammate('e', 'idler', 'MATE-IDLER hi')] },
      { match: 'MATE-IDLER', content: 'idler idle' },
      { content: [call('agent_wait', 'w0', { timeout_ms: 30000 })] },
      { content: [1, 2, 3, 4].map((n) => teammate('b' + n, 'busy' + n, 'MATE-BUSY' + n + ' wait')) },
      ...[1, 2, 3, 4].map((n) => ({ match: 'MATE-BUSY' + n, content: [gate(g(n))] })),
      ...[1, 2, 3, 4].map((n) => ({ match: 'MATE-BUSY' + n, content: 'busy' + n + ' done' })),
      { content: [call('send_message', 'q1', { to: 'idler', message: 'QUEUED-HELLO wake later' })] },
      { match: 'QUEUED-HELLO', content: 'idler woke' },
      { content: 'lead queued' },
      { content: 'lead spare' },
      { content: 'lead spare' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const { api, stream, submit } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-Q go')
    await stream.waitFor(() => toolResults(stream, lead, 'send_message').length >= 1, 60_000)
    expect(toolResults(stream, lead, 'send_message')[0]).toMatchObject({ isError: false, text: expect.stringMatching(/^Sent to idler/) })
    const idler = starts(stream, lead)[0]!.agentId
    // 4 个 busy 都在等闸门：消息排队，idler 没有第二个 Run。
    expect((await memberStatuses(api, lead)).filter(([, s]) => s === 'running')).toHaveLength(4)
    expect(runInputs(await entriesOf(api, idler))).toHaveLength(1)
    // 放行一个：有空位后排队的消息开始 idler 的新 Run。
    await release(g(1))
    await waitInput(api, idler, 2, 'QUEUED-HELLO wake later')
    for (const n of [2, 3, 4]) await release(g(n))
    await expect.poll(async () => (await memberStatuses(api, lead)).every(([, s]) => s === 'idle'), { timeout: 30_000 }).toBe(true)
  })
})

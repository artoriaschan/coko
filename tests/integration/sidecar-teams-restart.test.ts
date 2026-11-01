// 团队的重启与 worktree（ADR 0016、0018；docs/subsystems/recovery.md、worktrees.md）。teammate 运行中 SIGKILL：重启后名册中它为 idle（中断恢复照常），
// 可以再接收消息并开始新 Run；排队的消息不跨进程保留。git 夹具：isolation worktree 的 teammate 在自己的 worktree 中工作（bash pwd -P），worktree 保留到
// 解散；解散时没有改动的 worktree 与分支移除、有提交的保留；父 Session 写入保留的 worktree 须审批。Coko 的 worktree 只在临时仓库中创建。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { apiPaths, runPaths, teamPaths, type TeamSnapshot } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, connect, exchange, fauxScript, killAndRestart, tempDir } from './sidecar-harness.ts'
import { bootAgents, call, of, runEnds, texts } from './sidecar-subagents-harness.ts'

type Entry = { kind: string; runId: string | null; payload: Record<string, unknown> }
type Api = ReturnType<typeof client>

const gateCall = (id: string, path: string) => call('bash', id, { command: "until [ -f '" + path + "' ]; do sleep 0.05; done; echo open" })
const teammate = (id: string, name: string, prompt: string, extra: Record<string, unknown> = {}) =>
  call('agent', id, { description: name, prompt, subagent_type: 'general', name, ...extra })
const entriesOf = async (api: Api, id: string) => (await api.get(apiPaths.session(id))).body.entries as Entry[]
const statuses = async (api: Api, id: string) =>
  Object.fromEntries(((await api.get(teamPaths.team(id))).body as TeamSnapshot).members.map((m) => [m.name, m.status]))
const userTexts = (entries: readonly Entry[]) =>
  entries.filter((e) => e.kind === 'message' && e.payload.role === 'user').map((e) => texts(e.payload.content).join(''))

describe('Agent Teams：重启', { timeout: 180_000 }, () => {
  it('SIGKILL：空闲的 teammate 可以再接收消息开始新 Run；运行中被杀、等待结果确认的为 agent-not-reachable，回答后可继续；排队的消息不保留', async () => {
    const gates = await tempDir('coko-team-gates-')
    const env = await bootAgents([
      { match: 'LEAD-R', content: [teammate('i', 'idler', 'MATE-IDLER hi')] },
      { match: 'MATE-IDLER', content: 'idler idle' },
      { content: [call('agent_wait', 'w0', { timeout_ms: 30000 })] },
      { content: [1, 2, 3, 4].map((n) => teammate('b' + n, 'busy' + n, 'MATE-BUSY' + n + ' wait')) },
      ...[1, 2, 3, 4].map((n) => ({ match: 'MATE-BUSY' + n, content: [gateCall('g' + n, join(gates, 'never' + n))] })),
      { content: [call('send_message', 'q1', { to: 'idler', message: 'QUEUED-BEFORE-KILL' })] },
      { content: 'lead queued' },
      { content: 'lead spare' },
      { content: 'lead spare' },
    ])
    const lead = await env.open('full-access')
    await env.submit(lead, 'LEAD-R go')
    await env.stream.waitFor(() => runEnds(env.stream, lead).length >= 1, 60_000)
    await expect
      .poll(() => statuses(env.api, lead), { timeout: 30_000 })
      .toEqual({ idler: 'idle', busy1: 'running', busy2: 'running', busy3: 'running', busy4: 'running' })
    const ids = Object.fromEntries(
      of(env.stream, lead, 'agent_start').map((e) => [(e.payload as { name: string }).name, (e.payload as { agentId: string }).agentId]),
    )
    // 消息排队（4 个 running）：idler 没有第二个 Run。busy 的 bash 都已开始（tool_exec 已提交），SIGKILL 后恢复为待确认。
    expect((await entriesOf(env.api, ids.idler!)).filter((e) => e.kind === 'run_start')).toHaveLength(1)
    for (const n of [1, 2, 3, 4])
      await expect.poll(async () => (await entriesOf(env.api, ids['busy' + n]!)).some((e) => e.kind === 'tool_exec'), { timeout: 30_000 }).toBe(true)

    const script = await fauxScript(
      env.root,
      {
        requestLog: join(env.root, 'requests.jsonl'),
        responses: [
          {
            match: 'LEAD-AFTER',
            content: [
              call('send_message', 'm1', { to: 'busy1', message: 'AFTER-RESTART busy1' }),
              call('send_message', 'm2', { to: 'idler', message: 'AFTER-RESTART idler' }),
            ],
          },
          { match: 'LEAD-AGAIN', content: [call('send_message', 'm3', { to: 'busy1', message: 'AFTER-CONFIRM busy1' })] },
          { match: 'AFTER-RESTART idler', content: 'IDLER-BACK' },
          { match: 'AFTER-CONFIRM busy1', content: 'BUSY1-BACK' },
          { content: 'lead after' },
          { content: 'lead spare' },
          { content: 'lead spare' },
          { content: 'lead spare' },
        ],
      },
      'after.json',
    )
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' } })
    const cookie = await exchange(restarted)
    const api = client(restarted, cookie)
    const stream = await connect(restarted, cookie)
    // 中断恢复照常：busy 的子 Run interrupted 且等待结果确认，根 Session 有 agent_end interrupted；名册中都为 idle。
    expect(await statuses(api, lead)).toEqual({ idler: 'idle', busy1: 'idle', busy2: 'idle', busy3: 'idle', busy4: 'idle' })
    const busy1 = await entriesOf(api, ids.busy1!)
    expect(busy1.filter((e) => e.kind === 'run_end').map((e) => e.payload.status)).toEqual(['interrupted'])
    expect(busy1.filter((e) => e.kind === 'confirmation_request').map((e) => e.payload.toolCallId)).toEqual(['g1'])
    const interrupted = (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end' && e.payload.status === 'interrupted').map((e) => e.payload.agentId)
    expect(new Set(interrupted)).toEqual(new Set([1, 2, 3, 4].map((n) => ids['busy' + n])))
    // 排队的消息没有跨进程保留。
    expect(userTexts(await entriesOf(api, ids.idler!)).join('\n')).not.toContain('QUEUED-BEFORE-KILL')

    stream.send({ type: 'subscribe', sessionId: lead, afterSeq: 0 })
    const leadRuns = () => stream.entries(lead).filter((e) => e.kind === 'run_end').length
    expect((await api.post(apiPaths.sessionMessages(lead), { text: 'LEAD-AFTER go' })).status).toBe(202)
    await stream.waitFor(() => leadRuns() >= 2, 60_000)
    // 等待结果确认的 busy1 不能开始 Run：错误结果（不是假的"Sent"），它仍为 idle、没有新的 agent_end。
    const sends = () =>
      stream
        .entries(lead)
        .filter((e) => e.kind === 'message' && ['m1', 'm2', 'm3'].includes((e.payload as { toolCallId?: string }).toolCallId ?? ''))
        .map((e) => ({ isError: (e.payload as { isError: boolean }).isError, text: texts((e.payload as { content: unknown }).content).join('') }))
    expect(sends()).toEqual([
      { isError: true, text: expect.stringMatching(/^agent-not-reachable: .*outcome confirmation/) },
      { isError: false, text: expect.stringMatching(/^Sent to idler/) },
    ])
    await expect.poll(async () => JSON.stringify(await entriesOf(api, ids.idler!)), { timeout: 30_000 }).toContain('IDLER-BACK')
    const idler = await entriesOf(api, ids.idler!)
    expect(idler.filter((e) => e.kind === 'run_start').map((e) => e.payload.trigger)).toEqual(['subagent', 'subagent'])
    expect(userTexts(idler).at(-1)).toMatch(/^<team-message from="lead" [^>]*>[\s\S]*AFTER-RESTART idler/)
    expect(userTexts(idler).join('\n')).not.toContain('QUEUED-BEFORE-KILL')
    expect((await statuses(api, lead)).busy1).toBe('idle')
    expect((await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end' && e.payload.agentId === ids.busy1).map((e) => e.payload.status)).toEqual([
      'interrupted',
    ])

    // 用户回答 busy1 的结果确认后，消息照常开始新 Run。
    expect((await api.post(runPaths.sessionConfirmation(ids.busy1!, 'g1'), { answer: 'not-applied' })).status).toBe(204)
    expect((await api.post(apiPaths.sessionMessages(lead), { text: 'LEAD-AGAIN go' })).status).toBe(202)
    await stream.waitFor(() => leadRuns() >= 3, 60_000)
    expect(sends().at(-1)).toEqual({ isError: false, text: expect.stringMatching(/^Sent to busy1/) })
    await expect.poll(async () => JSON.stringify(await entriesOf(api, ids.busy1!)), { timeout: 30_000 }).toContain('BUSY1-BACK')
    expect(userTexts(await entriesOf(api, ids.busy1!)).at(-1)).toMatch(/^<team-message from="lead" [^>]*>[\s\S]*AFTER-CONFIRM busy1/)
    await stream.close()
  })
})

describe('Agent Teams：teammate 的 worktree（git 夹具）', { timeout: 180_000 }, () => {
  it('teammate 在自己的 worktree 中工作；保留到解散；解散时无改动的移除、有提交的保留；父 Session 写入保留的 worktree 须审批', async () => {
    const fixture = await createGitWorkspace()
    onTestFinished(() => fixture.dispose())
    const env = await bootAgents(
      [
        {
          match: 'LEAD-W',
          content: [
            teammate('c', 'clean', 'MATE-CLEAN where', { isolation: 'worktree' }),
            teammate('d', 'dirty', 'MATE-DIRTY change', { isolation: 'worktree' }),
          ],
        },
        { match: 'MATE-CLEAN', content: [call('bash', 'p1', { command: 'pwd -P' })] },
        { match: 'MATE-CLEAN', content: 'clean idle' },
        { match: 'MATE-DIRTY', content: [call('bash', 'p2', { command: "echo made > made.txt && git add made.txt && git commit -qm 'teammate change'" })] },
        { match: 'MATE-DIRTY', content: 'dirty idle' },
        { content: 'lead done' },
        { content: 'lead spare' },
        { content: 'lead spare' },
      ],
      { env: fixture.env, workspace: fixture.root },
    )
    const lead = await env.open('full-access')
    await env.submit(lead, 'LEAD-W go')
    await env.stream.waitFor(() => runEnds(env.stream, lead).length >= 1, 60_000)
    await expect.poll(() => statuses(env.api, lead), { timeout: 30_000 }).toEqual({ clean: 'idle', dirty: 'idle' })
    const starts = Object.fromEntries(
      of(env.stream, lead, 'agent_start').map((e) => {
        const p = e.payload as { name: string; agentId: string; isolation: { path: string; branch: string } }
        return [p.name, p]
      }),
    )
    const clean = starts.clean!
    const dirty = starts.dirty!
    expect(clean.isolation.path).toContain(join(fixture.root, '.coko-worktrees'))
    const pwd = (await entriesOf(env.api, clean.agentId)).find((e) => e.kind === 'message' && e.payload.role === 'toolResult')!
    expect(texts(pwd.payload.content).join('')).toContain(clean.isolation.path)
    // 结束一个 Run（空闲）后 worktree 仍在：teammate 还会收到消息。
    expect(existsSync(clean.isolation.path) && existsSync(join(dirty.isolation.path, 'made.txt'))).toBe(true)
    expect(of(env.stream, lead, 'agent_end').every((e) => (e.payload as { worktree?: unknown }).worktree === undefined)).toBe(true)
    const team = (await env.api.get(teamPaths.team(lead))).body as TeamSnapshot
    expect(team.members.find((m) => m.name === 'dirty')!.worktree).toMatchObject({ path: dirty.isolation.path, branch: dirty.isolation.branch })

    // 重启后（启动恢复重新登记询问规则）解散两个，父 Session 写入保留的 worktree 须审批。
    const target = join(dirty.isolation.path, 'from-lead.txt')
    const script = await fauxScript(
      env.root,
      {
        responses: [
          { content: [call('agent_cancel', 'x1', { agent_id: 'clean' }), call('agent_cancel', 'x2', { agent_id: 'dirty' })] },
          { content: [call('write', 'w1', { path: target, content: 'lead' })] },
          { content: 'lead finished' },
        ],
      },
      'dismiss.json',
    )
    const restarted = await killAndRestart(env.sidecar, { dirs: env.dirs, env: { ...fixture.env, COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' } })
    const cookie = await exchange(restarted)
    const api = client(restarted, cookie)
    const stream = await connect(restarted, cookie)
    stream.send({ type: 'subscribe', sessionId: lead, afterSeq: 0 })
    expect((await api.post(apiPaths.sessionMessages(lead), { text: 'LEAD-DISMISS go' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(lead).filter((e) => e.kind === 'approval_request').length >= 1, 30_000)
    const ask = stream.entries(lead).find((e) => e.kind === 'approval_request')!.payload as { requestId: string; toolName: string; subject: string }
    expect(ask).toMatchObject({ toolName: 'write', subject: target })
    expect((await api.post(apiPaths.sessionApproval(lead, ask.requestId), { decision: 'deny' })).status).toBe(204)
    await stream.waitFor(() => stream.entries(lead).filter((e) => e.kind === 'run_end').length >= 2, 30_000)
    expect(existsSync(target)).toBe(false)

    const dismissed = (await entriesOf(api, lead)).filter((e) => e.kind === 'agent_end' && e.payload.status === 'dismissed')
    expect(Object.fromEntries(dismissed.map((e) => [e.payload.agentId, e.payload.worktree ?? null]))).toEqual({
      [clean.agentId]: null,
      [dirty.agentId]: expect.objectContaining({ kept: true, path: dirty.isolation.path, branch: dirty.isolation.branch }),
    })
    expect(existsSync(clean.isolation.path)).toBe(false)
    const branches = await fixture.git('branch', '--list')
    expect(branches).not.toContain(clean.isolation.branch)
    expect(branches).toContain(dirty.isolation.branch)
    expect(await statuses(api, lead)).toEqual({ clean: 'dismissed', dirty: 'dismissed' })
    await stream.close()
  })
})

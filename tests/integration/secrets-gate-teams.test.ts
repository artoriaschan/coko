// 秘密不外泄总闸的团队通道（ADR 0004、0007、0018）：send_message 的正文与 summary、task_create 的标题与描述含登记的 Secret。团队引入的通道——根 Session 的
// team_task 条目、各 Session 的 team_message 条目与 <team-message> user message、teammate 的 <team> section（任务标题）、team_update 帧、HTTP（GET …/team
// 与 Session 详情）、两个 Session 的 faux requestLog——以及日志与库文件中都不得出现明文。团队不新增读取根（名册与任务板只读根 Session 的条目）。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, teamPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

describe('秘密不外泄总闸：Agent Teams', () => {
  it('消息正文、任务描述与 <team> section 含登记 Secret：条目、team_update、HTTP、库与各 Session 的 requestLog 中没有明文', { timeout: 120_000 }, async () => {
    const value = 'team-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const workspaceDir = join(root, 'ws')
    await mkdir(workspaceDir)
    const gate = join(root, 'gate')
    const gate2 = join(root, 'gate2')
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const waitFor = (path: string) => "until [ -f '" + path + "' ]; do sleep 0.05; done"
    // 每条回复都带 match：lead 的三个 Run（LEAD-S / LEAD-MSG / LEAD-NEXT）与 mate 的两个 Run（MATE-S / MSG-S）各取自己的回复。
    // <team> section 只在 Run 开始时读取一次，所以 mate 必须在任务创建之后以新 Run 接收消息：它的第一个 Run 等 gate（lead 的 Run 结束、任务已提交）
    // 后结束，lead 在下一个 Run 中才 send_message，消息以新 Run 送达空闲的 mate。mate 的回复等 gate2（lead 的第二个 Run 已结束），挂起到 lead 的第三个 Run。
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        {
          match: 'LEAD-S',
          content: [call('agent', 'a1', { description: 'mate', prompt: 'MATE-S wait', subagent_type: 'general', name: 'mate' })],
        },
        {
          match: 'LEAD-S',
          content: [call('task_create', 't1', { subject: 'Rotate ' + value, description: 'Use ' + value + ' for the deploy', write_scopes: ['src'] })],
        },
        { match: 'LEAD-S', content: 'lead idle' },
        { match: 'MATE-S', content: [call('bash', 'g', { command: waitFor(gate) })] },
        { match: 'MATE-S', content: 'mate ready' },
        { match: 'LEAD-MSG', content: [call('send_message', 's1', { to: 'mate', message: 'MSG-S the key is ' + value, summary: 'key ' + value })] },
        { match: 'LEAD-MSG', content: 'lead sent' },
        { match: 'MSG-S', content: [call('bash', 'g2', { command: waitFor(gate2) })] },
        { match: 'MSG-S', content: [call('send_message', 'm1', { to: 'lead', message: 'REPLY-S echo ' + value })] },
        { match: 'MSG-S', content: 'mate done ' + value },
        { match: 'LEAD-NEXT', content: 'lead read the reply' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1', COKO_SECRET_TEAM_TOKEN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
    const ended = async () => ((await api.get(apiPaths.session(sessionId))).body.entries as { kind: string }[]).filter((e) => e.kind === 'agent_end').length
    // lead 的第一个 Run：派出 mate、创建任务。Run 结束（任务已提交）后才放行 mate 的第一个 Run，等它结束。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'LEAD-S go' })
    await stream.waitFor(() => runEnds() >= 1, 60_000)
    const mate = (stream.entries(sessionId).find((e) => e.kind === 'agent_start')!.payload as { agentId: string }).agentId
    await writeFile(gate, 'open')
    await expect.poll(ended, { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
    // lead 的第二个 Run：send_message 给空闲的 mate，mate 以新 Run 接收（section 在任务之后读取）。lead 的 Run 结束后放行 mate 的回复。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'LEAD-MSG go' })
    await stream.waitFor(() => runEnds() >= 2, 60_000)
    await writeFile(gate2, 'open')
    await expect.poll(ended, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
    // lead 的第三个 Run：挂起的 <team-message> 随 user message 送达。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'LEAD-NEXT go' })
    await stream.waitFor(() => runEnds() >= 3, 60_000)
    const team = (await api.get(teamPaths.team(sessionId))).body as { tasks: { subject: string; description: string }[] }
    const mateEntries = (await api.get(apiPaths.session(mate))).body.entries as { kind: string; payload: unknown }[]
    await api.get(apiPaths.session(sessionId))

    // 前置：通道确实被驱动，保存的值带占位。
    expect(team.tasks).toEqual([expect.objectContaining({ subject: 'Rotate [REDACTED:secret]', description: 'Use [REDACTED:secret] for the deploy' })])
    expect(
      stream
        .entries(sessionId)
        .filter((e) => e.kind === 'team_message')
        .map((e) => e.payload),
    ).toEqual([expect.objectContaining({ from: 'mate', to: 'lead' })])
    // lead 的消息在 mate 的第二个 Run 送达（不是第一个 Run 中的追加指令），前置 team_message 条目。
    expect(mateEntries.filter((e) => e.kind === 'run_start')).toHaveLength(2)
    expect(mateEntries.filter((e) => e.kind === 'team_message').map((e) => e.payload)).toEqual([
      expect.objectContaining({ from: 'lead', to: 'mate', summary: 'key [REDACTED:secret]' }),
    ])
    expect(stream.messages.some((m) => m.type === 'progress' && m.event.type === 'team_update')).toBe(true)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    // 送达消息的请求同时含任务标题的 <team> section 与脱敏后的消息正文。
    expect(
      requests.some(
        (line) => line.includes('<team name=\\"mate\\">') && line.includes('Rotate [REDACTED:secret]') && line.includes('MSG-S the key is [REDACTED:secret]'),
      ),
    ).toBe(true)
    expect(requests.some((line) => line.includes('<team-message from=\\"mate\\"'))).toBe(true)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

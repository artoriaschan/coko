// 秘密不外泄总闸的子代理通道（ADR 0004、0007、0014）：agent 的 description / prompt 与子代理的输出含登记的 Secret。子代理引入的通道——子 Session 行
// 与条目（subagent_origin、user message）、父级的 agent_start / agent_end、前台 <agent-result> 与后台 <agent-notification>、agent_update 帧、HTTP
// （GET …/agents、子 Session 详情）、两个 Session 的 faux requestLog（含 <subagent>）——以及日志与库文件中都不得出现明文。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentPaths, API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

describe('秘密不外泄总闸：子代理', () => {
  it('prompt 与子代理输出含登记 Secret：条目、结果、通知、agent_update、HTTP、库与两个 Session 的 requestLog 中没有明文', { timeout: 90_000 }, async () => {
    const value = 'agent-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const workspaceDir = join(root, 'ws')
    await mkdir(workspaceDir)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { match: 'PARENT-S', content: [call('agent', 'f1', { description: 'fg ' + value, prompt: 'CHILD-F use ' + value, subagent_type: 'general' })] },
        { match: 'CHILD-F', content: [call('bash', 'b1', { command: 'echo ' + value })] },
        { match: 'CHILD-F', content: 'foreground found ' + value },
        {
          match: 'PARENT-S',
          content: [call('agent', 'g1', { description: 'bg ' + value, prompt: 'CHILD-G use ' + value, subagent_type: 'general', run_in_background: true })],
        },
        { match: 'CHILD-G', content: 'background found ' + value },
        { match: 'PARENT-S', content: [call('bash', 'b2', { command: 'sleep 1' })] },
        { match: 'PARENT-S', content: 'parent done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_AGENT_TOKEN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'PARENT-S go' })
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 60_000)
    const agents = (await api.get(agentPaths.sessionAgents(sessionId))).body as { agentId: string; description: string; status: string }[]
    for (const agent of agents) await api.get(apiPaths.session(agent.agentId))
    await api.get(apiPaths.session(sessionId))

    // 前置：通道确实被驱动（前台结果、后台通知、进度帧），保存的值带占位。
    expect(agents.map((a) => [a.description, a.status])).toEqual([
      ['fg [REDACTED:secret]', 'completed'],
      ['bg [REDACTED:secret]', 'completed'],
    ])
    const results = stream.entries(sessionId).filter((e) => e.kind === 'message' && (e.payload as { toolName?: string }).toolName === 'agent')
    expect(JSON.stringify(results[0]!.payload)).toContain('foreground found [REDACTED:secret]')
    expect(stream.entries(sessionId).filter((e) => e.kind === 'agent_notification')).toHaveLength(1)
    expect(stream.messages.some((m) => m.type === 'progress' && m.event.type === 'agent_update' && m.event.activity !== undefined)).toBe(true)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests.some((line) => line.includes('<subagent type=\\"general\\">'))).toBe(true)
    expect(requests.some((line) => line.includes('<agent-notification'))).toBe(true)

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

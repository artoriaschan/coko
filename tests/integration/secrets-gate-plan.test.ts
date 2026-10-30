// 秘密不外泄总闸的 Plan Mode 通道（ADR 0004）：模型服务在错误中回显 Credential，模型把它写进计划，用户审阅时又把它编辑进计划。Plan 引入的通道——
// plan 条目（WebSocket 帧与库）、kind plan 的审批卡 payload（subject 为计划标题）、exit_plan_mode 的结果、压缩后 faux requestLog 中的 <approved_plan>——
// 以及日志与库中都不得出现明文。模型自己的工具调用参数（assistant 消息与 tool_start 进度）是模型输出原文，与其他工具相同，不属于本通道。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：Plan Mode', () => {
  it('计划含登记的 Credential：plan 条目、审批卡、结果、WS 与 <approved_plan> 中没有明文', { timeout: 120_000 }, async () => {
    const credential = `plain-cred-${randomBytes(12).toString('hex')}`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const plan = `# Rotate ${credential}\n\nReplace the key ${credential} in config.`
    const script = await fauxScript(root, {
      requestLog,
      contextWindow: 200_000,
      responses: [
        { content: [], stopReason: 'error', errorMessage: `Incorrect API key provided: ${credential}` },
        { content: [{ type: 'toolCall', name: 'exit_plan_mode', id: 'e1', arguments: { plan } }] },
        { content: 'on it' },
        { content: 'ok1' },
        { content: 'ok2' },
        { content: 'ok3' },
        { content: 'summary' },
        { content: 'after compaction' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_CREDENTIAL_GATE_PROVIDER: credential } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
    const turn = async (text: string, during?: () => Promise<void>) => {
      const before = runEnds()
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await during?.()
      await stream.waitFor(() => runEnds() > before, 30_000)
    }

    await turn('hello')
    await turn('/plan rotate the key', async () => {
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'approval_request'))
      const request = stream.entries(sessionId).find((e) => e.kind === 'approval_request')!.payload as { requestId: string }
      // 用户在审阅时把同一个明文编辑进计划。
      const editedPlan = `# Rotate the key\n\nUse ${credential} only once, then revoke it.`
      expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow', editedPlan })).status).toBe(204)
    })
    for (const text of ['a'.repeat(40_000), 'b'.repeat(40_000), 'c'.repeat(40_000)]) await turn(text)
    await turn('/compact')
    await turn('continue')

    // 前置：各通道确实被驱动。
    const plans = stream.entries(sessionId).filter((e) => e.kind === 'plan')
    expect(plans.map((e) => (e.payload as { status: string }).status)).toEqual(['proposed', 'approved'])
    expect(JSON.stringify(plans[0]!.payload)).toContain('[REDACTED]')
    expect(JSON.stringify(plans[1]!.payload)).toContain('Use [REDACTED] only once')
    const approval = stream.entries(sessionId).find((e) => e.kind === 'approval_request')!
    expect(approval.payload).toMatchObject({ kind: 'plan', subject: 'Rotate [REDACTED]' })
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    const sections = requests.map((line) =>
      JSON.stringify(
        (JSON.parse(line) as { role: string; sections?: Record<string, string> }[]).filter((m) => m.role === 'system').map((m) => m.sections ?? null),
      ),
    )
    expect(sections.at(-1)).toContain('<approved_plan>')
    expect(sections.at(-1)).toContain('Use [REDACTED] only once')
    const planFrames = stream.frames.filter((frame) => {
      const m = JSON.parse(frame) as {
        type: string
        entry?: { kind: string; payload: { role?: string; toolName?: string } }
        event?: { type: string; toolName?: string }
      }
      if (m.type === 'entry')
        return (
          ['plan', 'approval_request'].includes(m.entry!.kind) || (m.entry!.payload.role === 'toolResult' && m.entry!.payload.toolName === 'exit_plan_mode')
        )
      return m.type === 'progress' && m.event!.type === 'tool_end' && m.event!.toolName === 'exit_plan_mode'
    })
    expect(planFrames.length).toBeGreaterThanOrEqual(5)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const channels: [string, string | Buffer][] = [
      ...planFrames.map((frame, i): [string, string] => [`plan ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...sections.map((s, i): [string, string] => [`request ${i} system sections`, s]),
      ...(await persisted(dirs)).map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential })).toEqual([])
  })
})

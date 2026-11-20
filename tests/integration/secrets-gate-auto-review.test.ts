// 秘密不外泄总闸的自动审查通道（ADR 0004、0029）：审查请求（用户消息、先前调用与待审调用的参数）、保存的理由（approval_decision.reason）
// 与审查的请求快照（model_request.snapshot）中都不得出现登记的 Secret；截断落在 Secret 中间时也不留下它的开头。用户在提示中输入的 Secret
// 按原文入库（ADR 0007），所以库文件不在扫描范围内，只查这些条目。
import { randomBytes } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, tracePaths, type SessionEntryRecord } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, readDir, recordingClient } from './secrets-gate-harness.ts'

const MARKER = 'COKO_PERMISSION_REVIEW'

describe('秘密不外泄总闸：自动审查', () => {
  it('审查请求、请求快照与保存的理由中没有登记的 Secret', { timeout: 90_000 }, async () => {
    const secret = randomBytes(16).toString('hex')
    const root = await realpath(await tempDir())
    const logs = await tempDir('coko-review-secret-')
    const requestLog = join(logs, 'requests.jsonl')
    const detailsLog = join(logs, 'details.jsonl')
    await writeFile(requestLog, '')
    await writeFile(detailsLog, '')
    const bash = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })
    const allow = { match: MARKER, content: JSON.stringify({ decision: 'allow', reason: `Allowed; it uses ${secret}` }) }
    const script = await fauxScript(logs, {
      requestLog,
      requestDetailsLog: detailsLog,
      responses: [
        allow,
        allow,
        { content: [bash('b1', `printf '%s' '${secret}' > a.txt`)] },
        { content: [bash('b2', `printf '%s' '${secret}' > b.txt`)] },
        { content: 'done' },
      ],
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_REVIEW_TOKEN: secret } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'auto-review' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    // 第二个 Secret 跨过用户消息的单项上限（4 000 字符）：先截断再脱敏会留下它的开头。
    const typed = `deploy with ${secret}\n${'x'.repeat(3945)}${secret}`
    expect(typed.indexOf(secret, 20)).toBe(3990)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: typed })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe(secret)

    // 前置：两次调用都经审查放行，审查请求里有替换后的值。
    const entries = stream.entries(sessionId)
    const reviews = entries.filter((e) => e.kind === 'model_request' && (e.payload as { purpose?: string }).purpose === 'review')
    expect(reviews).toHaveLength(2)
    const decisions = entries.filter((e) => e.kind === 'approval_decision').map((e) => e.payload as { by?: string; reason?: string })
    expect(decisions).toEqual([
      expect.objectContaining({ by: 'reviewer', reason: 'Allowed; it uses [REDACTED:secret]' }),
      expect.objectContaining({ by: 'reviewer', reason: 'Allowed; it uses [REDACTED:secret]' }),
    ])
    const details = (await readFile(detailsLog, 'utf8')).split('\n').filter((line) => line.includes(MARKER))
    expect(details).toHaveLength(2)
    const input = JSON.parse(
      String((JSON.parse(details[1]!) as { messages: { role: string; content: unknown }[] }).messages.filter((m) => m.role === 'user').at(-1)!.content),
    ) as { user_authorization: { user_messages: string[] }; actions: { earlier_calls: unknown[]; pending_call: unknown } }
    expect(input.user_authorization.user_messages[0]).toMatch(/^deploy with \[REDACTED:secret\]\nx+/)
    expect(input.actions.earlier_calls).toEqual([{ tool: 'bash', arguments: { command: "printf '%s' '[REDACTED:secret]' > a.txt" } }])
    expect(input.actions.pending_call).toEqual({ tool: 'bash', arguments: { command: "printf '%s' '[REDACTED:secret]' > b.txt" } })

    bodies.length = 0
    const trace = await api.get(tracePaths.trace(sessionId))
    expect(trace.status).toBe(200)
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const snapshot = (entry: SessionEntryRecord) => JSON.stringify((entry.payload as { snapshot?: unknown }).snapshot)
    const channels: [string, string | Buffer][] = [
      ['model requests', await readFile(requestLog, 'utf8')],
      ['request details', await readFile(detailsLog, 'utf8')],
      ...reviews.map((entry, i): [string, string] => [`review snapshot ${i}`, snapshot(entry)]),
      ...decisions.map((decision, i): [string, string] => [`approval_decision ${i}`, JSON.stringify(decision)]),
      ['trace body', bodies.join('\n')],
      ...(await readDir(dirs.logDir)).map((file): [string, Buffer] => [file.name, file.bytes]),
      ['stderr', sidecar.stderr()],
    ]
    expect(reviews.every((entry) => snapshot(entry).includes('[REDACTED:secret]'))).toBe(true)
    expect(leaksIn(channels, { secret, 'secret prefix': secret.slice(0, 10) })).toEqual([])
  })
})

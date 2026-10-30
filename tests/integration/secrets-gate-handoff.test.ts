// 秘密不外泄总闸的交接通道（ADR 0004、0007）：源对话（模型回复）、下一步目标与模型写的摘要都含登记的 Secret。交接引入的通道——摘要请求
// （faux requestLog）、handoff 条目（WS 帧、HTTP、库）、目标 Session 的标题与条目（界面写入输入区草稿的就是 handoff.summary）——以及日志中
// 都不得出现明文；保存的摘要带脱敏占位。不读取文件，不涉及符号链接越界。
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, handoffPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：交接', () => {
  it('对话、下一步目标与摘要含登记 Secret：requestLog、handoff 条目、目标 Session、HTTP、WS、库与日志中没有明文', { timeout: 90_000 }, async () => {
    // 不是凭据形态：只能靠登记明文的按值替换。
    const value = 'deploy-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [{ content: 'the deploy key is ' + value }, { content: '## Context\nuse key ' + value + '\n## Task\nrotate ' + value }],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_DEPLOY_TOKEN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'which key do we use' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)
    // 下一步目标经 HTTP 提交（不是用户消息，不入库为原文）。
    expect((await api.post(handoffPaths.handoff(sessionId), { instructions: 'rotate ' + value + ' next', target: { kind: 'current' } })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'handoff'), 30_000)
    const handoff = stream.entries(sessionId).find((e) => e.kind === 'handoff')!
    const targetId = (handoff.payload as { targetSessionId: string }).targetSessionId
    stream.send({ type: 'subscribe', sessionId: targetId, afterSeq: 0 })
    await stream.waitFor(() => stream.entries(targetId).some((e) => e.kind === 'permission_mode'), 10_000)
    const detail = await api.get(apiPaths.session(targetId))
    await api.get(apiPaths.session(sessionId))
    await api.get(API_ROUTES.sessions)

    // 前置：通道确实被驱动，保存的摘要、指令与目标标题带占位；摘要请求送达了（已替换的）下一步目标。
    expect(handoff.payload).toMatchObject({
      instructions: 'rotate [REDACTED:secret] next',
      summary: '## Context\nuse key [REDACTED:secret]\n## Task\nrotate [REDACTED:secret]',
    })
    expect(detail.body.session.title).toBe('rotate [REDACTED:secret] next')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('<next-goal>\\nrotate [REDACTED:secret] next\\n</next-goal>')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    const rows = db.prepare("SELECT session_id, kind, payload FROM session_entries WHERE kind IN ('handoff', 'handoff_origin')").all() as Record<
      string,
      string
    >[]
    const titles = db.prepare('SELECT title FROM sessions').all() as { title: string }[]
    db.close()
    expect(rows).toHaveLength(2)
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...rows.map((row, i): [string, string] => ['handoff row ' + i, JSON.stringify(row)]),
      ...titles.map((row, i): [string, string] => ['session title ' + i, row.title]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

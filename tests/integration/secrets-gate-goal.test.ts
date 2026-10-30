// 秘密不外泄总闸的 Goal 通道（ADR 0004、0007）：目标、成功条件与证据含登记的 Secret 明文。Goal 引入的通道——goal 条目（WebSocket 帧、HTTP
// 响应、库文件）、Goal 工具的结果、之后每个 Run 的 <goal> system section 与 Goal Round 的 <goal_round> user message（faux requestLog）——以及
// 日志中都不得出现明文；保存的快照带脱敏占位。不读取文件，不涉及符号链接越界。
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, goalPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

describe('秘密不外泄总闸：Goal', () => {
  it('目标与证据含登记 Secret：条目、WS、HTTP、库、requestLog（<goal>、<goal_round>）与日志中没有明文', { timeout: 90_000 }, async () => {
    const value = 'deploy-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        {
          content: [
            call('create_goal', 'cg', { objective: 'rotate ' + value, criteria: ['old key ' + value + ' revoked'], constraints: 'never print ' + value }),
          ],
        },
        { content: 'set' },
        { content: [call('get_goal', 'g1', {})] },
        {
          content: [
            call('update_goal', 'u1', {
              goal_id: 'goal-1',
              revision: 1,
              action: 'complete',
              evidence: [{ criterion_id: 'c1', text: 'revoked ' + value }],
            }),
          ],
        },
        { content: 'done' },
      ],
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
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'rotate the key' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'goal' && (e.payload as { phase: string }).phase === 'complete'), 30_000)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 2, 30_000)
    await api.get(goalPaths.sessionGoal(sessionId))
    await api.get(apiPaths.session(sessionId))

    // 前置：通道确实被驱动，保存的快照带占位。
    const snapshots = stream.entries(sessionId).filter((e) => e.kind === 'goal')
    expect(snapshots.map((e) => (e.payload as { phase: string }).phase)).toEqual(['running', 'complete'])
    expect(JSON.stringify(snapshots[0]!.payload)).toContain('rotate [REDACTED:secret]')
    expect(JSON.stringify(snapshots[1]!.payload)).toContain('revoked [REDACTED:secret]')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(5)
    expect(requests[2]).toContain('<goal>')
    expect(requests[2]).toContain('<goal_round>')
    expect(requests[2]).toContain('rotate [REDACTED:secret]')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    const rows = db.prepare("SELECT payload FROM session_entries WHERE kind IN ('goal', 'message')").all() as { payload: string }[]
    db.close()
    expect(rows.length).toBeGreaterThan(2)
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...rows.map((row, i): [string, string] => ['entry row ' + i, row.payload]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

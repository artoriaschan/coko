// 秘密不外泄总闸的 Todo 通道（ADR 0004、0007）：模型把登记的 Secret 明文写进 todo 的 content 与 result。Todo 引入的通道——todo_list 条目
// （WebSocket 帧、HTTP 响应、库文件）、todo_write 的工具结果、之后每个 Run 的 <todo_list> system section（faux requestLog）——以及日志中
// 都不得出现明文；保存的表带脱敏占位。本票不读取文件，不涉及符号链接越界。
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：Todo', () => {
  it('todo 内容含登记 Secret：条目、WS、HTTP、库、requestLog 与日志中没有明文', { timeout: 90_000 }, async () => {
    // 不是凭据形态：只能靠登记明文的按值替换。
    const value = 'deploy-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const items = [
      { content: 'push with ' + value, status: 'completed', result: 'pushed using ' + value },
      { content: 'verify ' + value + ' still works', status: 'in_progress' },
    ]
    const script = await fauxScript(root, {
      requestLog,
      responses: [{ content: [{ type: 'toolCall', name: 'todo_write', id: 'c1', arguments: { items } }] }, { content: 'listed' }, { content: 'next' }],
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
    const turn = async (text: string) => {
      const before = stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length > before)
    }
    await turn('plan it')
    await turn('go on')
    await api.get(apiPaths.session(sessionId))

    // 前置：通道确实被驱动，保存的表带占位。
    const lists = stream.entries(sessionId).filter((e) => e.kind === 'todo_list')
    expect(lists).toHaveLength(1)
    expect(JSON.stringify(lists[0]!.payload)).toContain('push with [REDACTED:secret]')
    const result = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { toolName?: string }).toolName === 'todo_write')!
    expect(JSON.stringify(result.payload)).toContain('verify [REDACTED:secret] still works')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(3)
    expect(requests[2]).toContain('state_update')
    expect(stream.entries(sessionId).filter((e) => e.kind === 'state_update' && (e.payload as { name: string }).name === 'todo_list')).toHaveLength(1)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    const rows = db.prepare("SELECT payload FROM session_entries WHERE kind = 'todo_list'").all() as { payload: string }[]
    db.close()
    expect(rows).toHaveLength(1)
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...rows.map((row, i): [string, string] => ['todo_list row ' + i, row.payload]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

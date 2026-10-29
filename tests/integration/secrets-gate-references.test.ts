// 秘密不外泄总闸的 File Reference 通道（ADR 0007）：@ 引用把文件内容放进 user message 条目。与 read 工具读出同一份文件时一样，
// 块中的登记明文在生成时替换：模型请求（faux requestLog）、WebSocket 帧、HTTP 响应、库文件（含 -wal）与日志中都没有明文。
// 用户自己输入的文本按原样保留。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：File Reference', () => {
  it('@ 引用的文件块替换登记明文，与 read 工具一致', { timeout: 90_000 }, async () => {
    const value = `postgres://svc:ref${randomBytes(12).toString('hex')}@db.internal/app`
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'service.env'), `DSN=${value}\nPORT=5432\n`)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'seen' }] })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_MY_SERVICE_DSN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'look at @service.env' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    await api.get(apiPaths.session(sessionId))

    // 前置：引用块确实生成，且端口一行原样保留。
    const user = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')!
    const text = JSON.stringify(user.payload)
    expect(text).toContain('look at @service.env')
    expect(text).toContain('<file_reference path=\\"service.env\\">')
    expect(text).toContain('DSN=[REDACTED:secret]')
    expect(text).toContain('PORT=5432')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(1)

    const running = await persisted(dirs)
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

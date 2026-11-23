// 秘密不外泄总闸的 Session Reference 通道（ADR 0007）：@session:<id> 把另一个会话的文字记录放进 user message 条目。被引用会话里用户
// 自己输入的登记明文按原样保存在那条消息中；记录进入引用块时在生成处替换：引用方的条目（WebSocket 帧、HTTP 读回）、模型请求
// （faux requestLog）与日志中都没有明文。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, readDir, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：Session Reference', () => {
  it('会话引用块替换登记明文，被引用会话里用户输入的原文不变', { timeout: 90_000 }, async () => {
    const value = `postgres://svc:sref${randomBytes(12).toString('hex')}@db.internal/app`
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'noted' }, { content: 'seen' }] })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_MY_SERVICE_DSN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const open = async () => {
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      return sessionId
    }
    const source = await open()
    expect((await api.post(apiPaths.sessionMessages(source), { text: `DSN=${value} PORT=5432` })).status).toBe(202)
    await stream.waitFor(isRunEnd(source))
    // 前置：被引用会话里用户输入的明文按原样保存。
    expect(JSON.stringify(stream.entries(source))).toContain(value)

    const target = await open()
    expect((await api.post(apiPaths.sessionMessages(target), { text: `continue from @session:${source}` })).status).toBe(202)
    await stream.waitFor(isRunEnd(target))
    bodies.length = 0
    await api.get(apiPaths.session(target))

    // 前置：引用块确实生成，明文之外的内容原样保留。
    const user = stream.entries(target).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')!
    const text = JSON.stringify(user.payload)
    expect(text).toContain(`continue from @session:${source}`)
    expect(text).toContain(`<session_reference id=\\"${source}\\"`)
    expect(text).toContain('[User]: DSN=[REDACTED:secret] PORT=5432')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(2)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const targetFrames = stream.frames.filter((frame) => frame.includes(`"sessionId":"${target}"`))
    expect(targetFrames.length).toBeGreaterThan(0)
    const channels: [string, string | Buffer][] = [
      ...targetFrames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...(await readDir(dirs.logDir)).map((f): [string, Buffer] => [`log ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })

  it('标题与路径中带 & 的登记明文在转义之前替换：开标签里没有它转义后的形态', { timeout: 90_000 }, async () => {
    const value = `p&ss${randomBytes(12).toString('hex')}`
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, `${value}.md`), 'A\n')
    const script = await fauxScript(root, { responses: [{ content: 'seen' }] })
    const sidecar = await startSidecar({ dirs: await sidecarDirs(), ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_MY_PASSWORD: value } })
    const cookie = await exchange(sidecar)
    const api = recordingClient(sidecar, cookie, [])
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const source = (await api.post(API_ROUTES.sessions, { workspaceId, title: `${value} 计划` })).body.id as string
    const target = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId: target, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === target)
    expect((await api.post(apiPaths.sessionMessages(target), { text: `看 @session:${source} 和 @${value}.md` })).status).toBe(202)
    await stream.waitFor(isRunEnd(target))

    const user = stream.entries(target).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')!
    const texts = (user.payload as { content: { text: string }[] }).content.map((block) => block.text)
    const blocks = texts.filter((text) => /^<(session|file)_reference /.test(text))
    // 用户输入的文本按原样保留；附上的两个块在开标签里只有替换后的占位。
    expect(texts).toContain(`看 @session:${source} 和 @${value}.md`)
    expect(blocks.map((text) => text.split('\n')[0])).toEqual([
      `<session_reference id="${source}" title="[REDACTED:secret] 计划">`,
      '<file_reference path="[REDACTED:secret].md">',
    ])
    expect(blocks.join('\n')).not.toContain('p&amp;ss')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
  })
})

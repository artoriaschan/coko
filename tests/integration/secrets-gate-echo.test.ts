// 秘密不外泄总闸的模型通道（ADR 0007）：登记的 Secret 经工具结果进入运行时之前就按值替换，模型请求（faux requestLog）、内存中的对话
// 与库、推送一致。模型回显登记值（它可能从用户输入或别处得到）时，assistant 文本、toolCall 参数（tool_start、审批对象）、流式增量与压缩
// 摘要在入库与推送前同样按值替换；工具实际执行时仍拿到模型给出的原参数。
// 独立运行：Secret 来自 COKO_SECRET_<NAME>，值不是凭据形态，名字也不匹配命令环境的剔除模式。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const MARK = '[REDACTED:secret]'

describe('秘密不外泄总闸：模型请求与模型回显', () => {
  it('工具结果中的登记值在进入模型请求之前替换；模型回显的文本、参数、流式增量与摘要也不含明文', { timeout: 120_000 }, async () => {
    const value = `postgres://svc:echo${randomBytes(12).toString('hex')}@db.internal/app`
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'dsn.txt'), `DSN=${value}\n`)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      // 小步长：回显的值跨多个流式增量。
      tokensPerSecond: 4_000,
      responses: [
        { content: 'ok1' },
        { content: 'ok2' },
        // 读到登记值的工具结果。
        { content: [{ type: 'toolCall', name: 'read', id: 'r1', arguments: { path: 'dsn.txt' } }] },
        // 模型回显：文本与 bash 参数都含登记值。
        {
          content: [
            { type: 'text', text: `The DSN is ${value}.` },
            { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: `printf '%s' '${value}' | wc -c` } },
          ],
        },
        { content: `Done with ${value}` },
        // /compact 的摘要回显登记值。
        { content: `## Goal\nConnect using ${value}` },
        { content: 'after compaction' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_MY_SERVICE_DSN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
    const turn = async (text: string) => {
      const before = runEnds().length
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => runEnds().length > before, 60_000)
    }
    await turn('hello')
    await turn('p'.repeat(100_000))
    await turn('read the dsn')
    await turn('/compact')
    await turn('continue')

    // 前置：各通道确实被驱动。
    const entries = stream.entries(sessionId)
    const payloads = entries.map((e) => e.payload as { role?: string; toolCallId?: string; content?: unknown })
    const read = payloads.find((p) => p.role === 'toolResult' && p.toolCallId === 'r1')!
    expect(JSON.stringify(read.content)).toContain(`DSN=${MARK}`)
    // bash 实际执行时拿到的是原参数：输出为原值的字节数。
    const bash = payloads.find((p) => p.role === 'toolResult' && p.toolCallId === 'b1')!
    expect(JSON.stringify(bash.content)).toContain(String(value.length))
    const echo = payloads.find((p) => p.role === 'assistant' && JSON.stringify(p.content).includes('The DSN is'))!
    expect(JSON.stringify(echo.content)).toContain(`The DSN is ${MARK}.`)
    expect(JSON.stringify(echo.content)).toContain(`'${MARK}'`)
    const compaction = entries.find((e) => e.kind === 'compaction')!
    expect((compaction.payload as { summary: string }).summary).toContain(`Connect using ${MARK}`)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests.length).toBeGreaterThanOrEqual(7)
    // 读到值之后的请求里，工具结果已是标记；压缩之后的请求带替换后的摘要。
    expect(requests.some((line) => line.includes(`DSN=${MARK}`))).toBe(true)
    expect(requests.at(-1)).toContain(`Connect using ${MARK}`)
    // 同一内容块的流式增量拼接后同样不含明文。
    const deltas = new Map<string, string>()
    for (const frame of stream.frames) {
      const m = JSON.parse(frame) as { type: string; runId?: string; event?: { type: string; kind?: string; contentIndex?: number; delta?: string } }
      if (m.type !== 'progress' || m.event?.type !== 'assistant_delta') continue
      const key = `${m.runId}:${m.event.kind}:${m.event.contentIndex}`
      deltas.set(key, (deltas.get(key) ?? '') + m.event.delta)
    }
    expect([...deltas.values()].some((text) => text.includes(`The DSN is ${MARK}`))).toBe(true)

    const running = await persisted(dirs)
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...[...deltas].map(([key, text]): [string, string] => [`assistant deltas ${key}`, text]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

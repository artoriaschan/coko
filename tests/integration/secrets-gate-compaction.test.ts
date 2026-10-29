// 秘密不外泄总闸的压缩通道（ADR 0004）：摘要请求的错误回显 Credential。压缩引入的通道——compaction_failed 进度的 message，
// 以及手动压缩失败的 run_end——与日志、库中都不得出现明文。摘要正文是模型输出，与 assistant 文本相同，不属于本通道。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, marker, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：压缩', () => {
  it('摘要请求的错误回显 Credential：compaction_failed、run_end、日志与库中没有明文', { timeout: 90_000 }, async () => {
    const credential = marker('cred')
    const echoed = `Incorrect API key provided: ${credential}`
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    const dirs = await sidecarDirs()
    const failure = { content: [], stopReason: 'error', errorMessage: echoed }
    const script = await fauxScript(root, {
      contextWindow: 60_000,
      maxTokens: 4_000,
      // Run 1–2 建立越过阈值的历史；Run 2 的请求前自动压缩失败；之后 /compact 失败。
      responses: [{ content: 'ok1' }, failure, { content: 'ok2' }, failure],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, DEEPSEEK_API_KEY: credential } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
    const turn = async (text: string) => {
      const before = runEnds().length
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => runEnds().length > before, 30_000)
    }
    await turn('p'.repeat(100_000))
    await turn('q'.repeat(80_000))
    await turn('/compact')

    // 前置：两个通道确实被驱动。
    const failed = stream.frames.filter((frame) => (JSON.parse(frame) as { event?: { type: string } }).event?.type === 'compaction_failed')
    expect(failed).toHaveLength(2)
    expect(failed[0]).toContain('Incorrect API key provided: [REDACTED]')
    expect(runEnds().at(-1)!.payload).toMatchObject({ status: 'error', error: { code: 'model_error' } })
    const runEndFrames = stream.frames.filter((frame) => frame.includes('"run_end"'))

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...failed.map((frame, i): [string, string] => [`compaction_failed frame ${i}`, frame]),
      ...runEndFrames.map((frame, i): [string, string] => [`run_end frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...files.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential })).toEqual([])
  })
})

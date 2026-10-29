// 秘密不外泄总闸：一次提交通道（provider.save，ADR 0010）。IPC 模式下两个唯一标记的 Key 经 provider.save 新建与替换，
// 编辑时另有一次不带 Key 的保存；模型服务替身在错误中回显 Authorization。WebSocket 帧、HTTP 响应体、sidecar 发往 main 的控制消息、
// coko.db（含 -wal / -shm）与 sidecar.jsonl 中都不得出现明文。
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage } from '@coko/protocol'
import { answerDecrypts, connect, customProvider, exchange, saveProvider, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { echoingModelServer, leaksIn, marker, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：一次提交', () => {
  it('新建与替换的 Key 不出现在 WebSocket 帧、HTTP 响应体、控制消息、库文件与日志中', { timeout: 120_000 }, async () => {
    const first = marker('save')
    const second = marker('swap')
    const dirs = await sidecarDirs()
    const baseUrl = await echoingModelServer()
    const sidecar = await startSidecar({ dirs })
    const decrypts = answerDecrypts(sidecar)
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
    const run = async () => {
      const id = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, model: { providerId: 'gate-provider', modelId: 'gate-model' } })).body
        .id as string
      stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
      await api.post(apiPaths.sessionMessages(id), { text: 'hello' })
      const end = (await stream.waitFor((m) => m.type === 'entry' && m.sessionId === id && m.entry.kind === 'run_end')) as Extract<
        ServerMessage,
        { type: 'entry' }
      >
      await api.get(apiPaths.session(id))
      return end
    }

    expect(await saveProvider(sidecar, customProvider('gate-provider', baseUrl, ['gate-model']), { secret: first })).toMatchObject({ ok: true })
    // 前置：Key 确实发给了模型服务并被回显（否则"没有明文"不能证明什么）。
    expect((await run()).entry.payload).toMatchObject({ status: 'error', error: { message: expect.stringContaining('Incorrect API key') } })
    expect(await saveProvider(sidecar, { ...customProvider('gate-provider', baseUrl, ['gate-model']), name: 'Gate' }, { mode: 'update' })).toMatchObject({
      ok: true,
    })
    expect(await saveProvider(sidecar, customProvider('gate-provider', baseUrl, ['gate-model']), { mode: 'update', secret: second })).toMatchObject({
      ok: true,
    })
    // 失败的提交（重复 ID）同样不回显 Key。
    expect(await saveProvider(sidecar, customProvider('gate-provider', baseUrl, ['gate-model']), { secret: second })).toMatchObject({ ok: false })
    expect((await run()).entry.payload).toMatchObject({ status: 'error', error: { message: expect.stringContaining('Incorrect API key') } })
    expect(decrypts).toHaveLength(2)
    await api.get(API_ROUTES.providers)
    await api.get(API_ROUTES.models)
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...sidecar.messages.map((message, i): [string, string] => [`control ${message.type} ${i}`, JSON.stringify(message)]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { 'first key': first, 'second key': second })).toEqual([])
  })
})

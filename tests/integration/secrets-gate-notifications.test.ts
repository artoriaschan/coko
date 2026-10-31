// 秘密不外泄总闸的桌面通知通道（ADR 0004、0007）：定时任务的 title 含登记的 Secret（IPC 模式，库中密文经 main 解密后登记为脱敏来源）。通知引入的
// 外发通道——Sidecar 发给 main 的 notify 控制消息（title 与 body）——以及 Sidecar 日志与 stderr 中都不得出现明文。本功能不读取文件，不涉及符号链接越界。
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, schedulePaths } from '@coko/protocol'
import {
  advanceClock,
  client,
  connect,
  exchange,
  fauxScript,
  notifyMessages,
  pollUntil,
  sidecarDirs,
  startSidecar,
  tempDir,
  testCipher,
} from './sidecar-harness.ts'
import { leaksIn, persisted } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：桌面通知', () => {
  it('定时任务 title 含登记 Secret：notify 控制消息、日志与 stderr 中没有明文', { timeout: 90_000 }, async () => {
    const value = 'notify-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const workspaceDir = join(root, 'ws')
    await mkdir(workspaceDir)
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, {
      responses: [
        // 先经 secret_probe 解密一次（登记为脱敏来源），下一次请求再创建任务。
        { match: 'set it up', content: [{ type: 'toolCall', name: 'secret_probe', id: 'p1', arguments: {} }] },
        {
          match: 'set it up',
          content: [{ type: 'toolCall', name: 'schedule_create', id: 'c1', arguments: { title: 'ping ' + value, prompt: 'prompt-notify', after_seconds: 60 } }],
        },
        { match: 'set it up', content: 'scheduled' },
        { match: 'prompt-notify', content: 'notified run done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1', COKO_TEST_CLOCK: '1' } })
    sidecar.onMessage((message) => {
      if (message.type === 'secret.decrypt')
        sidecar.send({ type: 'secret.decrypt.result', requestId: message.requestId, plaintext: testCipher.decrypt(message.ciphertext) })
    })
    sidecar.send({ type: 'secret.store', requestId: 1, name: 'COKO_TEST_SECRET', ciphertext: testCipher.encrypt(value), hint: value.slice(-4) })
    expect(await sidecar.waitMessage('secret.store.result')).toEqual({ type: 'secret.store.result', requestId: 1, ok: true })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = (n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'set it up' })
    await runEnds(1)
    await advanceClock(api, 60_000)
    await runEnds(2)
    await pollUntil(() => notifyMessages(sidecar).length >= 1, { timeoutMs: 20_000, what: 'a notify message' })
    // 前置：通道确实被驱动，通知的 title 带脱敏占位。
    expect(notifyMessages(sidecar)).toEqual([
      { type: 'notify', kind: 'schedule-run-ended', sessionId, title: 'ping [REDACTED:secret]', body: 'Scheduled task run finished' },
    ])
    expect((await api.get(schedulePaths.list(sessionId))).body[0].title).toBe('ping [REDACTED:secret]')

    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...notifyMessages(sidecar).map((m, i): [string, string] => ['notify message ' + i, JSON.stringify(m)]),
      ...sidecar.messages.map((m, i): [string, string] => ['control message ' + i, JSON.stringify(m)]),
      ...files.filter((f) => f.name.startsWith('sidecar')).map((f): [string, Buffer] => ['log ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

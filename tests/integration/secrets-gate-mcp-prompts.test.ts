// 秘密不外泄总闸的 MCP 提示模板通道（票 08，ADR 0007）：prompts/get 的展开文本进入 user message 条目与模型请求。登记不匹配剔除模式的
// Secret MY_SERVICE_DSN（IPC 模式，本测试模拟 main 的 safeStorage），在 MCP 配置 env 中引用；测试 Server 的 env 提示模板把该值原样放进
// 提示。展开文本入库前替换已登记的明文：WebSocket 帧、HTTP 响应体、库文件（含 -wal）、sidecar.jsonl 与 Sidecar stderr 中都没有明文。
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, type McpResponse } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

/** 可逆的假 safeStorage：密文字节不含明文。 */
const encrypt = (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64')
const decrypt = (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString()

describe('秘密不外泄总闸：MCP 提示模板', () => {
  it('提示模板展开文本中的登记 Secret 在条目、推送、响应、库与日志中都被替换', { timeout: 60_000 }, async () => {
    const value = `postgres://svc:dsn${randomBytes(12).toString('hex')}@db.internal/app`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [{ content: 'noted' }] })
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    sidecar.onMessage((message) => {
      if (message.type === 'secret.decrypt')
        sidecar.send({ type: 'secret.decrypt.result', requestId: message.requestId, plaintext: decrypt(message.ciphertext) })
    })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body as { id: string }

    sidecar.send({ type: 'secret.store', requestId: 1, name: 'MY_SERVICE_DSN', ciphertext: encrypt(value), hint: value.slice(-4) })
    expect(await sidecar.waitMessage('secret.store.result')).toEqual({ type: 'secret.store.result', requestId: 1, ok: true })
    await api.put(mcpPaths.servers, {
      servers: { vault: stdioServerConfig({ MCP_FIXTURE_FEATURES: 'prompts', MY_SERVICE_DSN: '${MY_SERVICE_DSN}' }) },
      expectedRevision: 0,
      workspaceId: workspace.id,
    })
    for (;;) {
      const body = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
      if (body.servers[0]?.status === 'connected') break
      expect(body.servers[0]?.status).not.toBe('failed')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/mcp__vault__env MY_SERVICE_DSN' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    // 前置：提示模板确实展开了，且明文位置是替换标记。
    const user = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')!
    expect(JSON.stringify(user.payload)).toContain('The value is [REDACTED:secret]')
    expect(stream.entries(sessionId).find((e) => e.kind === 'command')!.payload).toEqual({ name: 'mcp__vault__env', args: 'MY_SERVICE_DSN', source: 'mcp' })
    await api.get(apiPaths.session(sessionId))
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

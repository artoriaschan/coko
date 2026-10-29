// 秘密不外泄总闸的上下文用量通道（票 10）：GET /api/workspaces/:id/context 与 /api/sessions/:id/context 汇总 MCP 等贡献的诊断。
// 登记不匹配剔除模式的 Secret，一个 stdio 测试 Server 把它写到 stderr 后退出（连接失败）；两个接口的响应体（以及其余通道）中都没有明文。
// 当前上下文用量只带 MCP 的配置诊断与结果诊断，连接错误与 stderr 尾部只在 GET /api/mcp（secrets-gate-mcp.test.ts）；本用例防止之后把它们带进来时泄漏。
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, contextPaths, mcpPaths, type ContextUsageResponse, type McpResponse } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

const encrypt = (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64')
const decrypt = (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString()

describe('秘密不外泄总闸：上下文用量', () => {
  it('MCP 诊断进入上下文用量响应时不含已登记 Secret 的明文', { timeout: 90_000 }, async () => {
    const value = `postgres://svc:ctx${randomBytes(12).toString('hex')}@db.internal/app`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [] })
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
    expect(await sidecar.waitMessage('secret.store.result')).toMatchObject({ ok: true })

    await api.put(mcpPaths.servers, {
      servers: { leaky: stdioServerConfig({ MY_SERVICE_DSN: '${MY_SERVICE_DSN}', MCP_FIXTURE_STDERR_ENV: 'MY_SERVICE_DSN' }) },
      expectedRevision: 0,
      workspaceId: workspace.id,
    })
    for (;;) {
      const body = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
      if (body.servers[0]?.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const draft = (await api.get(contextPaths.workspace(workspace.id))).body as ContextUsageResponse
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    const session = (await api.get(contextPaths.session(sessionId))).body as ContextUsageResponse
    // 前置：两个响应都已记录进扫描范围（含 Server 失败之后的取值）。
    for (const usage of [draft, session]) expect(usage.contextWindow).toBeGreaterThan(0)
    expect(bodies.filter((body) => body.includes('"breakdown"'))).toHaveLength(2)

    const running = await persisted(dirs)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

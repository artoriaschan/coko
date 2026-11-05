// 秘密不外泄总闸的 MCP 通道（ADR 0007）：登记不匹配剔除模式的 Secret MY_SERVICE_DSN（IPC 模式，本测试模拟 main 的 safeStorage），
// 在全局 MCP 配置 env 中以 ${MY_SERVICE_DSN} 引用。stdio 测试 Server 只回报其 SHA-256 证明收到；另一个 Server 把它写到 stderr 后退出，
// 其 stderr 尾部进入 MCP 诊断；另一工具把值原样放进工具结果（条目、推送与日志中替换为标记）。Sidecar 自身环境中放同名变量（另一个值）：MCP 拿到的是登记的值，bash env 看不到登记的值。
// 扫描 WebSocket 帧、HTTP 响应体、库文件（含 -wal）、sidecar.jsonl 与 MCP 诊断中都没有明文；未登记的名字使 Server 启动失败并诊断。
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, secretPaths, type McpResponse } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { connect, exchange, fauxScript, isRunEnd, request, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

/** 可逆的假 safeStorage：密文字节不含明文。 */
const encrypt = (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64')
const decrypt = (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString()
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('秘密不外泄总闸：MCP', () => {
  it('登记的 Secret 只进入引用它的 MCP Server；协议、库、日志、诊断与 bash env 中都没有明文；未登记的名字启动失败', { timeout: 90_000 }, async () => {
    // 不是凭据形态（不以 sk- 开头、名字不含 KEY / TOKEN / SECRET）：不能依赖通用脱敏规则或命令环境剔除。
    const value = `postgres://svc:dsn${randomBytes(12).toString('hex')}@db.internal/app`
    const hostValue = `host-dsn-${randomBytes(12).toString('hex')}`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    // 模型请求通道：工具结果在进入运行时之前替换，下一次请求里也没有明文。
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        {
          content: [
            { type: 'toolCall', name: 'mcp__dsn__env_sha', id: 'm1', arguments: { name: 'MY_SERVICE_DSN' } },
            // 工具结果通道：Server 把值原样放进结果；入库、推送与日志前替换已登记的明文（共享的按值脱敏）。
            { type: 'toolCall', name: 'mcp__dsn__env_raw', id: 'm2', arguments: { name: 'MY_SERVICE_DSN' } },
            { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'env' } },
          ],
        },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, MY_SERVICE_DSN: hostValue } })
    sidecar.onMessage((message) => {
      if (message.type === 'secret.decrypt')
        sidecar.send({ type: 'secret.decrypt.result', requestId: message.requestId, plaintext: decrypt(message.ciphertext) })
    })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body as { id: string }

    // 登记：main 加密后经控制 IPC 交给 Sidecar；接口只返回名字与末四位。
    sidecar.send({ type: 'secret.store', requestId: 1, name: 'MY_SERVICE_DSN', ciphertext: encrypt(value), hint: value.slice(-4) })
    expect(await sidecar.waitMessage('secret.store.result')).toEqual({ type: 'secret.store.result', requestId: 1, ok: true })
    expect((await api.get(secretPaths.secrets)).body).toMatchObject({ source: 'stored', secrets: [{ name: 'MY_SERVICE_DSN', hint: value.slice(-4) }] })

    const env = { MY_SERVICE_DSN: '${MY_SERVICE_DSN}' }
    await api.put(mcpPaths.servers, {
      servers: {
        dsn: stdioServerConfig(env, { alwaysLoad: true }),
        leaky: stdioServerConfig({ ...env, MCP_FIXTURE_STDERR_ENV: 'MY_SERVICE_DSN' }),
        missing: stdioServerConfig({ OTHER: '${NOT_REGISTERED}' }),
      },
      expectedRevision: 0,
      workspaceId: workspace.id,
    })
    const settled = async () => {
      for (;;) {
        const body = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
        if (body.servers.every((s) => s.status === 'connected' || s.status === 'failed')) return body
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    const servers = (await settled()).servers
    const byName = Object.fromEntries(servers.map((s) => [s.name, s]))
    expect(byName.dsn!.status).toBe('connected')
    // MCP 诊断通道：stderr 尾部含该值的位置被替换为标记。
    expect(byName.leaky).toMatchObject({ status: 'failed', stderrTail: expect.stringContaining('MY_SERVICE_DSN=[REDACTED:secret]') })
    expect(byName.missing).toMatchObject({ status: 'failed', error: expect.stringContaining('NOT_REGISTERED is not registered') })

    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'check the dsn' })
    await stream.waitFor(isRunEnd(sessionId))
    await api.get(apiPaths.session(sessionId))
    const results = stream
      .entries(sessionId)
      .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
      .map((e) => e.payload as { toolCallId: string; content: { text?: string }[] })
    const text = (id: string) =>
      results
        .find((r) => r.toolCallId === id)!
        .content.map((c) => c.text ?? '')
        .join('')
    // 前置：MCP Server 收到的是登记的值（不是 Sidecar 环境中的同名变量）；bash 确实运行了 env。
    expect(JSON.parse(text('m1'))).toEqual({ name: 'MY_SERVICE_DSN', sha256: sha256(value) })
    expect(text('m2')).toBe('MY_SERVICE_DSN=[REDACTED:secret]')
    expect(text('b1')).toContain('PATH=')
    expect(text('b1')).toContain(`MY_SERVICE_DSN=${hostValue}`)
    expect(text('b1')).not.toContain(value)

    // 删除：引用它的连接关闭；重连时因未登记而失败并诊断。
    const deleted = await request(sidecar.port, 'DELETE', secretPaths.secret('MY_SERVICE_DSN'), { headers: { cookie } })
    expect(deleted.status).toBe(204)
    expect((await api.get(secretPaths.secrets)).body).toEqual({ source: 'stored', secrets: [] })
    const reconnected = (await api.post(mcpPaths.reconnect, { workspaceId: workspace.id, name: 'dsn' })).body as McpResponse
    expect(reconnected.servers.find((s) => s.name === 'dsn')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('MY_SERVICE_DSN is not registered'),
    })
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    expect(running.some((f) => f.name === 'coko.db-wal')).toBe(true)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('MY_SERVICE_DSN=[REDACTED:secret]')
    const channels: [string, string | Buffer][] = [
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})

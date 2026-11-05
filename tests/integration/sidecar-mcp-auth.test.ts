// MCP 认证状态（docs/subsystems/mcp.md#连接与生命周期）：真实 Sidecar + 仓库内的 HTTP 测试 Server（缺少或错误的 Authorization 回 401）。
// 401 → auth-required、诊断 mcp-auth-required、之后 10 秒内没有新的连接尝试（含 Run 开始时）；只在 tools/call 时 401 同样进入 auth-required；
// 手动重连再试一次；改配置引用登记的 Secret 后 connected。对手用例：401 响应体与 WWW-Authenticate 中的令牌不出现在诊断、日志、HTTP 与 WS 中。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, type McpResponse, type McpServerInfo } from '@coko/protocol'
import { startHttpFixture } from '../fixtures/mcp/index.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

/** 可逆的假 safeStorage（同 secrets-gate-mcp）。 */
const encrypt = (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64')
const decrypt = (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString()

describe('MCP 认证：auth-required', () => {
  it(
    '401 → auth-required 与诊断、10 秒内不再连接；tools/call 的 401 同样处理；重连再试；引用登记的 Secret 后 connected；令牌不外泄',
    { timeout: 90_000 },
    async () => {
      const token = `mcp-${randomBytes(12).toString('hex')}`
      const leak = `srv-${randomBytes(12).toString('hex')}`
      const strict = await startHttpFixture({ name: 'strict', auth: { authorization: `Bearer ${token}`, leak } })
      onTestFinished(() => strict.close())
      const callOnly = await startHttpFixture({ name: 'callonly', auth: { authorization: `Bearer ${token}`, leak, methods: ['tools/call'] } })
      onTestFinished(() => callOnly.close())
      const initializes = (fixture: { methods: string[] }) => fixture.methods.filter((m) => m === 'initialize').length

      const root = await tempDir()
      const workspaceDir = join(root, 'ws')
      await mkdir(workspaceDir)
      const dirs = await sidecarDirs()
      const requestLog = join(root, 'requests.jsonl')
      await writeFile(requestLog, '')
      const script = await fauxScript(root, {
        requestLog,
        responses: [
          { content: [{ type: 'toolCall', name: 'mcp__callonly__echo', id: 'c1', arguments: { text: 'hi' } }] },
          { content: 'one' },
          { content: 'two' },
        ],
      })
      const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
      sidecar.onMessage((message) => {
        if (message.type === 'secret.decrypt')
          sidecar.send({ type: 'secret.decrypt.result', requestId: message.requestId, plaintext: decrypt(message.ciphertext) })
      })
      const cookie = await exchange(sidecar)
      const bodies: string[] = []
      const api = recordingClient(sidecar, cookie, bodies)
      const stream = await connect(sidecar, cookie)
      const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string }
      sidecar.send({ type: 'secret.store', requestId: 1, name: 'MCP_TOKEN', ciphertext: encrypt(token), hint: token.slice(-4) })
      expect(await sidecar.waitMessage('secret.store.result')).toMatchObject({ ok: true })

      const view = async () => (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
      const waitServer = async (name: string, match: (s: McpServerInfo) => boolean): Promise<McpServerInfo> => {
        const deadline = Date.now() + 20_000
        for (;;) {
          const found = (await view()).servers.find((s) => s.name === name)
          if (found && match(found)) return found
          if (Date.now() > deadline) throw new Error(`server ${name} never matched; last: ${JSON.stringify(found)}`)
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }

      const wrong = { Authorization: 'Bearer wrong-literal' }
      let revision = 0
      const save = async (servers: Record<string, unknown>) => {
        const saved = await api.put(mcpPaths.servers, { servers, expectedRevision: revision, workspaceId: workspace.id })
        expect(saved.status).toBe(200)
        revision++
      }
      await save({ strict: { url: strict.url, headers: wrong }, callonly: { url: callOnly.url, headers: wrong, alwaysLoad: true } })

      // 401：auth-required（不是 failed），错误为固定文案，诊断 mcp-auth-required。
      const required = await waitServer('strict', (s) => s.status === 'auth-required')
      const since = Date.now()
      expect(required.error).toBe('MCP server "strict" requires authentication (HTTP 401)')
      expect(required.tools).toEqual([])
      await waitServer('callonly', (s) => s.status === 'connected')
      const diagnostics = (await view()).diagnostics
      expect(diagnostics.filter((d) => d.code === 'mcp-auth-required')).toEqual([
        { source: 'mcp', code: 'mcp-auth-required', message: expect.stringContaining('"strict"') },
      ])
      expect(initializes(strict)).toBe(1)

      // 只在 tools/call 时 401：该次调用为错误结果（不含令牌），Server 进入 auth-required，Run 正常结束。
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
      await api.post(apiPaths.sessionMessages(sessionId), { text: 'call it' })
      await stream.waitFor(() => runEnds().length >= 1)
      const result = stream
        .entries(sessionId)
        .map((e) => e.payload as { role?: string; toolCallId?: string; isError?: boolean; content?: { text?: string }[] })
        .find((p) => p.role === 'toolResult' && p.toolCallId === 'c1')!
      expect(result.isError).toBe(true)
      expect(result.content!.map((c) => c.text ?? '').join('')).toContain('requires authentication')
      expect(callOnly.rejected).toEqual(['tools/call'])
      await waitServer('callonly', (s) => s.status === 'auth-required')
      const callOnlyAttempts = initializes(callOnly)

      // 之后的 Run 不重试 auth-required 的 Server；auth-required 之后 10 秒内两个 Server 都没有新的连接尝试。
      await api.post(apiPaths.sessionMessages(sessionId), { text: 'again' })
      await stream.waitFor(() => runEnds().length >= 2)
      while (Date.now() - since < 10_000) {
        expect([initializes(strict), initializes(callOnly)]).toEqual([1, callOnlyAttempts])
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect((await view()).servers.find((s) => s.name === 'strict')?.status).toBe('auth-required')

      // 手动重连：再试一次，仍是 auth-required。
      const reconnected = await api.post(mcpPaths.reconnect, { workspaceId: workspace.id, name: 'strict' })
      expect(reconnected.status).toBe(200)
      expect((reconnected.body as McpResponse).servers.find((s) => s.name === 'strict')?.status).toBe('auth-required')
      expect(initializes(strict)).toBe(2)

      // 改配置引用登记的 Secret：重新连接并 connected，请求头是 Secret 的值。
      const fixed = { Authorization: 'Bearer ${MCP_TOKEN}' }
      await save({ strict: { url: strict.url, headers: fixed }, callonly: { url: callOnly.url, headers: fixed, alwaysLoad: true } })
      expect((await waitServer('strict', (s) => s.status === 'connected')).tools.length).toBeGreaterThan(0)
      await waitServer('callonly', (s) => s.status === 'connected')
      expect(strict.headers.at(-1)?.authorization).toBe(`Bearer ${token}`)
      expect((await view()).diagnostics.filter((d) => d.code === 'mcp-auth-required')).toEqual([])

      // 对手用例：401 响应体与 WWW-Authenticate 中的令牌（以及登记的 Secret）不出现在任何通道。
      const running = await persisted(dirs)
      expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
      const stopped = await persisted(dirs)
      const log = stopped.find((f) => f.name === 'sidecar.jsonl')!.bytes.toString('utf8')
      expect(log).toContain('mcp server requires authentication')
      const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
      const channels: [string, string | Buffer][] = [
        ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
        ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
        ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
        ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
        ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
        ['sidecar stderr', sidecar.stderr()],
      ]
      expect(leaksIn(channels, { 'token in the 401 response': leak, 'registered secret': token })).toEqual([])
    },
  )
})

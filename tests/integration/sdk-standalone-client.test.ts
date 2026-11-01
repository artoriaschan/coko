// 外部客户端（packages/protocol/README.md 的示例，接收侧）：只用 @coko/protocol 与 ws（另有 Node 内置模块与全局 fetch）。启动 standalone Sidecar，
// 读 stdout 的 ready，以令牌交换 cookie，建 Workspace 与 Session，订阅，提交，收到 run_end，再经 HTTP 读回条目。不使用 sidecar-harness。
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Value } from 'typebox/value'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { API_ROUTES, apiPaths, ServerMessage, SidecarToMainMessage, type SessionDetailResponse } from '@coko/protocol'

const electron = createRequire(import.meta.url)('electron') as string
const sidecarEntry = fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

/** standalone Sidecar：没有 IPC 时控制消息逐行写到 stdout，第一条 ready 带端口与一次性令牌。 */
async function startStandalone(env: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'coko-client-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const child = spawn(electron, [sidecarEntry, '--data-dir', join(root, 'data'), '--log-dir', join(root, 'logs')], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_RUN_AS_NODE: '1', COKO_HOME: join(root, 'home'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  cleanup.push(async () => {
    if (child.exitCode === null) child.kill('SIGTERM')
    await exited
  })
  const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    let buffered = ''
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buffered += chunk
      for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
        const message = JSON.parse(buffered.slice(0, at)) as unknown
        buffered = buffered.slice(at + 1)
        if (Value.Check(SidecarToMainMessage, message) && message.type === 'ready') resolve(message)
      }
    })
    child.once('exit', (code) => reject(new Error(`sidecar exited with ${String(code)}`)))
  })
  return { ...ready, root, exited, child }
}

describe('外部客户端：@coko/protocol + ws', () => {
  it('ready → 交换令牌 → 建 Session → 订阅 → 提交 → run_end → 读回条目', { timeout: 120_000 }, async () => {
    const scripts = await realpath(await mkdtemp(join(tmpdir(), 'coko-client-faux-')))
    cleanup.push(() => rm(scripts, { recursive: true, force: true }))
    const script = join(scripts, 'faux.json')
    await writeFile(script, JSON.stringify({ responses: [{ content: 'hello from coko' }] }))
    const sidecar = await startStandalone({ COKO_FAUX_SCRIPT: script })
    const base = `http://127.0.0.1:${sidecar.port}`

    // 认证：令牌只能交换一次，换得的 cookie 绑定这个 authority（Host 头由 fetch 按 URL 给出）。
    const exchanged = await fetch(base + API_ROUTES.authExchange, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: sidecar.token }),
    })
    expect(exchanged.status).toBe(204)
    const cookie = exchanged.headers.get('set-cookie')!.split(';')[0]!
    const again = await fetch(base + API_ROUTES.authExchange, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: sidecar.token }),
    })
    expect(again.status).not.toBe(204)
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, body: response.status === 204 ? undefined : ((await response.json()) as Record<string, unknown>) }
    }

    const workspace = await api('POST', API_ROUTES.workspaces, { path: await realpath(sidecar.root) })
    expect(workspace.status).toBe(201)
    const session = await api('POST', API_ROUTES.sessions, { workspaceId: workspace.body!.id })
    expect(session.status).toBe(201)
    const sessionId = session.body!.id as string

    // 订阅：先 subscribed（补发 afterSeq 之后的条目），之后推送 entry 与 progress。
    const ws = new WebSocket(`ws://127.0.0.1:${sidecar.port}${API_ROUTES.stream}`, { headers: { cookie } })
    const received: ServerMessage[] = []
    const invalid: unknown[] = []
    let notify = () => {}
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as unknown
      if (Value.Check(ServerMessage, message)) received.push(message)
      else invalid.push(message)
      notify()
    })
    cleanup.push(async () => {
      ws.close()
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    const until = (predicate: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((resolve) => {
        const check = () => {
          const found = received.find(predicate)
          if (found) resolve(found)
        }
        notify = check
        check()
      })
    ws.send(JSON.stringify({ type: 'subscribe', sessionId, afterSeq: 0 }))
    await until((m) => m.type === 'subscribed' && m.sessionId === sessionId)

    const submitted = await api('POST', apiPaths.sessionMessages(sessionId), { text: 'say hello' })
    expect(submitted.status).toBe(202)
    const runId = submitted.body!.runId as string
    const end = await until((m) => m.type === 'progress' && m.runId === runId && m.event.type === 'run_end')
    expect(end).toMatchObject({ type: 'progress', sessionId, runId, event: { type: 'run_end', status: 'completed' } })
    expect(invalid).toEqual([])

    // 读回：条目与推送的一致，最后一条 assistant 是模型的回复。
    const detail = (await api('GET', apiPaths.session(sessionId))).body as unknown as SessionDetailResponse
    const pushed = received.flatMap((m) => (m.type === 'entry' ? [m.entry.seq] : []))
    expect(detail.entries.map((e) => e.seq)).toEqual(expect.arrayContaining(pushed))
    const assistant = detail.entries.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'assistant').at(-1)!
    expect(assistant.payload).toMatchObject({ content: [{ type: 'text', text: 'hello from coko' }] })
    expect(detail.entries.at(-1)).toMatchObject({ kind: 'run_end', runId, payload: { status: 'completed' } })

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toBe(0)
  })
})

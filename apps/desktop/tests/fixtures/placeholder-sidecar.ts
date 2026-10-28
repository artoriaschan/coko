// 占位 Sidecar：以 ELECTRON_RUN_AS_NODE=1 运行，供 desktop 测试验证 main 的生命周期、代理与头注入。
// 遵守 Sidecar 控制 IPC 与 ADR 0002 的认证模型：ready 携带端口与一次性令牌，令牌交换 HMAC 签名 cookie，
// 所有路由先过信任围栏（403）再校验 cookie（401）。不是 apps/server 的实现。
//
// 环境变量（仅测试使用）：
//   COKO_FIXTURE_MODE   normal | fatal | exit | hang | invalid | ignore-shutdown | ignore-sigterm | slow-inspect
//                       | fatal-after-first（事件文件中已有 spawned 记录时 fatal，用于模拟重启后一直失败）
//   COKO_FIXTURE_STDERR 启动时写到 stderr 的文本（验证诊断尾部的脱敏）
//   COKO_FIXTURE_GATE   文件路径；存在后才继续启动（测试用它确定交叠位置）
//   COKO_FIXTURE_EVENTS 文件路径；逐行追加 JSON 事件（listening、request、upgrade、shutdown）
//   COKO_FIXTURE_ACTIVE_RUNS  inspect-quit 回答的活动 Run 数，默认 0
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Value } from 'typebox/value'
import { WebSocketServer } from 'ws'
import { API_ROUTES, MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'

const mode = process.env.COKO_FIXTURE_MODE ?? 'normal'
const eventsPath = process.env.COKO_FIXTURE_EVENTS
const gatePath = process.env.COKO_FIXTURE_GATE
const activeRuns = Number(process.env.COKO_FIXTURE_ACTIVE_RUNS ?? '0')
const COOKIE = 'coko-session'

function record(event: Record<string, unknown>): void {
  if (eventsPath !== undefined) appendFileSync(eventsPath, JSON.stringify({ pid: process.pid, ...event }) + '\n')
}

function send(message: SidecarToMainMessage | Record<string, unknown>, callback?: () => void): void {
  if (process.send === undefined) {
    process.stdout.write(JSON.stringify(message) + '\n')
    callback?.()
    return
  }
  process.send(message, undefined, {}, () => callback?.())
}

async function waitForGate(): Promise<void> {
  if (gatePath === undefined) return
  while (!existsSync(gatePath)) await new Promise((resolve) => setTimeout(resolve, 20))
}

process.stderr.write(`placeholder sidecar mode=${mode}\n`)
if (process.env.COKO_FIXTURE_STDERR) process.stderr.write(process.env.COKO_FIXTURE_STDERR + '\n')
const spawnedBefore = eventsPath !== undefined && existsSync(eventsPath) && readFileSync(eventsPath, 'utf8').includes('"event":"spawned"')
record({ event: 'spawned', mode, argv: process.argv.slice(2) })
send({ type: 'starting' })
await waitForGate()

if (mode === 'fatal' || (mode === 'fatal-after-first' && spawnedBefore)) {
  send({ type: 'fatal', code: 'fixture-fatal', message: '占位 Sidecar 按要求启动失败' }, () => process.exit(1))
} else if (mode === 'exit') {
  process.stderr.write('fixture exiting before ready\n')
  process.exit(3)
} else if (mode === 'invalid') {
  send({ type: 'ready', port: 'not-a-port', token: 'x' })
} else if (mode === 'hang') {
  // 不发 ready；保持进程存活直到被终止。
  setInterval(() => {}, 1000)
} else {
  await serve()
}

async function serve(): Promise<void> {
  let launchToken: Buffer | undefined = randomBytes(32)
  const key = randomBytes(32)
  const sockets = new Set<import('ws').WebSocket>()

  const server = createServer((request, response) => {
    handle(request, response)
  })
  const wss = new WebSocketServer({ noServer: true })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  const port = address.port
  const authority = `127.0.0.1:${port}`

  const sign = (value: string): string => createHmac('sha256', key).update(`${authority}|${value}`).digest('base64url')

  // 信任围栏：Host 必须是监听地址；带 Origin 时必须同源；sec-fetch-site: cross-site 直接拒绝。
  const fenced = (request: IncomingMessage): boolean => {
    if (request.headers.host !== authority) return false
    const origin = request.headers.origin
    if (origin !== undefined && origin !== `http://${authority}`) return false
    return request.headers['sec-fetch-site'] !== 'cross-site'
  }

  const authenticated = (request: IncomingMessage): boolean => {
    const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
    const value = cookies.find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    if (value === undefined) return false
    const [issued, mac] = value.split('.')
    if (issued === undefined || mac === undefined) return false
    const expected = Buffer.from(sign(issued))
    const actual = Buffer.from(mac)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  const reply = (request: IncomingMessage, response: ServerResponse, status: number, body?: unknown, headers: Record<string, string | string[]> = {}): void => {
    record({ event: 'request', method: request.method, path: request.url, status, cookie: request.headers.cookie !== undefined })
    response.writeHead(status, { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers })
    response.end(body === undefined ? undefined : JSON.stringify(body))
  }

  const readBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!fenced(request)) return reply(request, response, 403)
    const path = new URL(request.url ?? '/', `http://${authority}`).pathname
    if (path === API_ROUTES.authExchange && request.method === 'POST') {
      let token: unknown
      try {
        token = (JSON.parse(await readBody(request)) as { token?: unknown }).token
      } catch {
        return reply(request, response, 400)
      }
      const presented = typeof token === 'string' ? Buffer.from(token) : Buffer.alloc(0)
      const expected = launchToken === undefined ? undefined : Buffer.from(launchToken.toString('base64url'))
      if (expected === undefined || presented.length !== expected.length || !timingSafeEqual(presented, expected)) return reply(request, response, 401)
      launchToken = undefined // 一次性
      const issued = String(Date.now())
      return reply(request, response, 204, undefined, { 'set-cookie': `${COOKIE}=${issued}.${sign(issued)}; HttpOnly; SameSite=Strict; Path=/` })
    }
    if (!authenticated(request)) return reply(request, response, 401)
    if (path === API_ROUTES.health && request.method === 'GET') return reply(request, response, 200, { status: 'ok' })
    if (path === '/api/fixture/echo') {
      const body = await readBody(request)
      // 故意下发 set-cookie，验证 main 会剥离。
      return reply(request, response, 200, { method: request.method, headers: request.headers, body }, { 'set-cookie': 'leak=1; Path=/' })
    }
    return reply(request, response, 404)
  }

  server.on('upgrade', (request, socket, head) => {
    const ok = fenced(request) && authenticated(request) && request.url === API_ROUTES.stream
    record({ event: 'upgrade', path: request.url, origin: request.headers.origin, accepted: ok })
    if (!ok) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws)
      ws.on('close', () => sockets.delete(ws))
      ws.on('message', (data) => ws.send(data.toString()))
    })
  })

  let stopping = false
  const shutdown = (): void => {
    if (stopping) return
    stopping = true
    record({ event: 'shutdown' })
    for (const ws of sockets) ws.terminate()
    server.closeAllConnections()
    server.close(() => {
      send({ type: 'shutdown-complete' }, () => {
        process.disconnect?.()
        process.exit(0)
      })
    })
  }

  process.on('message', (message: unknown) => {
    if (!Value.Check(MainToSidecarMessage, message)) return
    if (message.type === 'shutdown') {
      if (mode === 'ignore-shutdown' || mode === 'ignore-sigterm') return
      shutdown()
    } else if (message.type === 'inspect-quit') {
      if (mode === 'slow-inspect') return
      send({ type: 'inspect-quit.result', requestId: message.requestId, activeRuns })
    }
  })
  if (mode === 'ignore-sigterm') process.on('SIGTERM', () => record({ event: 'sigterm-ignored' }))
  // 父进程消失时自行退出，避免孤儿进程。
  process.on('disconnect', () => {
    if (mode !== 'ignore-shutdown' && mode !== 'ignore-sigterm') shutdown()
  })

  const token = launchToken.toString('base64url')
  record({ event: 'listening', port, token })
  send({ type: 'ready', port, token })
}

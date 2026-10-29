// 以 ELECTRON_RUN_AS_NODE=1 启动真实 Sidecar（apps/server 源码入口），经 HTTP / WebSocket / IPC 验证协议。
// 每个 Sidecar 用独立临时目录与端口 0；onTestFinished 登记 teardown，等待进程实际退出。
import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Value } from 'typebox/value'
import { onTestFinished } from 'vitest'
import { WebSocket } from 'ws'
import {
  API_ROUTES,
  MODEL_CATALOG_DEFAULTS,
  ServerMessage,
  SessionEntry,
  SidecarToMainMessage,
  type CatalogModel,
  type CreateProviderRequest,
  type MainToSidecarMessage,
} from '@coko/protocol'

const electronPath = createRequire(import.meta.url)('electron') as string
const entry = fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url))

export async function tempDir(prefix = 'coko-it-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Model Catalog 中的一个模型：默认容量、只有文本输入、推理关闭。 */
export const catalogModel = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: '',
  ...MODEL_CATALOG_DEFAULTS,
  input: ['text'],
  reasoning: false,
  thinkingLevels: [],
  ...extra,
})

/** 创建自定义 Provider 的请求体；models 给模型 ID 时使用默认能力。 */
export const customProvider = (id: string, baseUrl: string, models: (string | CatalogModel)[], api: CreateProviderRequest['api'] = 'openai-completions') =>
  ({ id, name: id, api, baseUrl, models: models.map((m) => (typeof m === 'string' ? catalogModel(m) : m)) }) satisfies CreateProviderRequest

/** 写 faux 脚本，返回其绝对路径。 */
export async function fauxScript(dir: string, script: unknown, name = 'faux.json'): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(script))
  return path
}

export interface SidecarDirs {
  dataDir: string
  logDir: string
  /**
   * 临时的用户级资源目录，经环境变量 COKO_HOME 交给 Sidecar（测试不读写真实的 ~/.coko）。目录在第一次写入时创建；
   * 用 writeCokoHome 写入其中的文件。
   */
  cokoHome: string
}

export async function sidecarDirs(): Promise<SidecarDirs> {
  const root = await tempDir('coko-sidecar-')
  return { dataDir: join(root, 'data'), logDir: join(root, 'logs'), cokoHome: join(root, 'coko-home') }
}

/** 在 dirs.cokoHome 下写文件（相对路径，父目录按需创建），返回绝对路径。 */
export async function writeCokoHome(dirs: Pick<SidecarDirs, 'cokoHome'>, relative: string, content: string): Promise<string> {
  const path = join(dirs.cokoHome, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return path
}

export interface SpawnOptions {
  dirs: SidecarDirs
  /** 额外环境变量（COKO_FAUX_SCRIPT 等）；不继承宿主的凭据变量。 */
  env?: Record<string, string>
  /** 默认 true：经 Node IPC 通信；false 时独立运行，ready 写到 stdout。 */
  ipc?: boolean
  args?: string[]
}

export interface SidecarProcess {
  readonly child: ChildProcess
  /** 按到达顺序的控制消息；每条都已通过 SidecarToMainMessage 校验。 */
  readonly messages: SidecarToMainMessage[]
  /** 未通过 schema 校验的消息。 */
  readonly invalid: unknown[]
  stderr(): string
  /** 等待满足条件的控制消息（含已到达的）。 */
  waitMessage<T extends SidecarToMainMessage['type']>(type: T, timeoutMs?: number): Promise<Extract<SidecarToMainMessage, { type: T }>>
  send(message: MainToSidecarMessage): void
  /** 对之后到达的每条合法控制消息调用（模拟 main 的应答）。 */
  onMessage(listener: (message: SidecarToMainMessage) => void): void
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export function spawnSidecar(options: SpawnOptions): SidecarProcess {
  const ipc = options.ipc ?? true
  const args = options.args ?? ['--data-dir', options.dirs.dataDir, '--log-dir', options.dirs.logDir]
  const child = spawn(electronPath, [entry, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_RUN_AS_NODE: '1', COKO_HOME: options.dirs.cokoHome, ...options.env },
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  let stderr = ''
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  const messages: SidecarToMainMessage[] = []
  const invalid: unknown[] = []
  const waiters = new Set<() => void>()
  const listeners = new Set<(message: SidecarToMainMessage) => void>()
  const accept = (raw: unknown) => {
    if (Value.Check(SidecarToMainMessage, raw)) {
      messages.push(raw)
      for (const listener of listeners) listener(raw)
    } else invalid.push(raw)
    for (const waiter of waiters) waiter()
  }
  if (ipc) child.on('message', accept)
  else {
    let buffered = ''
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buffered += chunk
      let at: number
      while ((at = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, at)
        buffered = buffered.slice(at + 1)
        try {
          accept(JSON.parse(line))
        } catch {
          invalid.push(line)
        }
      }
    })
  }
  child.once('exit', () => {
    for (const waiter of waiters) waiter()
  })
  return {
    child,
    messages,
    invalid,
    stderr: () => stderr,
    exited,
    send(message) {
      child.send(message)
    },
    onMessage(listener) {
      listeners.add(listener)
    },
    waitMessage(type, timeoutMs = 20_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = messages.find((message) => message.type === type)
          if (found) {
            cleanup()
            resolve(found as never)
          } else if (child.exitCode !== null || child.signalCode !== null) {
            cleanup()
            reject(new Error(`Sidecar exited before ${type}; messages=${JSON.stringify(messages)}\nstderr:\n${stderr}`))
          }
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error(`Timed out waiting for ${type}; stderr:\n${stderr}`))
        }, timeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          waiters.delete(check)
        }
        waiters.add(check)
        check()
      })
    },
  }
}

export interface Sidecar extends SidecarProcess {
  readonly port: number
  readonly token: string
  readonly authority: string
  /** IPC shutdown，等待 shutdown-complete 与进程退出。 */
  stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export async function startSidecar(options: SpawnOptions): Promise<Sidecar> {
  const proc = spawnSidecar(options)
  const ready = await proc.waitMessage('ready')
  return Object.assign(proc, {
    port: ready.port,
    token: ready.token,
    authority: `127.0.0.1:${ready.port}`,
    async stop() {
      proc.send({ type: 'shutdown' })
      await proc.waitMessage('shutdown-complete')
      return proc.exited
    },
  })
}

export interface HttpResult {
  status: number
  headers: IncomingHttpHeaders
  body: any
}

/** 原始 HTTP 请求；默认 Host 为 127.0.0.1:<port>，可覆盖以测试信任围栏。 */
export function request(port: number, method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<HttpResult> {
  const payload = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
          ...options.headers,
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8').on('data', (chunk: string) => (text += chunk))
        res.on('end', () => {
          let body: unknown = text
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            // 保留原文
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        })
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** 用启动令牌交换会话 cookie，返回 Cookie 头的 name=value。 */
export async function exchange(sidecar: Pick<Sidecar, 'port' | 'token'>): Promise<string> {
  const res = await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: { token: sidecar.token } })
  const setCookie = res.headers['set-cookie']?.[0]
  if (res.status !== 204 || !setCookie) throw new Error(`exchange failed: ${res.status}`)
  return setCookie.split(';')[0]!
}

/** 带 cookie 的 JSON 客户端。 */
export function client(sidecar: Pick<Sidecar, 'port'>, cookie: string) {
  const call = (method: string, path: string, body?: unknown) =>
    request(sidecar.port, method, path, { headers: { cookie }, ...(body === undefined ? {} : { body }) })
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    put: (path: string, body: unknown) => call('PUT', path, body),
    patch: (path: string, body: unknown) => call('PATCH', path, body),
    delete: (path: string) => call('DELETE', path),
  }
}

export type WsOutcome = { kind: 'open'; stream: Stream } | { kind: 'rejected'; status: number }

/** 发起 WebSocket 升级；被拒绝时返回状态码。 */
export function openStream(port: number, headers: Record<string, string>): Promise<WsOutcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${API_ROUTES.stream}`, { headers: { host: `127.0.0.1:${port}`, ...headers } })
    const stream = new Stream(ws)
    ws.once('open', () => {
      onTestFinished(async () => {
        await stream.close()
      })
      resolve({ kind: 'open', stream })
    })
    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      ws.terminate()
      resolve({ kind: 'rejected', status: res.statusCode ?? 0 })
    })
    ws.once('error', (error) => reject(error))
  })
}

export async function connect(sidecar: Pick<Sidecar, 'port'>, cookie: string): Promise<Stream> {
  const outcome = await openStream(sidecar.port, { cookie })
  if (outcome.kind !== 'open') throw new Error(`WebSocket rejected: ${outcome.status}`)
  return outcome.stream
}

/**
 * WebSocket 客户端：记录全部服务端消息（每条都校验 ServerMessage schema）。entry 消息另按 kind 判别的 SessionEntry
 * 校验，不合格的记入 invalidEntries；frames 保留原始文本帧（秘密总闸扫描用）。
 */
export class Stream {
  readonly messages: ServerMessage[] = []
  readonly invalid: unknown[] = []
  readonly invalidEntries: unknown[] = []
  readonly frames: string[] = []
  readonly #ws: WebSocket
  readonly #waiters = new Set<() => void>()
  readonly closed: Promise<number>

  constructor(ws: WebSocket) {
    this.#ws = ws
    ws.on('message', (data) => {
      const text = String(data)
      this.frames.push(text)
      const parsed = JSON.parse(text) as unknown
      if (Value.Check(ServerMessage, parsed)) {
        this.messages.push(parsed)
        if (parsed.type === 'entry' && !Value.Check(SessionEntry, parsed.entry)) this.invalidEntries.push(parsed.entry)
      } else this.invalid.push(parsed)
      for (const waiter of this.#waiters) waiter()
    })
    this.closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)))
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message))
  }

  /** 等待第一条满足条件的消息（含已收到的）。 */
  waitFor<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, timeoutMs?: number): Promise<T>
  waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>
  waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 20_000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.messages.find(predicate)
        if (found) {
          cleanup()
          resolve(found)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out; received ${JSON.stringify(this.messages.map((m) => (m.type === 'progress' ? `progress:${m.event.type}` : m.type === 'entry' ? `entry:${m.entry.seq}:${m.entry.kind}` : m.type)))}`,
          ),
        )
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        this.#waiters.delete(check)
      }
      this.#waiters.add(check)
      check()
    })
  }

  entries(sessionId: string) {
    return this.messages.flatMap((m) => (m.type === 'entry' && m.sessionId === sessionId ? [m.entry] : []))
  }

  close(): Promise<number> {
    if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) this.#ws.close()
    return this.closed
  }
}

export const isRunEnd = (sessionId: string) => (m: ServerMessage) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === 'run_end'

export interface ApprovalRequestEntry {
  requestId: string
  toolCallId: string
  toolName: string
  kind: 'tool' | 'escalation'
  subject: string
  targetMode?: string
  justification?: string
  suggestions: unknown[]
}

/** 等第 n 条（从 1 起）approval_request 条目，返回其 payload。 */
export async function waitApproval(stream: Stream, sessionId: string, n = 1): Promise<ApprovalRequestEntry> {
  const requests = () => stream.entries(sessionId).filter((e) => e.kind === 'approval_request')
  await stream.waitFor(() => requests().length >= n)
  return requests()[n - 1]!.payload as ApprovalRequestEntry
}

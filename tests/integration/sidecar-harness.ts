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
  type MainToSidecarMessage,
  type ProviderFields,
  type ProviderSaveMode,
  type SidecarProviderModelsResult,
  type SidecarProviderSaveResult,
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

/** 自定义 Provider 的完整配置（provider.save 的 provider 字段）；models 给模型 ID 时使用默认能力。 */
export const customProvider = (id: string, baseUrl: string, models: (string | CatalogModel)[], api: ProviderFields['api'] = 'openai-completions') =>
  ({ id, name: id, api, baseUrl, models: models.map((m) => (typeof m === 'string' ? catalogModel(m) : m)) }) satisfies ProviderFields

/** 测试中的"safeStorage"：可逆变换，密文字节不含明文。 */
export const testCipher = {
  encrypt: (plaintext: string) => Buffer.from([...Buffer.from(plaintext)].map((b) => b ^ 0x5a)).toString('base64'),
  decrypt: (ciphertext: string) => Buffer.from([...Buffer.from(ciphertext, 'base64')].map((b) => b ^ 0x5a)).toString(),
}

/** 模拟 main 回答 credential.decrypt（testCipher 解密），返回收到的密文。 */
export function answerDecrypts(sidecar: Pick<SidecarProcess, 'onMessage' | 'send'>): string[] {
  const requests: string[] = []
  sidecar.onMessage((message) => {
    if (message.type !== 'credential.decrypt') return
    requests.push(message.ciphertext)
    sidecar.send({ type: 'credential.decrypt.result', requestId: message.requestId, plaintext: testCipher.decrypt(message.ciphertext) })
  })
  return requests
}

let saveRequestId = 1_000

/**
 * 模拟 main 的一次提交（ADR 0010）：发 provider.save 并等待同一 requestId 的结果。secret 给出时用 testCipher 加密，
 * 提示取末四位（短于 8 个字符时为空，与 main 一致）。
 */
export function saveProvider(
  sidecar: Pick<SidecarProcess, 'onMessage' | 'send'>,
  provider: ProviderFields,
  options: { mode?: ProviderSaveMode; secret?: string; timeoutMs?: number } = {},
): Promise<SidecarProviderSaveResult> {
  const requestId = ++saveRequestId
  const { secret } = options
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      done = true
      reject(new Error(`provider.save ${requestId} was not answered`))
    }, options.timeoutMs ?? 20_000)
    sidecar.onMessage((message) => {
      if (done || message.type !== 'provider.save.result' || message.requestId !== requestId) return
      done = true
      clearTimeout(timer)
      resolve(message)
    })
    sidecar.send({
      type: 'provider.save',
      requestId,
      mode: options.mode ?? 'create',
      provider,
      ...(secret === undefined ? {} : { credential: { ciphertext: testCipher.encrypt(secret), hint: secret.length >= 8 ? secret.slice(-4) : '' } }),
    })
  })
}

let modelsRequestId = 2_000

/**
 * 模拟 main 的获取可用模型（ADR 0010）：发 provider.models 并等待同一 requestId 的结果。onSent 收到 requestId，用于随后发
 * provider.models.cancel。
 */
export function fetchModels(
  sidecar: Pick<SidecarProcess, 'onMessage' | 'send'>,
  request: { api?: ProviderFields['api']; baseUrl: string; providerId?: string; secret?: string },
  options: { timeoutMs?: number; onSent?: (requestId: number) => void } = {},
): Promise<SidecarProviderModelsResult> {
  const requestId = ++modelsRequestId
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      done = true
      reject(new Error(`provider.models ${requestId} was not answered`))
    }, options.timeoutMs ?? 20_000)
    sidecar.onMessage((message) => {
      if (done || message.type !== 'provider.models.result' || message.requestId !== requestId) return
      done = true
      clearTimeout(timer)
      resolve(message)
    })
    sidecar.send({ type: 'provider.models', requestId, api: request.api ?? 'openai-completions', ...request })
    options.onSent?.(requestId)
  })
}

/**
 * 在数据目录中预先写入 Provider：独立运行的 Sidecar 没有 main，不能保存 Provider（ADR 0010），先用一个 IPC 模式的
 * Sidecar 经 provider.save 写入，关闭后再启动被测实例。
 */
export async function seedProviders(dirs: SidecarDirs, providers: ProviderFields[]): Promise<void> {
  const seeder = await startSidecar({ dirs })
  for (const provider of providers) {
    const result = await saveProvider(seeder, provider)
    if (!result.ok) throw new Error(`seeding ${provider.id} failed: ${result.error.code} ${result.error.message}`)
  }
  const exit = await seeder.stop()
  if (exit.code !== 0) throw new Error(`seeding sidecar exited with ${String(exit.code)}`)
}

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

/**
 * SIGKILL Sidecar（不经有序关闭：Run、Job 与登记的子进程都不会被收尾），等它退出，再以同一数据目录与给定选项启动新 Sidecar。
 * 重启后的启动清理与启动恢复由新实例完成；faux 队列从头开始，需要不同回复时在 options.env 中换脚本。
 */
export async function killAndRestart(sidecar: Pick<SidecarProcess, 'child' | 'exited'>, options: SpawnOptions): Promise<Sidecar> {
  sidecar.child.kill('SIGKILL')
  const exit = await sidecar.exited
  if (exit.signal !== 'SIGKILL') throw new Error(`Sidecar exited before SIGKILL: ${JSON.stringify(exit)}`)
  return startSidecar(options)
}

/** 进程是否存在（signal 0；没有权限发信号的进程也算存在）。只用于测试自己启动或记录了 pid 的进程。 */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 等待这些进程都不存在（轮询进程表，不用固定 sleep）；超时时报出仍存在的 pid。 */
export async function waitProcessesGone(pids: readonly number[], timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const alive = pids.filter(processExists)
    if (alive.length === 0) return
    if (Date.now() > deadline) throw new Error(`Processes still running after ${timeoutMs} ms: ${alive.join(', ')}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
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

/** 测试时钟（Sidecar 以 COKO_TEST_CLOCK=1 启动）：拨快 ms 毫秒，返回 Sidecar 的当前时刻。到期的计时器在返回前触发。 */
export async function advanceClock(api: ReturnType<typeof client>, ms: number): Promise<number> {
  const response = await api.post('/api/test/clock', { advanceMs: ms })
  if (response.status !== 200) throw new Error(`advanceClock failed: ${response.status} ${JSON.stringify(response.body)}`)
  return (response.body as { now: number }).now
}

/** 测试时钟：设定为某一时刻（不能早于当前）。 */
export async function setClock(api: ReturnType<typeof client>, at: number): Promise<number> {
  const response = await api.post('/api/test/clock', { setMs: at })
  if (response.status !== 200) throw new Error(`setClock failed: ${response.status} ${JSON.stringify(response.body)}`)
  return (response.body as { now: number }).now
}

/** Sidecar 发给 main 的 notify 控制消息（桌面通知；main 是否显示见 desktop E2E 的 notificationsShown）。 */
export const notifyMessages = (sidecar: Pick<SidecarProcess, 'messages'>) => sidecar.messages.filter((m) => m.type === 'notify')

/** Hook 测试夹具（tests/fixtures/hooks/hook.mjs）的绝对路径与命令拼装（node 取当前进程的可执行文件）。 */
export const hookFixturePath = fileURLToPath(new URL('../fixtures/hooks/hook.mjs', import.meta.url))
export const hookCommand = (...args: string[]) => [process.execPath, hookFixturePath, ...args].map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' ')

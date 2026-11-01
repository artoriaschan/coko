// 语言服务器客户端：JSON-RPC 2.0 over stdio（Content-Length 分帧）、initialize / initialized、请求超时、服务器发来的请求与通知，以及关闭序列
// shutdown → exit → SIGTERM → SIGKILL（各等待 graceMs）。进程以独立进程组启动（POSIX 上 detached，pgid = pid），宿主以 host_processes 的 lsp
// 类别登记（ADR 0012）。环境与 MCP stdio 相同：Sidecar 环境剔除 HOST_ENV_EXCLUSIONS，再合并配置的 env（不注入 Secret）。
import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { decodeFrames, encodeFrame, filterEnv } from '@coko/agent'
import { getLogger } from '@coko/logging'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'

const log = getLogger(['adapters', 'lsp'])

/** 请求超时（initialize 之外）。 */
export const LSP_REQUEST_TIMEOUT_MS = 15_000
/** initialize 的缺省超时（配置的 startupTimeout 覆盖）。 */
export const LSP_STARTUP_TIMEOUT_MS = 10_000
/** 关闭序列每一步的等待。 */
export const LSP_KILL_GRACE_MS = 2_000
/** stderr 保留的尾部（字节）。 */
export const LSP_STDERR_TAIL_BYTES = 4 * 1024

export interface LspClientOptions {
  command: string
  args?: readonly string[]
  /** 配置的 env，合并在过滤后的 Sidecar 环境之上。 */
  env?: Readonly<Record<string, string>>
  /** Sidecar 自身的环境（剔除 HOST_ENV_EXCLUSIONS 之后传给服务器）。 */
  hostEnv?: Readonly<Record<string, string | undefined>>
  /** 工作目录，也是 initialize 的 rootUri。 */
  cwd: string
  initializationOptions?: unknown
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  graceMs?: number
  /** spawn 成功后调用（登记进程），返回的函数在进程退出后调用一次。 */
  onProcess?: (process: { pid: number; pgid?: number }) => () => void
  /** 服务器发来的通知（publishDiagnostics 等）。 */
  onNotification?: (method: string, params: unknown) => void
  /** 进程退出（任何原因，含 close）。 */
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

export interface LspClient {
  readonly pid: number
  /** initialize 的结果中的 capabilities。 */
  readonly capabilities: Record<string, unknown>
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
  notify(method: string, params: unknown): void
  /** stderr 的尾部（原文；显示前由调用方脱敏）。 */
  stderrTail(): string
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  close(): Promise<void>
}

export type LspClientFactory = (options: LspClientOptions) => Promise<LspClient>

export class LspClientError extends Error {
  override readonly name = 'LspClientError'
  readonly code: 'timeout' | 'exited' | 'response-error' | 'spawn-failed' | 'aborted'
  constructor(code: LspClientError['code'], message: string) {
    super(message)
    this.code = code
  }
}

type Pending = { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 服务器发来的请求的回答：workspace/configuration 每项 null，其余 null。 */
function answerServerRequest(method: string, params: unknown): unknown {
  if (method === 'workspace/configuration') {
    const items = isRecord(params) && Array.isArray(params.items) ? params.items : []
    return items.map(() => null)
  }
  return null
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // 已退出。
    }
  }
}

const wait = (promise: Promise<unknown>, ms: number) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    void promise.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })

export const createLspClient: LspClientFactory = async (options) => {
  const requestTimeoutMs = options.requestTimeoutMs ?? LSP_REQUEST_TIMEOUT_MS
  const graceMs = options.graceMs ?? LSP_KILL_GRACE_MS
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(filterEnv(options.hostEnv ?? {}, HOST_ENV_EXCLUSIONS))) if (value !== undefined) env[name] = value
  Object.assign(env, options.env)
  const child = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (error) => reject(new LspClientError('spawn-failed', `Cannot start ${options.command}: ${error.message}`)))
  })
  const pid = child.pid!
  const release = options.onProcess?.({ pid, ...(process.platform === 'win32' ? {} : { pgid: pid }) })
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined
  const pending = new Map<number, Pending>()
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal }
      release?.()
      const error = new LspClientError('exited', `The language server exited (${signal ?? `code ${code}`})`)
      for (const entry of pending.values()) {
        entry.cleanup()
        entry.reject(error)
      }
      pending.clear()
      options.onExit?.(exitInfo)
      resolve(exitInfo)
    })
  })
  let stderr = Buffer.alloc(0)
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk])
    if (stderr.length > LSP_STDERR_TAIL_BYTES) stderr = stderr.subarray(stderr.length - LSP_STDERR_TAIL_BYTES)
  })
  // 写入已退出的进程（EPIPE）由 exit 处理，不抛出。
  child.stdin!.on('error', () => undefined)
  const write = (message: object) => {
    if (exitInfo || child.stdin!.destroyed) return
    child.stdin!.write(encodeFrame({ jsonrpc: '2.0', ...message }))
  }

  const decoder = decodeFrames(
    (raw) => {
      if (!isRecord(raw)) return
      const method = typeof raw.method === 'string' ? raw.method : undefined
      const hasId = typeof raw.id === 'number' || typeof raw.id === 'string'
      if (method && hasId) {
        write({ id: raw.id, result: answerServerRequest(method, raw.params) })
        return
      }
      if (method) {
        if (method.startsWith('window/') || method === '$/progress' || method === 'telemetry/event') log.debug('language server notification', { method })
        options.onNotification?.(method, raw.params)
        return
      }
      if (typeof raw.id !== 'number') return
      const entry = pending.get(raw.id)
      if (!entry) return
      pending.delete(raw.id)
      entry.cleanup()
      if (isRecord(raw.error)) entry.reject(new LspClientError('response-error', `${entry.method}: ${String(raw.error.message ?? 'error')}`))
      else entry.resolve(raw.result)
    },
    (error) => log.warn('language server sent an invalid frame', { error: error.message }),
  )
  child.stdout!.on('data', (chunk: Buffer) => decoder.push(chunk))

  let nextId = 1
  const request = (method: string, params: unknown, signal?: AbortSignal, timeoutMs = requestTimeoutMs) =>
    new Promise<unknown>((resolve, reject) => {
      if (exitInfo) return reject(new LspClientError('exited', 'The language server is not running'))
      if (signal?.aborted) return reject(new LspClientError('aborted', 'Operation aborted'))
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        cleanup()
        write({ method: '$/cancelRequest', params: { id } })
        reject(new LspClientError('timeout', `${method} timed out after ${timeoutMs / 1000} seconds`))
      }, timeoutMs)
      const onAbort = () => {
        pending.delete(id)
        cleanup()
        write({ method: '$/cancelRequest', params: { id } })
        reject(new LspClientError('aborted', 'Operation aborted'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(id, { method, resolve, reject, cleanup })
      write({ id, method, params })
    })

  let closing: Promise<void> | undefined
  const close = () =>
    (closing ??= (async () => {
      if (!exitInfo) {
        await request('shutdown', null, undefined, graceMs).catch(() => undefined)
        write({ method: 'exit' })
        child.stdin!.end()
      }
      if (await wait(exited, graceMs)) return
      signalGroup(child, 'SIGTERM')
      if (await wait(exited, graceMs)) return
      signalGroup(child, 'SIGKILL')
      await exited
    })())

  const rootUri = pathToFileURL(options.cwd).href
  let initialized: unknown
  try {
    initialized = await Promise.race([
      request(
        'initialize',
        {
          processId: process.pid,
          clientInfo: { name: 'coko' },
          rootUri,
          rootPath: options.cwd,
          workspaceFolders: [{ uri: rootUri, name: options.cwd.split('/').pop() || options.cwd }],
          capabilities: {
            workspace: { configuration: true, workspaceFolders: true },
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: false },
              publishDiagnostics: { relatedInformation: false, versionSupport: true },
              definition: { linkSupport: true },
              references: {},
              hover: { contentFormat: ['markdown', 'plaintext'] },
            },
          },
          ...(options.initializationOptions === undefined ? {} : { initializationOptions: options.initializationOptions }),
        },
        undefined,
        options.startupTimeoutMs ?? LSP_STARTUP_TIMEOUT_MS,
      ),
      exited.then((info) => {
        throw new LspClientError('exited', `The language server exited during startup (${info.signal ?? `code ${info.code}`})`)
      }),
    ])
  } catch (error) {
    await close()
    if (exitInfo && !(error instanceof LspClientError && error.code === 'timeout'))
      throw new LspClientError('exited', `The language server exited during startup (${exitInfo.signal ?? `code ${exitInfo.code}`})`)
    throw error
  }
  write({ method: 'initialized', params: {} })
  const capabilities = isRecord(initialized) && isRecord(initialized.capabilities) ? initialized.capabilities : {}
  return {
    pid,
    capabilities,
    request: (method, params, signal) => request(method, params, signal),
    notify: (method, params) => write({ method, params }),
    stderrTail: () => stderr.toString('utf8'),
    exited,
    close,
  }
}

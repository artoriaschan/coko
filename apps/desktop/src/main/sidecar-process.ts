import { spawn, type ChildProcess } from 'node:child_process'
import { Value } from 'typebox/value'
import { SidecarToMainMessage, type MainToSidecarMessage } from '@coko/protocol'

/** 分级退出与就绪的时限；默认值见 desktop-delivery 约定。 */
export interface SidecarTimeouts {
  /** 等待 ready 的上限。 */
  readonly readyMs: number
  /** 发出 shutdown 后等待自行退出的宽限期。 */
  readonly shutdownMs: number
  /** SIGTERM 后等待退出的时间。 */
  readonly terminateMs: number
  /** SIGKILL 后等待退出的时间；仍未退出则报错。 */
  readonly killMs: number
  /** inspect-quit 的回答时限。 */
  readonly inspectMs: number
}

export const DEFAULT_SIDECAR_TIMEOUTS: SidecarTimeouts = {
  readyMs: 30_000,
  shutdownMs: 10_000,
  terminateMs: 5_000,
  killMs: 5_000,
  inspectMs: 2_000,
}

export interface SidecarOptions {
  /** Electron 可执行文件（process.execPath），以 ELECTRON_RUN_AS_NODE=1 运行。 */
  readonly execPath: string
  readonly entry: string
  readonly args?: readonly string[]
  /** 子进程继承的环境；ELECTRON_RUN_AS_NODE 总是由这里设置。 */
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
  readonly timeouts?: Partial<SidecarTimeouts>
  /** 子进程 stdout 的去向；默认丢弃。 */
  readonly onStdout?: (chunk: string) => void
}

export interface SidecarReady {
  readonly port: number
  /** 一次性启动令牌；只交给 main 的令牌交换，不得记录或转交 renderer。 */
  readonly token: string
}

export type SidecarStartErrorCode = 'sidecar-spawn' | 'sidecar-exited' | 'sidecar-timeout' | 'sidecar-protocol' | (string & {})

/** ready 之前的失败。fatal 时 code/message 来自 sidecar；diagnostic 是 stderr 尾部，只用于诊断入口。 */
export class SidecarStartError extends Error {
  readonly code: SidecarStartErrorCode
  readonly diagnostic: string

  constructor(code: SidecarStartErrorCode, message: string, diagnostic = '') {
    super(message)
    this.name = 'SidecarStartError'
    this.code = code
    this.diagnostic = diagnostic
  }
}

export interface SidecarExitInfo {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface SidecarStopResult {
  /** graceful：shutdown 宽限期内退出；terminated：SIGTERM 后退出；killed：SIGKILL 后退出；not-running：无需停止。 */
  readonly outcome: 'graceful' | 'terminated' | 'killed' | 'not-running'
  readonly acknowledged: boolean
}

const STDERR_TAIL = 16 * 1024

/** 一个 Sidecar 子进程：spawn、就绪、控制请求与分级退出。每个实例只启动一次。 */
export class SidecarProcess {
  readonly #options: SidecarOptions
  readonly #timeouts: SidecarTimeouts
  #child: ChildProcess | undefined
  #startPromise: Promise<SidecarReady> | undefined
  #stopPromise: Promise<SidecarStopResult> | undefined
  #ready = false
  #stopping = false
  #acknowledged = false
  #stderr = ''
  #nextRequestId = 1
  readonly #pending = new Map<number, { resolve: (activeRuns: number) => void; reject: (error: Error) => void }>()
  readonly #exitListeners = new Set<(info: SidecarExitInfo) => void>()
  readonly #controlListeners = new Set<(message: SidecarToMainMessage) => void>()
  #exitInfo: SidecarExitInfo | undefined
  #resolveExited!: () => void
  /** 子进程实际退出（或从未启动成功）时完成。 */
  readonly exited: Promise<void> = new Promise((resolve) => {
    this.#resolveExited = resolve
  })

  constructor(options: SidecarOptions) {
    this.#options = options
    this.#timeouts = { ...DEFAULT_SIDECAR_TIMEOUTS, ...options.timeouts }
  }

  get pid(): number | undefined {
    return this.#child?.pid
  }

  get isReady(): boolean {
    return this.#ready && this.#exitInfo === undefined && !this.#stopping
  }

  /** ready 之后的意外退出（非 stop 引起）。 */
  onUnexpectedExit(listener: (info: SidecarExitInfo) => void): () => void {
    this.#exitListeners.add(listener)
    return () => this.#exitListeners.delete(listener)
  }

  /** ready 之后由其他模块处理的控制消息（credential.*）。 */
  onControlMessage(listener: (message: SidecarToMainMessage) => void): () => void {
    this.#controlListeners.add(listener)
    return () => this.#controlListeners.delete(listener)
  }

  /** 向就绪的 Sidecar 发送控制消息；通道断开时丢弃（由 close 统一处理）。 */
  send(message: MainToSidecarMessage): void {
    if (this.isReady) this.#send(message)
  }

  start(): Promise<SidecarReady> {
    this.#startPromise ??= this.#start()
    return this.#startPromise
  }

  #start(): Promise<SidecarReady> {
    return new Promise<SidecarReady>((resolve, reject) => {
      let settled = false
      const fail = (error: SidecarStartError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
        // 未就绪的子进程不可信，确保它退出。
        this.#terminate().catch(() => undefined)
      }
      const timer = setTimeout(() => {
        fail(new SidecarStartError('sidecar-timeout', `Sidecar did not become ready within ${this.#timeouts.readyMs} ms`, this.#stderr))
      }, this.#timeouts.readyMs)

      let child: ChildProcess
      try {
        child = spawn(this.#options.execPath, [this.#options.entry, ...(this.#options.args ?? [])], {
          cwd: this.#options.cwd,
          env: { ...(this.#options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        })
      } catch (error) {
        this.#resolveExited()
        fail(new SidecarStartError('sidecar-spawn', (error as Error).message))
        return
      }
      this.#child = child
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => this.#options.onStdout?.(chunk))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL)
      })

      child.once('error', (error) => {
        fail(new SidecarStartError('sidecar-spawn', error.message, this.#stderr))
        if (child.pid === undefined) this.#resolveExited()
      })

      child.on('message', (raw: unknown) => {
        if (!Value.Check(SidecarToMainMessage, raw)) {
          if (!this.#ready) fail(new SidecarStartError('sidecar-protocol', 'Sidecar sent an invalid control message', this.#stderr))
          else this.#terminate().catch(() => undefined)
          return
        }
        const message = raw
        switch (message.type) {
          case 'starting':
            return
          case 'ready':
            if (settled) return
            settled = true
            clearTimeout(timer)
            this.#ready = true
            resolve({ port: message.port, token: message.token })
            return
          case 'fatal':
            fail(new SidecarStartError(message.code, message.message, this.#stderr))
            return
          case 'shutdown-complete':
            this.#acknowledged = true
            return
          case 'inspect-quit.result': {
            const pending = this.#pending.get(message.requestId)
            this.#pending.delete(message.requestId)
            pending?.resolve(message.activeRuns)
            return
          }
          case 'credential.decrypt':
          case 'credential.store.result':
            if (this.#ready) for (const listener of this.#controlListeners) listener(message)
            return
        }
      })

      // close 在 stdio 关闭后触发，此时 stderr 已读完。
      child.once('close', (code, signal) => {
        const info: SidecarExitInfo = { code, signal }
        this.#exitInfo = info
        for (const pending of this.#pending.values()) pending.reject(new Error('Sidecar exited'))
        this.#pending.clear()
        if (!settled)
          fail(new SidecarStartError('sidecar-exited', `Sidecar exited before ready (code ${String(code)}, signal ${String(signal)})`, this.#stderr))
        else if (this.#ready && !this.#stopping) for (const listener of this.#exitListeners) listener(info)
        this.#resolveExited()
      })
    })
  }

  /** 询问当前活动 Run 数；未就绪、停止中或超时则拒绝。 */
  inspectQuit(): Promise<number> {
    const child = this.#child
    if (!this.isReady || child === undefined || !child.connected) return Promise.reject(new Error('Sidecar is not available'))
    const requestId = this.#nextRequestId++
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error(`Sidecar inspect-quit timed out after ${this.#timeouts.inspectMs} ms`))
      }, this.#timeouts.inspectMs)
      this.#pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.#send({ type: 'inspect-quit', requestId })
    })
  }

  /** 分级退出：shutdown → 宽限期 → SIGTERM → SIGKILL，并等待进程实际退出。可重复调用。 */
  stop(): Promise<SidecarStopResult> {
    this.#stopPromise ??= this.#stop()
    return this.#stopPromise
  }

  async #stop(): Promise<SidecarStopResult> {
    this.#stopping = true
    const child = this.#child
    if (child === undefined || this.#exitInfo !== undefined) {
      await this.exited
      return { outcome: 'not-running', acknowledged: this.#acknowledged }
    }
    this.#send({ type: 'shutdown' })
    if (await this.#exitsWithin(this.#timeouts.shutdownMs)) return { outcome: 'graceful', acknowledged: this.#acknowledged }
    const outcome = await this.#terminate()
    return { outcome, acknowledged: this.#acknowledged }
  }

  #terminatePromise: Promise<'terminated' | 'killed'> | undefined

  #terminate(): Promise<'terminated' | 'killed'> {
    this.#terminatePromise ??= (async () => {
      const child = this.#child
      if (child === undefined) return 'terminated'
      if (this.#exitInfo === undefined) child.kill('SIGTERM')
      if (await this.#exitsWithin(this.#timeouts.terminateMs)) return 'terminated'
      child.kill('SIGKILL')
      if (await this.#exitsWithin(this.#timeouts.killMs)) return 'killed'
      throw new Error('Sidecar did not exit after SIGKILL')
    })()
    return this.#terminatePromise
  }

  async #exitsWithin(ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
    })
    try {
      return await Promise.race([this.exited.then(() => true as const), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  #send(message: MainToSidecarMessage): void {
    const child = this.#child
    if (child === undefined || !child.connected) return
    // 发送失败意味着通道已断开，由 close 事件统一处理。
    child.send(message, () => undefined)
  }
}

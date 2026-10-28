import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import type { SidecarEndpoint } from './app-protocol.ts'
import { SidecarStartError, type SidecarExitInfo, type SidecarProcess } from './sidecar-process.ts'

/** 失败原因：startup 为首次启动失败（不自动重启）；crashed 为 ready 之后退出且重启用尽。 */
export type SupervisorFailure = { readonly code: string; readonly message: string }

export type SupervisorState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting' }
  | { readonly phase: 'ready'; readonly port: number }
  /** ready 之后意外退出，正在重启并重新交换 cookie；期间代理返回 503。 */
  | { readonly phase: 'restarting'; readonly attempt: number }
  | { readonly phase: 'failed'; readonly reason: 'startup' | 'crashed'; readonly error: SupervisorFailure; readonly diagnostic: string }
  | { readonly phase: 'stopped' }

export interface SupervisorOptions {
  /** 每次（重新）启动创建一个新的 SidecarProcess。 */
  readonly create: () => SidecarProcess
  /** 用启动令牌交换会话 cookie（ADR 0002）。 */
  readonly exchange: (origin: string, token: string) => Promise<string>
  /** 一次崩溃后最多连续尝试的重启次数；默认 3。 */
  readonly maxRestarts?: number
  /** 第 n 次重启前的等待；用尽后取最后一档。默认 [250, 1000, 3000]。 */
  readonly restartDelaysMs?: readonly number[]
  /** 运行超过该时长后再退出，视为新的一次故障，连续失败计数清零。默认 60 秒。 */
  readonly stableMs?: number
}

/**
 * Sidecar 的监管：启动并交换 cookie；ready 之后意外退出时重启并重新交换（ADR 0002：旧 cookie 失效，
 * 重新交换完成前不恢复转发）。连续失败达到上限后进入 failed，不再 spawn。
 */
export class SidecarSupervisor {
  readonly #options: Required<SupervisorOptions>
  #state: SupervisorState = { phase: 'idle' }
  #process: SidecarProcess | undefined
  #endpoint: SidecarEndpoint | undefined
  #readyAt = 0
  #failures = 0
  #stopped = false
  #restarting: Promise<void> | undefined
  #startPromise: Promise<SupervisorState> | undefined
  readonly #stateListeners = new Set<(state: SupervisorState) => void>()
  readonly #exitListeners = new Set<(info: SidecarExitInfo & { diagnostic: string }) => void>()
  readonly #controlListeners = new Set<(message: SidecarToMainMessage) => void>()

  constructor(options: SupervisorOptions) {
    this.#options = { maxRestarts: 3, restartDelaysMs: [250, 1000, 3000], stableMs: 60_000, ...options }
  }

  get state(): SupervisorState {
    return this.#state
  }

  /** 当前可转发的端点；重启中、失败或停止时为 undefined。 */
  get endpoint(): SidecarEndpoint | undefined {
    return this.#endpoint
  }

  get pid(): number | undefined {
    return this.#process?.pid
  }

  get isReady(): boolean {
    return this.#state.phase === 'ready' && this.#process?.isReady === true
  }

  onState(listener: (state: SupervisorState) => void): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  /** ready 之后的意外退出（每次都报告，含 stderr 尾部）。 */
  onUnexpectedExit(listener: (info: SidecarExitInfo & { diagnostic: string }) => void): () => void {
    this.#exitListeners.add(listener)
    return () => this.#exitListeners.delete(listener)
  }

  /** 当前及之后每个 sidecar 进程的控制消息（credential.*）。 */
  onControlMessage(listener: (message: SidecarToMainMessage) => void): () => void {
    this.#controlListeners.add(listener)
    return () => this.#controlListeners.delete(listener)
  }

  send(message: MainToSidecarMessage): void {
    if (this.isReady) this.#process?.send(message)
  }

  inspectQuit(): Promise<number> {
    const current = this.#process
    return this.isReady && current ? current.inspectQuit() : Promise.reject(new Error('Sidecar is not available'))
  }

  /** 首次启动：ready 且交换完成，或 failed（reason startup，不自动重启）。 */
  start(): Promise<SupervisorState> {
    this.#startPromise ??= (async () => {
      this.#set({ phase: 'starting' })
      const outcome = await this.#launch()
      if (this.#stopped) return this.#state
      if (outcome.ok) this.#set({ phase: 'ready', port: outcome.port })
      else this.#set({ phase: 'failed', reason: 'startup', error: outcome.error, diagnostic: outcome.diagnostic })
      return this.#state
    })()
    return this.#startPromise
  }

  /** 停止当前进程（分级退出）并中断进行中的重启。可重复调用。 */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#endpoint = undefined
    await this.#process?.stop().catch(() => undefined)
    await this.#restarting
    await this.#process?.stop().catch(() => undefined)
    if (this.#state.phase !== 'stopped') this.#set({ phase: 'stopped' })
  }

  #set(state: SupervisorState): void {
    this.#state = state
    for (const listener of this.#stateListeners) listener(state)
  }

  async #launch(): Promise<{ ok: true; port: number } | { ok: false; error: SupervisorFailure; diagnostic: string }> {
    const sidecar = this.#options.create()
    this.#process = sidecar
    sidecar.onControlMessage((message) => {
      for (const listener of this.#controlListeners) listener(message)
    })
    sidecar.onUnexpectedExit((info) => this.#onExit(sidecar, info))
    try {
      const ready = await sidecar.start()
      const origin = `http://127.0.0.1:${ready.port}`
      const cookie = await this.#options.exchange(origin, ready.token)
      if (this.#stopped) {
        await sidecar.stop().catch(() => undefined)
        return { ok: false, error: { code: 'sidecar-stopped', message: 'Stopped during start' }, diagnostic: '' }
      }
      this.#endpoint = { origin, cookie }
      this.#readyAt = Date.now()
      return { ok: true, port: ready.port }
    } catch (error) {
      await sidecar.stop().catch(() => undefined)
      const failure: SupervisorFailure =
        error instanceof SidecarStartError ? { code: error.code, message: error.message } : { code: 'sidecar-auth', message: (error as Error).message }
      return { ok: false, error: failure, diagnostic: error instanceof SidecarStartError ? error.diagnostic : sidecar.stderrTail }
    }
  }

  #onExit(sidecar: SidecarProcess, info: SidecarExitInfo): void {
    if (sidecar !== this.#process) return
    this.#endpoint = undefined
    for (const listener of this.#exitListeners) listener({ ...info, diagnostic: sidecar.stderrTail })
    if (this.#stopped) return
    // 稳定运行过一段时间再退出：视为新的一次故障。
    if (Date.now() - this.#readyAt >= this.#options.stableMs) this.#failures = 0
    this.#restarting = this.#restart({ code: 'sidecar-exited', message: `Sidecar exited (code ${String(info.code)}, signal ${String(info.signal)})` })
  }

  async #restart(cause: SupervisorFailure): Promise<void> {
    let last = { error: cause, diagnostic: '' }
    while (!this.#stopped && this.#failures < this.#options.maxRestarts) {
      const attempt = ++this.#failures
      this.#set({ phase: 'restarting', attempt })
      const delays = this.#options.restartDelaysMs
      const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      if (this.#stopped) return
      const outcome = await this.#launch()
      if (this.#stopped) return
      if (outcome.ok) {
        this.#set({ phase: 'ready', port: outcome.port })
        return
      }
      last = outcome
    }
    if (!this.#stopped) this.#set({ phase: 'failed', reason: 'crashed', error: last.error, diagnostic: last.diagnostic })
  }
}

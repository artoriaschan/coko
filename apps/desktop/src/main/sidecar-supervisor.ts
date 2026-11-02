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
  /** 用启动令牌交换会话 cookie（ADR 0002）。stop 时 signal 被中止，交换须随之结束。 */
  readonly exchange: (origin: string, token: string, signal?: AbortSignal) => Promise<string>
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
  /** 进行中的计划重启（reload）；期间收到的 reload 合并为它结束后的一次。 */
  #reloading: Promise<void> | undefined
  #reloadPending = false
  /** 进行中的启动（spawn → ready → 交换）；stop 先中止它的交换请求并等它结束，再停止进程。 */
  #launching: { readonly abort: AbortController; readonly done: Promise<unknown> } | undefined
  #startPromise: Promise<SupervisorState> | undefined
  readonly #stateListeners = new Set<(state: SupervisorState) => void>()
  readonly #exitListeners = new Set<(info: SidecarExitInfo & { diagnostic: string }) => void>()
  readonly #controlListeners = new Set<(message: SidecarToMainMessage) => void>()
  readonly #unavailableListeners = new Set<() => void>()

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

  /** 当前进程不再回答控制请求：ready 之后的意外退出，或计划重启（reload）停止它之前。 */
  onUnavailable(listener: () => void): () => void {
    this.#unavailableListeners.add(listener)
    return () => this.#unavailableListeners.delete(listener)
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
      if (this.#stopped) {
        // 启动途中被 stop：返回最终的 stopped，而不是过时的 starting。
        if (this.#state.phase !== 'stopped') this.#set({ phase: 'stopped' })
        return this.#state
      }
      if (outcome.ok) this.#set({ phase: 'ready', port: outcome.port })
      else this.#set({ phase: 'failed', reason: 'startup', error: outcome.error, diagnostic: outcome.diagnostic })
      return this.#state
    })()
    return this.#startPromise
  }

  /**
   * 计划重启（开发时 Sidecar 重新构建后）：分级停止当前进程，启动新进程并重新交换 cookie，状态经 restarting 回到 ready。
   * 不计入故障次数；新进程启动失败时直接进入 failed（reason crashed），不按退避重试，下一次 reload 可以从 failed 恢复。
   * 首次启动完成前调用时等它结束；首次启动失败（reason startup）或已 stop 时不做任何事。
   */
  reload(): Promise<void> {
    if (this.#reloading) {
      this.#reloadPending = true
      return this.#reloading
    }
    const run = this.#runReloads().finally(() => {
      if (this.#reloading === run) this.#reloading = undefined
    })
    this.#reloading = run
    return run
  }

  async #runReloads(): Promise<void> {
    do {
      this.#reloadPending = false
      await this.#startPromise
      await this.#restarting
      const state = this.#state
      if (this.#stopped || state.phase === 'idle' || (state.phase === 'failed' && state.reason === 'startup')) return
      const previous = this.#process
      // 先解除当前进程：它在停止途中的退出不再触发崩溃重启。
      this.#process = undefined
      this.#endpoint = undefined
      this.#set({ phase: 'restarting', attempt: 1 })
      for (const listener of this.#unavailableListeners) listener()
      await previous?.stop().catch(() => undefined)
      if (this.#stopped) return
      const outcome = await this.#launch()
      if (this.#stopped) return
      this.#failures = 0
      if (outcome.ok) this.#set({ phase: 'ready', port: outcome.port })
      else this.#set({ phase: 'failed', reason: 'crashed', error: outcome.error, diagnostic: outcome.diagnostic })
    } while (this.#reloadPending && !this.#stopped)
  }

  /** 停止当前进程（分级退出）并中断进行中的重启。可重复调用。 */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#endpoint = undefined
    // 交换请求在进行中时直接杀进程，undici 会在已关闭的 socket 上抛出无法捕获的 EINVAL。
    const launching = this.#launching
    if (launching) {
      launching.abort.abort(new Error('Sidecar supervisor stopped'))
      await launching.done.catch(() => undefined)
    }
    await this.#process?.stop().catch(() => undefined)
    await this.#restarting
    await this.#reloading
    await this.#process?.stop().catch(() => undefined)
    if (this.#state.phase !== 'stopped') this.#set({ phase: 'stopped' })
  }

  #set(state: SupervisorState): void {
    this.#state = state
    for (const listener of this.#stateListeners) listener(state)
  }

  #launch(): Promise<{ ok: true; port: number } | { ok: false; error: SupervisorFailure; diagnostic: string }> {
    const abort = new AbortController()
    const done = this.#launchWith(abort.signal)
    const launching = { abort, done }
    this.#launching = launching
    return done.finally(() => {
      if (this.#launching === launching) this.#launching = undefined
    })
  }

  async #launchWith(signal: AbortSignal): Promise<{ ok: true; port: number } | { ok: false; error: SupervisorFailure; diagnostic: string }> {
    const sidecar = this.#options.create()
    this.#process = sidecar
    sidecar.onControlMessage((message) => {
      for (const listener of this.#controlListeners) listener(message)
    })
    sidecar.onUnexpectedExit((info) => this.#onExit(sidecar, info))
    try {
      const ready = await sidecar.start()
      const origin = `http://127.0.0.1:${ready.port}`
      const cookie = await this.#options.exchange(origin, ready.token, signal)
      if (this.#stopped) {
        await sidecar.stop().catch(() => undefined)
        return { ok: false, error: { code: 'sidecar-stopped', message: 'Stopped during start' }, diagnostic: '' }
      }
      this.#endpoint = { origin, cookie }
      this.#readyAt = Date.now()
      return { ok: true, port: ready.port }
    } catch (error) {
      await sidecar.stop().catch(() => undefined)
      if (this.#stopped) return { ok: false, error: { code: 'sidecar-stopped', message: 'Stopped during start' }, diagnostic: '' }
      const failure: SupervisorFailure =
        error instanceof SidecarStartError ? { code: error.code, message: error.message } : { code: 'sidecar-auth', message: (error as Error).message }
      return { ok: false, error: failure, diagnostic: error instanceof SidecarStartError ? error.diagnostic : sidecar.stderrTail }
    }
  }

  #onExit(sidecar: SidecarProcess, info: SidecarExitInfo): void {
    if (sidecar !== this.#process) return
    this.#endpoint = undefined
    for (const listener of this.#exitListeners) listener({ ...info, diagnostic: sidecar.stderrTail })
    for (const listener of this.#unavailableListeners) listener()
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

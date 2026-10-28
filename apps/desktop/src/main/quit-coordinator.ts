export interface QuitCoordinatorOptions {
  /** 询问活动 Run 数；sidecar 未就绪时为 undefined，此时没有可中断的工作。 */
  readonly inspect: (() => Promise<number>) | undefined
  /** 展示确认框；true 表示仍要退出。询问失败或超时时 activeRuns 为 'unknown'。 */
  readonly confirm: (reason: { activeRuns: number | 'unknown' }) => Promise<boolean>
}

/** 退出前的 inspect-quit 与确认。同一时刻只有一次决定，重复请求合并。 */
export class QuitCoordinator {
  readonly #options: QuitCoordinatorOptions | (() => QuitCoordinatorOptions)
  #pending: Promise<boolean> | undefined

  constructor(options: QuitCoordinatorOptions | (() => QuitCoordinatorOptions)) {
    this.#options = options
  }

  /** @returns true 表示可以退出 */
  decide(): Promise<boolean> {
    if (this.#pending !== undefined) return this.#pending
    const pending = this.#decide().finally(() => {
      if (this.#pending === pending) this.#pending = undefined
    })
    this.#pending = pending
    return pending
  }

  async #decide(): Promise<boolean> {
    const options = typeof this.#options === 'function' ? this.#options() : this.#options
    if (options.inspect === undefined) return true
    const activeRuns = await options.inspect().catch(() => 'unknown' as const)
    if (activeRuns === 0) return true
    return options.confirm({ activeRuns })
  }
}

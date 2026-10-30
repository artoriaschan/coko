// 子进程登记与孤儿清理（ADR 0012）：启动时核对上次登记的进程并终止仍存活的，有序关闭时终止全部登记进程。
// 尚未接入：只有钩子（runtime/layers.ts 在打开存储之后、启动恢复之前调用 cleanup，在关闭存储之前调用 terminateAll）。
import type { SessionStore } from '@coko/session'

export interface ProcessRegistryOptions {
  store: Pick<SessionStore, 'processes'>
}

export class ProcessRegistry {
  readonly #options: ProcessRegistryOptions

  constructor(options: ProcessRegistryOptions) {
    this.#options = options
  }

  /** 启动清理：pid 存在且启动时间一致的进程被终止，其余行只删除；返回终止的数量。 */
  async cleanup(): Promise<number> {
    void this.#options
    return 0
  }

  /** 有序关闭：终止全部登记进程（存储关闭之前）。 */
  async terminateAll(): Promise<void> {}
}

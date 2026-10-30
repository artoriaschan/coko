/**
 * 每个 key 一把锁：同一 key 的任务按提交顺序串行，前一个失败不影响后一个；不同 key 互不等待。key 的最后一个任务结束后删除该 key，
 * Map 不随 key 增长。
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    this.#tails.set(key, tail)
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    })
    return run
  }

  /** 有任务排队或执行中的 key 数。 */
  get size(): number {
    return this.#tails.size
  }
}

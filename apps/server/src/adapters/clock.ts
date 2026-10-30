// 时钟（ADR 0015）：定时任务经 ClockPort 读取时间与设定计时器。产品为系统时钟；测试构建（COKO_TEST_CLOCK=1）为可控时钟，
// 由 POST /api/test/clock 拨快或设定，到期的计时器按到期顺序同步触发。

export interface ClockPort {
  now(): number
  /** 在 UTC 毫秒 at（不早于 now）时调用 fire；返回取消函数。已过期的立即（下一轮事件循环）触发。 */
  setTimer(at: number, fire: () => void): () => void
}

/** setTimeout 的上限（约 24.8 天）；更远的计时器分段等待。 */
const MAX_DELAY_MS = 2 ** 31 - 1

export function systemClock(now: () => number = Date.now): ClockPort {
  return {
    now,
    setTimer(at, fire) {
      let handle: ReturnType<typeof setTimeout> | undefined
      let cancelled = false
      const arm = () => {
        if (cancelled) return
        const delay = Math.max(0, at - now())
        handle = setTimeout(delay > MAX_DELAY_MS ? arm : fire, Math.min(delay, MAX_DELAY_MS))
        handle.unref?.()
      }
      arm()
      return () => {
        cancelled = true
        if (handle) clearTimeout(handle)
      }
    },
  }
}

export interface TestClock extends ClockPort {
  /** 拨快 ms 毫秒，按到期顺序触发其间到期的计时器；返回新的时刻。 */
  advance(ms: number): number
  /** 设定为某一时刻（不能早于当前，否则抛错），并触发到期的计时器。 */
  set(at: number): number
  /** 尚未触发的计时器数量。 */
  readonly pending: number
}

/** 可控时钟：起点缺省为创建时的系统时间。 */
export function createTestClock(start: number = Date.now()): TestClock {
  let current = start
  let nextId = 1
  const timers = new Map<number, { at: number; fire: () => void }>()
  const fireDue = () => {
    for (;;) {
      let due: [number, { at: number; fire: () => void }] | undefined
      for (const entry of timers) if (entry[1].at <= current && (!due || entry[1].at < due[1].at)) due = entry
      if (!due) return
      timers.delete(due[0])
      due[1].fire()
    }
  }
  const moveTo = (at: number) => {
    if (!Number.isFinite(at) || at < current) throw new Error('The test clock cannot move backwards')
    current = at
    fireDue()
    return current
  }
  return {
    now: () => current,
    setTimer(at, fire) {
      const id = nextId++
      timers.set(id, { at, fire })
      // 已到期的在下一轮事件循环触发（与系统时钟一致：不在 setTimer 调用中同步回调）。
      if (at <= current) queueMicrotask(fireDue)
      return () => void timers.delete(id)
    },
    advance: (ms) => moveTo(current + ms),
    set: (at) => moveTo(at),
    get pending() {
      return timers.size
    },
  }
}

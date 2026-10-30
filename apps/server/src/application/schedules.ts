// 定时任务（ADR 0015）（M5）的应用服务。当前为存根：装配与关闭顺序已接入 runtime/layers.ts，行为由定时任务的实现实现。
import type { ClockPort } from '../adapters/clock.ts'

/**
 * 定时器：一个 setTimer 指向最早的 next_at，另每 30 秒复查（ClockPort，测试构建为可控时钟）。存根只登记 start / stop，
 * 有序关闭时最先停止（HTTP 之后、Run 之前），之后不再投递。
 */
export class ScheduleService {
  readonly #clock: ClockPort
  #started = false

  constructor(options: { clock: ClockPort }) {
    this.#clock = options.clock
  }

  /** 开始监听（启动恢复之后）。存根没有任务可调度。 */
  start(): void {
    this.#started = true
  }

  get started(): boolean {
    return this.#started
  }

  get clock(): ClockPort {
    return this.#clock
  }

  /** 停止定时器（有序关闭的第一步）。 */
  async stop(): Promise<void> {
    this.#started = false
  }
}

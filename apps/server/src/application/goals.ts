// Goal（ADR 0011）：读写 Goal 快照条目、动作（暂停、恢复、取消、标为完成、编辑）与启动恢复。
// 尚未接入：没有 Goal；恢复是空操作。runtime/layers.ts 装配一次，之后的实现只改本文件与 goal-driver.ts、context/goal.ts、routes/goals.ts。
import type { SessionStore } from '@coko/session'
import type { JobService } from './jobs.ts'
import type { RecoverySource } from './recovery.ts'
import type { SessionService } from './sessions.ts'

export interface GoalServiceOptions {
  store: SessionStore
  jobs: JobService
}

export class GoalService {
  readonly #options: GoalServiceOptions
  #sessions: SessionService | undefined

  constructor(options: GoalServiceOptions) {
    this.#options = options
  }

  /** 装配时接上 SessionService（Goal Round 经其统一入口开始）。 */
  attach(sessions: SessionService): void {
    this.#sessions = sessions
  }

  /** 启动恢复（Session 恢复之后）：running / waiting-* 的 Goal 提交为 paused（restarted）；返回暂停的数量。 */
  async recover(_source: RecoverySource): Promise<number> {
    void this.#options
    void this.#sessions
    return 0
  }
}

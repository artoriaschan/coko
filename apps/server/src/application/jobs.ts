// 后台任务（Background Job）：启动、输出环形缓冲与日志、取消、完成通知（docs/subsystems/permissions.md 的 session-state 类含 job_kill）。
// 尚未接入：没有 Job；恢复与关闭是空操作。runtime/layers.ts 装配一次，之后的实现只改本文件与 context/jobs.ts、routes/jobs.ts。
import type { JobSnapshot } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import type { SessionHub } from './hub.ts'
import type { RecoverySource } from './recovery.ts'
import type { SessionService } from './sessions.ts'

export interface JobServiceOptions {
  store: SessionStore
  hub: SessionHub
  /** Job 日志的根目录 <dataDir>/jobs（不是读取根）。 */
  logDir: string
}

export class JobService {
  readonly #options: JobServiceOptions
  #sessions: SessionService | undefined

  constructor(options: JobServiceOptions) {
    this.#options = options
  }

  /** 装配时接上 SessionService（两者互相需要：通知经 Session 的 Run 送达）。 */
  attach(sessions: SessionService): void {
    this.#sessions = sessions
  }

  /** Session 的条目与进度推送（与 SessionService 共用；Job 的进度经它发出）。 */
  get hub(): SessionHub {
    return this.#options.hub
  }

  /** 日志根目录。 */
  get logDir(): string {
    return this.#options.logDir
  }

  /** 该 Session 的 Job 快照（启动顺序）。 */
  async list(_sessionId: string): Promise<JobSnapshot[]> {
    return []
  }

  /** 启动恢复：为没有 job_end 的 Job 提交 job_end lost；返回补记的数量。 */
  async recover(_source: RecoverySource): Promise<number> {
    return 0
  }

  /** 有序关闭：终止全部 Job（job_end killed），在关闭上下文贡献之前。 */
  async close(): Promise<void> {
    void this.#sessions
  }
}

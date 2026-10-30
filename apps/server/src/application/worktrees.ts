// Worktree（ADR 0016）（M5）的应用服务。当前为存根：装配与关闭顺序已接入 runtime/layers.ts，行为由 worktree 的实现实现。
import type { RecoverySource } from './recovery.ts'

export class WorktreeService {
  /** 启动恢复：把路径已不存在的 active worktree 标为 removed；返回标记的数量。存根不标记。 */
  async recover(_source: RecoverySource): Promise<number> {
    return 0
  }
}

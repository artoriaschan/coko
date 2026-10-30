// 子代理（ADR 0014）（M5）的应用服务。当前为存根：装配与关闭顺序已接入 runtime/layers.ts，行为由子代理的实现实现。
import type { RecoverySource } from './recovery.ts'

export class SubagentService {
  /** 启动恢复：为没有 agent_end 的子代理补记 interrupted；返回补记的数量。存根不补记。 */
  async recover(_source: RecoverySource): Promise<number> {
    return 0
  }

  async close(): Promise<void> {}
}

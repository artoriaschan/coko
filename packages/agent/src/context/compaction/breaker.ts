// 熔断（docs/subsystems/context.md#压缩）：一个 Session 连续 3 次自动（含溢出）压缩失败后停止自动压缩；运行时内存，重启或一次成功的压缩后复位。
import type { CompactionTrigger } from '../../session-entries/index.ts'

export const MAX_CONSECUTIVE_FAILURES = 3

export interface CompactionBreaker {
  /** 记一次失败，返回连续失败次数（任何触发方式；compaction_failed 的 consecutiveFailures）。 */
  failed(trigger: CompactionTrigger): number
  succeeded(): void
  readonly consecutiveFailures: number
  /** 连续自动失败达到上限：自动压缩暂停（手动 /compact 仍可用）。 */
  readonly paused: boolean
}

export function createCompactionBreaker(): CompactionBreaker {
  let consecutive = 0
  let automatic = 0
  return {
    failed(trigger) {
      consecutive++
      if (trigger !== 'manual') automatic++
      return consecutive
    },
    succeeded() {
      consecutive = 0
      automatic = 0
    },
    get consecutiveFailures() {
      return consecutive
    },
    get paused() {
      return automatic >= MAX_CONSECUTIVE_FAILURES
    },
  }
}

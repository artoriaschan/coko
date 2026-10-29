// 压缩（beforeRequest 等价钩子与 compact 动作）：票 11 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function compactionContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'compaction' }
}

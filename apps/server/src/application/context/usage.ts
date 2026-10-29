// 上下文用量与时间裁剪（transformMessages、report）：票 10 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function usageContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'usage' }
}

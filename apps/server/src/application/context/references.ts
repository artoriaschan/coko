// File Reference 展开（expandInput）：票 06 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function referencesContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'references' }
}

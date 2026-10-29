// Skills 索引（system section）、skill 工具与读取根：票 05 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function skillsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'skills' }
}

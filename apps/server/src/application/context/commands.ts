// 命令展开（expandInput）与命令目录：票 04 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function commandsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'commands' }
}

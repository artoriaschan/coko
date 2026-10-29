// 指令文件（system section、嵌套指令）：票 03 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function instructionsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'instructions' }
}

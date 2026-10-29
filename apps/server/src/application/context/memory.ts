// Memory 注入（system section）与 memory_* 工具：票 09 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function memoryContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'memory' }
}

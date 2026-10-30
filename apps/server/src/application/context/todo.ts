// Todo List 的上下文贡献：todo_write 工具与 <todo_list> 注入。尚未接入：空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function todoContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'todo' }
}

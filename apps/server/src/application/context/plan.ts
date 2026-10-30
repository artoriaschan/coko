// Plan Mode 的上下文贡献：<plan_mode> 与 <approved_plan> 注入、exit_plan_mode 工具、内置命令 /plan 的动作（进入与退出规划）。
// 尚未接入：/plan 的动作以 bad-request 拒绝，其余钩子为空（模型请求与之前相同）。
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function planContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'plan',
    actions: {
      async plan() {
        throw new AppError('bad-request', '/plan is not available yet', { reason: 'not-implemented', command: 'plan' })
      },
    },
  }
}

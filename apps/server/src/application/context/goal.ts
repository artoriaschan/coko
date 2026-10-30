// Goal 的上下文贡献：<goal> 注入、Goal 工具、请求前与工具调用前的预算检查、Run 结束后的推进与内置命令 /goal 的动作。
// 尚未接入：/goal 的动作以 bad-request 拒绝，其余钩子为空（模型请求与之前相同）。
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function goalContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'goal',
    actions: {
      goal: Object.assign(
        async () => {
          throw new AppError('bad-request', '/goal is not available yet', { reason: 'not-implemented', command: 'goal' })
        },
        // /goal pause 与 /goal cancel 在 Run 进行中也可用（控制词独占整段输入时）。
        { whileRunning: (args: string) => ['pause', 'cancel'].includes(args.trim()) },
      ),
    },
  }
}

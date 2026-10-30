// 交接的上下文贡献（docs/subsystems/handoff.md）：内置命令 /handoff <下一步目标> 的动作（目标为当前目录）、交接目标仍在创建时之后 Run 的
// 请求前等待与 Goal 预算重查，以及摘要 Run 结束后创建目标（HandoffService.runEnded）。
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

/** 没有接入 HandoffService 时（单元装配）/handoff 的错误文本。 */
export const HANDOFF_NOT_AVAILABLE_TEXT = 'Handoff is not available'

export function handoffContribution(options: ContextContributionOptions): ContextContribution {
  const handoff = options.handoff
  if (!handoff) {
    return {
      name: 'handoff',
      actions: {
        handoff: async () => {
          throw new AppError('bad-request', HANDOFF_NOT_AVAILABLE_TEXT)
        },
      },
    }
  }
  return {
    name: 'handoff',
    actions: {
      handoff: ({ sessionId, args }) => handoff.start(sessionId, { instructions: args, target: { kind: 'current' } }),
    },
    async beforeRequest(state, scope) {
      if (scope.sessionId === undefined) return undefined
      const stop = await handoff.beforeRequest(scope.sessionId, state.runId)
      return stop ? { stop } : undefined
    },
    async onRunEnd(_scope, info) {
      await handoff.runEnded(info)
    },
  }
}

// Handoff 的上下文贡献（M5）。当前只登记 /handoff 内置命令的动作占位：实现之前提交 /handoff 为 400 bad-request（不开始 Run）。
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

/** /handoff 未实现时的错误文本。 */
export const HANDOFF_NOT_AVAILABLE_TEXT = 'Handoff is not available yet'

export function handoffContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'handoff',
    actions: {
      handoff: async () => {
        throw new AppError('bad-request', HANDOFF_NOT_AVAILABLE_TEXT)
      },
    },
  }
}

// 后台任务的上下文贡献：job_output、job_list、job_kill 工具与完成通知（pendingInput）。尚未接入：空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function jobsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'jobs' }
}

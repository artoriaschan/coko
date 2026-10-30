// 压缩：内置命令 /compact 的动作开始一个 trigger compact 的 Run（参数为摘要的额外要求）；没有可摘要的较早内容时 400。
// 自动压缩、溢出压缩与熔断在运行时（@coko/agent 的 compaction 选项，由 session-runs.ts 接线），不经贡献的钩子。
import { KEEP_RECENT_TOKENS, planCompaction } from '@coko/agent'
import { getLogger } from '@coko/logging'
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

const log = getLogger(['application', 'context', 'compaction'])

export function compactionContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'compaction',
    actions: {
      async compact({ sessionId, args, session }) {
        if (!planCompaction(await session.entries(), { keepRecentTokens: KEEP_RECENT_TOKENS }))
          throw new AppError('bad-request', 'Nothing to compact: the conversation only has recent messages', { reason: 'nothing-to-compact' })
        const started = await session.start({ trigger: 'compact', instructions: args })
        log.info('manual compaction started', { sessionId, runId: started.runId, instructions: args.trim() !== '' })
        return started
      },
    },
  }
}

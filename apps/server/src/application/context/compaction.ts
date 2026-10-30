// 压缩：内置命令 /compact 的动作开始一个 trigger compact 的 Run（参数为摘要的额外要求）；没有可摘要的较早内容时 400。开始 Run 之前运行
// PreCompact Hook（trigger manual）：阻止时 400 hook-blocked、不开始 Run；stdout 并入摘要要求。
// 自动压缩、溢出压缩与熔断在运行时（@coko/agent 的 compaction 选项，由 session-runs.ts 接线），自动压缩的 PreCompact 经 hooks 贡献的 beforeCompact。
import { KEEP_RECENT_TOKENS, planCompaction } from '@coko/agent'
import { getLogger } from '@coko/logging'
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

const log = getLogger(['application', 'context', 'compaction'])

export function compactionContribution(options: ContextContributionOptions): ContextContribution {
  const hooks = options.hooks
  return {
    name: 'compaction',
    actions: {
      async compact({ sessionId, args, session, scope }) {
        if (!planCompaction(await session.entries(), { keepRecentTokens: KEEP_RECENT_TOKENS }))
          throw new AppError('bad-request', 'Nothing to compact: the conversation only has recent messages', { reason: 'nothing-to-compact' })
        let instructions = args
        if (hooks) {
          const verdict = await hooks.preCompact(scope, hooks.runState(scope), { trigger: 'manual', ...(args.trim() === '' ? {} : { instructions: args }) })
          if (verdict && 'block' in verdict) {
            log.info('manual compaction blocked by hook', { sessionId })
            throw new AppError('hook-blocked', verdict.block, { reason: verdict.block })
          }
          if (verdict && 'instructions' in verdict) instructions = args.trim() === '' ? verdict.instructions : `${args}\n\n${verdict.instructions}`
        }
        const started = await session.start({ trigger: 'compact', instructions })
        log.info('manual compaction started', { sessionId, runId: started.runId, instructions: instructions.trim() !== '' })
        return started
      },
    },
  }
}

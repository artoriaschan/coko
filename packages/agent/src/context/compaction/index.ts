// 压缩：切点与准备、摘要提示与增量更新、熔断。触发与提交在 engine/compaction-driver.ts（运行时的 compaction 选项）。
export { estimateCompactedTokens, isFailedReply, KEEP_RECENT_TOKENS, planCompaction, type CompactionPlan } from './plan.ts'
export {
  formatCompactionSummary,
  serializeConversation,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SECTIONS,
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_TOOL_RESULT_MAX_CHARS,
  summaryRequest,
} from './prompt.ts'
export { createCompactionBreaker, MAX_CONSECUTIVE_FAILURES, type CompactionBreaker } from './breaker.ts'

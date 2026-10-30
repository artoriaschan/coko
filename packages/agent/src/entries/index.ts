// @coko/agent/entries：浏览器安全的条目派生（只导入 typebox 与本目录内模块；导入守卫见 entries.test.ts）。
export {
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  compactionSummaryMessage,
  effectiveEntries,
  lastRunStatus,
  modelContext,
  rewoundRanges,
  unansweredConfirmations,
} from './derive.ts'
export type { EffectiveOptions } from './derive.ts'
export { JOB_NOTIFICATION_TAG } from './job-notification.ts'
export type { CompactionFields, ContextMessage, EntryLike, EntryRunStatus, RewoundRange, UnansweredConfirmation } from './types.ts'

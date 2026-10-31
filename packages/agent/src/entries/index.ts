// @coko/agent/entries：浏览器安全的条目派生与定时任务规则（只导入 typebox、本目录与 tasks/schedules 的纯模块；导入守卫见 entries.test.ts）。
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
export {
  AGENT_NOTIFICATION_TAG,
  HOOK_CONTEXT_TAG,
  HOST_NOTIFICATION_KINDS,
  hookContextText,
  isHostBlockText,
  isHostNotificationText,
  JOB_NOTIFICATION_TAG,
  SCHEDULED_TASK_TAG,
} from './host-input.ts'
// 定时任务的规则校验与预览（renderer 的表单与列表）：cron.ts 与 rules.ts 只用 Intl，导入守卫逐一核对它们的传递导入。
export { CronError, isValidTimeZone } from '../tasks/schedules/cron.ts'
export { parseAt, SCHEDULE_MIN_EVERY_SECONDS, ScheduleRuleError, upcomingOccurrences, validateRule } from '../tasks/schedules/rules.ts'
export type { ScheduleRuleSpec } from '../tasks/schedules/rules.ts'
export type { CompactionFields, ContextMessage, EntryLike, EntryRunStatus, RewoundRange, UnansweredConfirmation } from './types.ts'

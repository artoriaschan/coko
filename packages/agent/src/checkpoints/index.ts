// 领域 barrel：Checkpoint tracker、有效上下文与回退（ADR 0006）。
export { CHECKPOINT_TOOLS, createCheckpointTracker } from './tracker.ts'
export type { CheckpointEntry, CheckpointTracker, CheckpointTrackerOptions, SnapshotPort } from './tracker.ts'
export {
  effectiveEntries,
  effectiveMessages,
  emptyRewindReport,
  planRewind,
  restoreFiles,
  rewindTarget,
  RewindTargetError,
  rewoundRanges,
  userMessageText,
} from './rewind.ts'
export type {
  RestoreOptions,
  RewindFilePlan,
  RewindFiles,
  RewindMode,
  RewindPlan,
  RewindPlanOptions,
  RewindRecorded,
  RewindReport,
  RewindRestore,
  RewoundRange,
} from './rewind.ts'

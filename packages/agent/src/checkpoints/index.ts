// 领域 barrel：Checkpoint tracker、有效上下文与回退（ADR 0006）。
export { CHECKPOINT_TOOLS, createCheckpointTracker } from './tracker.ts'
export type { CheckpointEntry, CheckpointTracker, CheckpointTrackerOptions, SnapshotPort } from './tracker.ts'
export { effectiveMessages, emptyRewindReport, planRewind, restoreFiles, rewindTarget, RewindTargetError, userMessageText } from './rewind.ts'
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
} from './rewind.ts'

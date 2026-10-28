// 领域 barrel：Checkpoint tracker 与 planRewind（票 07、09 在此导出）。packages/agent/src/index.ts 已 re-export 本文件，后续票只改本目录。
export { CHECKPOINT_TOOLS, createCheckpointTracker } from './tracker.ts'
export type { CheckpointEntry, CheckpointTracker, CheckpointTrackerOptions, SnapshotPort } from './tracker.ts'
export {
  effectiveEntries,
  effectiveMessages,
  forkEntries,
  planRewind,
  restoreFiles,
  rewindTarget,
  RewindTargetError,
  rewoundRanges,
  userMessageText,
} from './rewind.ts'
export type {
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

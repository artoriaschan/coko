// 后台任务：Job 状态机与输出游标、ANSI 去除、通知文本，以及 job_output、job_list、job_kill（条目 schema 在 session-entries/jobs.ts）。
export { BackgroundJob, isRunning, jobListLine, jobNotificationText, NOTIFICATION_OUTPUT_MAX, statusLine } from './job.ts'
export type { JobExit, JobInfo, JobSnapshot, JobStatus, WaitOutcome } from './job.ts'
export { JOB_LABEL_MAX, JOB_RING_BYTES, jobLabel, OutputRing, stripAnsi } from './output.ts'
export type { OutputSlice } from './output.ts'
export {
  createJobKillTool,
  createJobListTool,
  createJobOutputTool,
  JOB_KILL_GRACE_MS,
  JOB_MAX_RUNNING,
  JOB_WAIT_DEFAULT_MS,
  JOB_WAIT_MAX_MS,
  jobKillParameters,
  jobListParameters,
  jobOutputParameters,
  UnknownJobError,
} from './tools.ts'
export type { BackgroundJobLauncher, BackgroundJobRequest, JobsPort } from './tools.ts'
export type { ExecProcess, ProcessExit, SpawnRequest } from '../../ports/exec.ts'
export type { BashExecutionContext } from '../../tools/builtin/bash.ts'

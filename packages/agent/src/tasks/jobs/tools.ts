// 后台任务的工具（docs/subsystems/jobs.md）：job_output（游标读取与等待）、job_list、job_kill。Job 表经 JobsPort 由宿主提供，
// 只含本 Session 的 Job；权限类由宿主注册时给出（job_output、job_list 为 context-read，job_kill 为 session-state）。
import { Type } from 'typebox'
import type { SandboxPolicy, SpawnRequest, ExecProcess } from '../../ports/exec.ts'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from '../../tools/truncate.ts'
import type { CokoTool } from '../../tools/types.ts'
import { jobListLine, statusLine, type BackgroundJob, type JobSnapshot } from './job.ts'

/** 每 Session 同时运行（running + stopping）的 Job 上限。 */
export const JOB_MAX_RUNNING = 10
export const JOB_WAIT_DEFAULT_MS = 30_000
export const JOB_WAIT_MAX_MS = 600_000
/** job_kill：SIGTERM 之后到 SIGKILL 的宽限。 */
export const JOB_KILL_GRACE_MS = 5_000

/** 本 Session 的 Job 表（宿主实现）。 */
export interface JobsPort {
  /** 本 Session 中运行中或本进程内结束的 Job；其他 Session 的 Job 与未知 id 为 undefined。 */
  get(jobId: string): BackgroundJob | undefined
  /** 本 Session 的全部 Job 快照（启动顺序，含重启前的历史）。 */
  list(): Promise<JobSnapshot[]>
  /** 进程组 SIGTERM，宽限后 SIGKILL；Job 结束（job_end 已提交）后 resolve。 */
  kill(jobId: string, reason?: string): Promise<void>
  /** 有追加指令到达时中止的信号（每次取当前的一个）。 */
  interrupt(): AbortSignal
}

/** bash run_in_background 的启动请求。spawn 由 bash 给出（同一执行端口、同一沙箱档位）。 */
export interface BackgroundJobRequest {
  toolCallId: string
  command: string
  cwd: string
  sandbox?: SandboxPolicy
  spawn: (request: SpawnRequest) => Promise<ExecProcess>
}

/** 宿主的后台任务入口（每 Session 一个）：超出上限时抛出，job_start 在返回之前提交。 */
export interface BackgroundJobLauncher {
  start(request: BackgroundJobRequest): Promise<{ jobId: string; label: string }>
}

export class UnknownJobError extends Error {
  override readonly name = 'UnknownJobError'
  constructor(jobId: string) {
    super(`No background job ${jobId} in this session`)
  }
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined })

const jobId = Type.String({ minLength: 1, description: 'Job id returned when the job was started' })

export const jobOutputParameters = Type.Object({
  job_id: jobId,
  wait: Type.Optional(Type.Boolean({ description: 'Wait until the job ends, the timeout passes or a new user message arrives' })),
  timeout_ms: Type.Optional(
    Type.Integer({ minimum: 1, description: `Maximum wait in milliseconds (default ${JOB_WAIT_DEFAULT_MS}, at most ${JOB_WAIT_MAX_MS})` }),
  ),
})

/** 只返回上次读取之后的输出（去除 ANSI，按工具输出截断规则保留末尾），结果末尾 [status: …]。读到终态之后不再收到它的完成通知。 */
export function createJobOutputTool(port: JobsPort): CokoTool<typeof jobOutputParameters, undefined> {
  return {
    name: 'job_output',
    label: 'job_output',
    description:
      'Read new output of a background job started with bash run_in_background: returns only output produced since your last read, ' +
      'followed by [status: …]. With wait: true, blocks until the job ends, timeout_ms passes or the user sends a message.',
    parameters: jobOutputParameters,
    effect: 'read',
    // 等待由 timeout_ms 控制；统一超时会提前截断长等待。
    timeoutMs: 0,
    async execute(_toolCallId, { job_id, wait, timeout_ms }, signal) {
      const job = port.get(job_id)
      if (!job) throw new UnknownJobError(job_id)
      if (wait) {
        const timeout = Math.min(timeout_ms ?? JOB_WAIT_DEFAULT_MS, JOB_WAIT_MAX_MS)
        await job.wait(timeout, { interrupt: port.interrupt(), ...(signal ? { signal } : {}) })
      }
      const ended = !job.running
      const { text: unread, dropped } = job.unread(true)
      if (ended) job.observedEnd = true
      const truncation = truncateTail(unread)
      const parts: string[] = []
      if (dropped > 0) parts.push(`[${formatSize(dropped)} of earlier output was discarded]`)
      if (truncation.content) parts.push(truncation.content)
      if (truncation.truncated)
        parts.push(
          `[Showing the last ${truncation.outputLines} of ${truncation.totalLines} lines (${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)} limit)]`,
        )
      if (!truncation.content && dropped === 0) parts.push('(no new output)')
      parts.push(statusLine(job.snapshot()))
      return text(parts.join('\n\n'))
    },
  }
}

export const jobListParameters = Type.Object({})

export function createJobListTool(port: JobsPort): CokoTool<typeof jobListParameters, undefined> {
  return {
    name: 'job_list',
    label: 'job_list',
    description: 'List the background jobs of this session: one line per job, "<id> [<kind>] <status> — <label>".',
    parameters: jobListParameters,
    effect: 'read',
    async execute() {
      const jobs = await port.list()
      return text(jobs.length === 0 ? 'No background jobs.' : jobs.map(jobListLine).join('\n'))
    },
  }
}

export const jobKillParameters = Type.Object({
  job_id: jobId,
  reason: Type.Optional(Type.String({ description: 'Why the job is stopped (recorded in the log)' })),
})

/** 停止 Job（进程组 SIGTERM，5 秒后 SIGKILL）；已结束的返回当前快照。被 job_kill 停止的 Job 不再通知。 */
export function createJobKillTool(port: JobsPort): CokoTool<typeof jobKillParameters, undefined> {
  return {
    name: 'job_kill',
    label: 'job_kill',
    description: 'Stop a running background job (SIGTERM to its process group, SIGKILL after 5 seconds). A job that already ended is left as is.',
    parameters: jobKillParameters,
    effect: 'side-effect',
    // 宽限期 5 秒加提交；统一超时足够，但等待由端口负责。
    timeoutMs: 0,
    async execute(_toolCallId, { job_id, reason }) {
      const job = port.get(job_id)
      if (!job) throw new UnknownJobError(job_id)
      if (!job.running) return text(`Background job ${job_id} already ended.\n\n${statusLine(job.snapshot())}`)
      job.observedEnd = true
      await port.kill(job_id, reason)
      return text(`Stopped background job ${job_id}: ${job.info.label}\n\n${statusLine(job.snapshot())}`)
    },
  }
}

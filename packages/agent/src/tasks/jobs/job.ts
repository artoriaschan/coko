// 后台任务的状态机与等待（docs/subsystems/jobs.md）：running → stopping → killed；running → completed / failed；lost 只由启动恢复补记。
// 输出进入环形缓冲；模型的游标只经 job_output 与送达的完成通知前移。宿主（apps/server application/jobs.ts）负责进程、日志与条目。
import type { JobEndStatus, JobKind } from '../../session-entries/jobs.ts'
import { OutputRing, stripAnsi } from './output.ts'

export type JobStatus = 'running' | 'stopping' | JobEndStatus

/** Job 的公开快照（与 @coko/protocol 的 JobSnapshot 同形）。 */
export interface JobSnapshot {
  jobId: string
  sessionId: string
  kind: JobKind
  label: string
  command: string
  status: JobStatus
  toolCallId: string
  goalId?: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  signal?: string
  outputBytes: number
  truncated: boolean
}

export interface JobInfo {
  jobId: string
  sessionId: string
  kind: JobKind
  label: string
  command: string
  toolCallId: string
  goalId?: string
  startedAt: number
}

/** 结束时的事实；status 由 finish 按是否被要求停止与退出码决定。 */
export interface JobExit {
  exitCode: number
  signal?: string
}

/** 等待的结果：Job 结束、超时，或有追加指令到达（interrupted）。 */
export type WaitOutcome = 'ended' | 'timeout' | 'interrupted'

export const isRunning = (status: JobStatus) => status === 'running' || status === 'stopping'

export class BackgroundJob {
  readonly info: JobInfo
  readonly ring = new OutputRing()
  #status: JobStatus = 'running'
  #cursor = 0
  #endedAt: number | undefined
  #exit: JobExit | undefined
  #truncated = false
  #waiters = new Set<() => void>()
  /** 模型已经用 job_output 读到终态或用 job_kill 停止了它：结束时不再通知。 */
  observedEnd = false

  constructor(info: JobInfo) {
    this.info = info
  }

  get status(): JobStatus {
    return this.#status
  }

  get running(): boolean {
    return isRunning(this.#status)
  }

  /** 日志超过上限、停止写入（输出仍进入环形缓冲）。 */
  markTruncated(): void {
    this.#truncated = true
  }

  /** 追加已脱敏的输出，返回该块的字节偏移。 */
  append(text: string): number {
    return this.ring.append(text)
  }

  /** 被要求停止（job_kill、HTTP 停止、有序关闭）：running → stopping。返回是否发生了转换。 */
  requestStop(): boolean {
    if (this.#status !== 'running') return false
    this.#status = 'stopping'
    return true
  }

  /** 进程已退出：stopping → killed；否则退出码 0 为 completed，其余 failed。唤醒全部等待者。 */
  finish(exit: JobExit, now = Date.now()): JobEndStatus {
    if (!this.running) return this.#status as JobEndStatus
    this.#status = this.#status === 'stopping' ? 'killed' : exit.exitCode === 0 ? 'completed' : 'failed'
    this.#exit = exit
    this.#endedAt = now
    for (const wake of this.#waiters) wake()
    return this.#status
  }

  /** 模型游标之后的输出（去除 ANSI）；advance 时游标移到末尾。 */
  unread(advance: boolean): { text: string; dropped: number } {
    const slice = this.ring.read(this.#cursor)
    if (advance) this.#cursor = slice.nextOffset
    return { text: stripAnsi(slice.text), dropped: slice.dropped }
  }

  /** 等到结束、超时或 interrupt 中止；signal 中止时 reject（工具被取消）。已结束时立即返回 ended。 */
  wait(timeoutMs: number, options: { interrupt?: AbortSignal; signal?: AbortSignal } = {}): Promise<WaitOutcome> {
    if (!this.running) return Promise.resolve('ended')
    const { interrupt, signal } = options
    if (signal?.aborted) return Promise.reject(new Error('Operation aborted'))
    if (interrupt?.aborted) return Promise.resolve('interrupted')
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer)
        this.#waiters.delete(onEnd)
        interrupt?.removeEventListener('abort', onInterrupt)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onEnd = () => done(() => resolve('ended'))
      const onInterrupt = () => done(() => resolve('interrupted'))
      const onAbort = () => done(() => reject(new Error('Operation aborted')))
      const timer = setTimeout(() => done(() => resolve('timeout')), timeoutMs)
      this.#waiters.add(onEnd)
      interrupt?.addEventListener('abort', onInterrupt, { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  snapshot(): JobSnapshot {
    const { info } = this
    return {
      ...info,
      status: this.#status,
      ...(this.#endedAt === undefined ? {} : { endedAt: this.#endedAt }),
      ...(this.#exit ? { exitCode: this.#exit.exitCode } : {}),
      ...(this.#exit?.signal ? { signal: this.#exit.signal } : {}),
      outputBytes: this.ring.end,
      truncated: this.#truncated,
    }
  }
}

/** 通知中内联未读输出的上限（字节）。 */
export const NOTIFICATION_OUTPUT_MAX = 2 * 1024

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 结果末尾的状态：`[status: running]`、`[status: completed]`、`[status: failed (exit code 2)]`、`[status: killed (signal SIGTERM)]`。 */
export function statusLine(job: Pick<JobSnapshot, 'status' | 'exitCode' | 'signal'>): string {
  if (job.status === 'failed' && job.exitCode !== undefined) return `[status: failed (exit code ${job.exitCode})]`
  if (job.status === 'killed' && job.signal) return `[status: killed (signal ${job.signal})]`
  return `[status: ${job.status}]`
}

/**
 * 完成通知文本。未读输出（去除 ANSI 后）不超过 2 KB 时内联在 <output> 中，否则提示用 job_output 读取。返回 inlined：调用方据此在送达后
 * 前移游标。
 */
export function jobNotificationText(job: JobSnapshot, unread: string): { text: string; inlined: boolean } {
  const code = job.exitCode === undefined ? '' : ` (exit code ${job.exitCode})`
  const summary = `Background job "${job.label}" ${job.status}${code}`
  const bytes = Buffer.byteLength(unread, 'utf8')
  const inlined = bytes > 0 && bytes <= NOTIFICATION_OUTPUT_MAX
  const parts = [
    '<job-notification>',
    `<job-id>${escapeXml(job.jobId)}</job-id>`,
    `<status>${job.status}</status>`,
    ...(job.exitCode === undefined ? [] : [`<exit-code>${job.exitCode}</exit-code>`]),
    `<summary>${escapeXml(summary)}</summary>`,
    ...(inlined ? [`<output>${escapeXml(unread)}</output>`] : []),
    ...(bytes > NOTIFICATION_OUTPUT_MAX ? [`<note>${bytes} bytes of unread output; read them with job_output.</note>`] : []),
    '</job-notification>',
  ]
  return { text: parts.join('\n'), inlined }
}

/** job_list 的一行：`<id> [<kind>] <status> — <label>`。 */
export const jobListLine = (job: Pick<JobSnapshot, 'jobId' | 'kind' | 'status' | 'label'>) => `${job.jobId} [${job.kind}] ${job.status} — ${job.label}`

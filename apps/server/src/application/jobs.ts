// 后台任务（Background Job，docs/subsystems/jobs.md）：bash run_in_background 的启动、输出（环形缓冲、日志、进度）、停止、完成通知与启动恢复。
// 进程经 bash 的执行端口启动（与前台 bash 同一沙箱与环境），以 kind job 登记（ADR 0012）；tty 的在 PTY 中运行（Job kind pty，登记 kind pty），
// 日志保存终端原始输出，job_input 写入其终端输入，其余 Job 的 stdin 关闭。输出在进入日志、环形缓冲与推送之前按值替换
// 登记的 Secret 与 Credential 明文；日志目录 <dataDir>/jobs 不是读取根。runtime/layers.ts 装配一次。
import { randomUUID } from 'node:crypto'
import { closeSync, constants as fsConstants } from 'node:fs'
import { mkdir, open, readdir, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  BackgroundJob,
  JOB_KILL_GRACE_MS,
  JOB_MAX_RUNNING,
  jobLabel,
  jobNotificationText,
  type BackgroundJobLauncher,
  type BackgroundJobRequest,
  type ExecProcess,
  type JobEndPayload,
  type JobsPort,
  type JobStartPayload,
  type RunEntry,
  type RunResult,
} from '@coko/agent'
import { createSecretStreamRedactor, getLogger, redactSecretsDeep, redactSecretValues, type SecretStreamRedactor } from '@coko/logging'
import { JOB_OUTPUT_PAGE_MAX, type JobOutputResponse, type JobSnapshot } from '@coko/protocol'
import type { SessionEntry as StoredEntry, SessionStore } from '@coko/session'
import { AppError, errorMessage } from './errors.ts'
import type { SessionHub } from './hub.ts'
import type { TrackProcess } from './processes.ts'
import type { RecoverySource } from './recovery.ts'
import type { PendingInput } from './context/types.ts'
import type { SessionService } from './sessions.ts'
import { toNewEntry } from './session-runtimes.ts'

const log = getLogger(['application', 'jobs'])

/** 每个 Job 的日志上限；超出后停止写入，末尾注明 truncated。 */
export const JOB_LOG_MAX_BYTES = 64 * 1024 * 1024
/** 每个 Job 的 job_output 进度至多每 100 ms 一帧。 */
const PROGRESS_INTERVAL_MS = 100
const TRUNCATED_MARKER = '\n[truncated: the log reached its 64 MiB limit]\n'
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface JobServiceOptions {
  store: SessionStore
  hub: SessionHub
  /** Job 日志的根目录 <dataDir>/jobs（不是读取根）。 */
  logDir: string
  /** 登记 Job 的进程（kind job，ADR 0012）；省略时不登记（单元测试）。 */
  track?: TrackProcess
  /** job_kill 的 SIGTERM → SIGKILL 宽限；默认 5 000 ms。 */
  killGraceMs?: number
}

/** 运行中或本进程内结束的 Job：状态与游标在 BackgroundJob 中，进程、日志与推送在这里。 */
interface LiveJob {
  job: BackgroundJob
  logPath: string
  process?: ExecProcess
  /** 日志写入串行化；HTTP 读取前等待它。 */
  writes: Promise<void>
  file?: FileHandle
  logBytes: number
  decoder: StringDecoder
  redactor: SecretStreamRedactor
  /** 发起该 Job 的 Run（进度的 runId）。 */
  runId: string
  /** 进度帧：待发送的文本与其起始偏移。 */
  frame?: { offset: number; text: string }
  frameTimer?: NodeJS.Timeout
  lastFrameAt: number
  /** 结束（job_end 已提交）。 */
  ended: Promise<void>
  resolveEnded: () => void
  /** job_start 没能提交：不提交 job_end、不通知。 */
  discarded: boolean
}

/** 已作为追加指令送出、等待 Run 结束确认的通知。 */
interface Sent {
  text: string
  jobIds: string[]
  inlined: string[]
}

export class JobService {
  readonly #options: JobServiceOptions
  #sessions: SessionService | undefined
  readonly #live = new Map<string, LiveJob>()
  /** 挂起的通知（Session 空闲时结束的 Job），按结束顺序。 */
  readonly #pending = new Map<string, string[]>()
  /** 已送出的通知（Session 有 Run 时），Run 结束后核对是否送达。 */
  readonly #sent = new Map<string, Sent[]>()
  readonly #interrupts = new Map<string, AbortController>()
  #closing = false
  /** 启动时所属的 Goal（application/goals.ts 装配时给出）：Session 有未终结的 Goal 时 job_start 带其 goalId。 */
  #goalOf: ((sessionId: string) => Promise<string | undefined>) | undefined

  constructor(options: JobServiceOptions) {
    this.#options = options
  }

  /** 装配时接上 SessionService：通知经其 Run 送达，bash 经其运行时拿到本 Session 的启动入口。 */
  attach(sessions: SessionService): void {
    this.#sessions = sessions
    sessions.runs.useJobs({ launcher: (sessionId) => this.launcher(sessionId), steered: (sessionId) => this.#interrupt(sessionId) })
  }

  /** GoalService 装配时调用：之后启动的 Job 记下所属的 Goal（取消 Goal 时只终结它们）。 */
  useGoals(goalOf: (sessionId: string) => Promise<string | undefined>): void {
    this.#goalOf = goalOf
  }

  /** Session 的条目与进度推送（与 SessionService 共用；Job 的进度经它发出）。 */
  get hub(): SessionHub {
    return this.#options.hub
  }

  /** 日志根目录。 */
  get logDir(): string {
    return this.#options.logDir
  }

  // ---- 模型侧：启动入口与 Job 表 ----

  /** bash run_in_background 的入口（每 Session 一个）。 */
  launcher(sessionId: string): BackgroundJobLauncher {
    return { start: (request) => this.#start(sessionId, request) }
  }

  /** job_output、job_list、job_kill 看到的本 Session 的 Job 表。 */
  port(sessionId: string): JobsPort {
    return {
      get: (jobId) => {
        const live = this.#live.get(jobId)
        return live && live.job.info.sessionId === sessionId && !live.discarded ? live.job : undefined
      },
      list: () => this.list(sessionId),
      kill: async (jobId, reason) => {
        const live = this.#live.get(jobId)
        if (live && live.job.info.sessionId === sessionId) await this.#kill(live, 'model', reason)
      },
      interrupt: () => this.#interruptSignal(sessionId),
      input: (jobId, data) => this.#input(sessionId, jobId, data),
    }
  }

  // ---- 协议侧 ----

  /** 该 Session 的 Job 快照（启动顺序）：条目中的 Job，运行中与本进程内结束的以内存为准。 */
  async list(sessionId: string): Promise<JobSnapshot[]> {
    const { store } = this.#options
    if (!(await store.sessions.getSession(sessionId))) throw new AppError('not-found', `Session ${sessionId} not found`)
    const snapshots = new Map<string, JobSnapshot>()
    for (const entry of await store.sessions.listEntries(sessionId)) {
      if (entry.kind === 'job_start') {
        const start = entry.payload as unknown as JobStartPayload
        snapshots.set(start.jobId, {
          jobId: start.jobId,
          sessionId,
          kind: start.kind,
          label: start.label,
          command: start.command,
          status: 'running',
          toolCallId: start.toolCallId,
          ...(start.goalId ? { goalId: start.goalId } : {}),
          startedAt: entry.createdAt,
          outputBytes: 0,
          truncated: false,
        })
      } else if (entry.kind === 'job_end') {
        const end = entry.payload as unknown as JobEndPayload
        const snapshot = snapshots.get(end.jobId)
        if (!snapshot) continue
        snapshots.set(end.jobId, {
          ...snapshot,
          status: end.status,
          endedAt: entry.createdAt,
          ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
          ...(end.signal ? { signal: end.signal } : {}),
          outputBytes: end.outputBytes,
          truncated: end.truncated,
        })
      }
    }
    for (const jobId of snapshots.keys()) {
      const live = this.#live.get(jobId)
      if (live) snapshots.set(jobId, live.job.snapshot())
    }
    return [...snapshots.values()]
  }

  /** 读日志（不影响模型的 job_output 游标）：从 offset 起至多 limit 字节，不切开多字节字符。 */
  async output(jobId: string, offset: number, limit = JOB_OUTPUT_PAGE_MAX): Promise<JobOutputResponse> {
    if (!JOB_ID.test(jobId)) throw new AppError('not-found', `Job ${jobId} not found`)
    const live = this.#live.get(jobId)
    const path = live && !live.discarded ? live.logPath : await this.#findLog(jobId)
    if (!path) throw new AppError('not-found', `Job ${jobId} not found`)
    const ended = !live || !live.job.running
    if (live) await live.writes
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      // 日志还没有写入（或已不存在）：空。
    }
    const start = Math.min(Math.max(0, offset), size)
    const length = Math.min(Math.max(1, Math.min(limit, JOB_OUTPUT_PAGE_MAX)), size - start)
    let bytes = Buffer.alloc(0)
    if (length > 0) {
      const file = await open(path, 'r')
      try {
        bytes = Buffer.alloc(length)
        const { bytesRead } = await file.read(bytes, 0, length, start)
        bytes = bytes.subarray(0, bytesRead)
      } finally {
        await file.close()
      }
      // 不在多字节字符中间结束（文件末尾除外）。
      if (start + bytes.length < size) bytes = bytes.subarray(0, completeUtf8(bytes))
    }
    const nextOffset = start + bytes.length
    return { offset: start, chunk: bytes.toString('utf8'), nextOffset, done: ended && nextOffset >= size }
  }

  /** 用户停止（HTTP）：Job 结束后返回；已结束 job-not-running，未知 not-found。模型没有停止它，结束后照常通知。 */
  async kill(jobId: string): Promise<void> {
    const live = this.#live.get(jobId)
    if (live && !live.discarded) {
      if (!live.job.running) throw new AppError('job-not-running', `Job ${jobId} is not running`)
      await this.#kill(live, 'user')
      return
    }
    if (JOB_ID.test(jobId) && (await this.#findLog(jobId))) throw new AppError('job-not-running', `Job ${jobId} is not running`)
    throw new AppError('not-found', `Job ${jobId} not found`)
  }

  /** 终止该 Session 运行中的 Job（给出 goalId 时只终止属于该 Goal 的，取消 Goal 用）；返回终止的数量。 */
  async killSession(sessionId: string, goalId?: string): Promise<number> {
    const targets = [...this.#live.values()].filter(
      (l) => l.job.info.sessionId === sessionId && l.job.running && !l.discarded && (goalId === undefined || l.job.info.goalId === goalId),
    )
    await Promise.all(targets.map((l) => this.#kill(l, 'system')))
    return targets.length
  }

  // ---- 上下文贡献（context/jobs.ts） ----

  /** Session 空闲时结束的 Job 的通知：合并到下一个 Run 的 user message 开头，前置 job_notification。 */
  pendingInput(sessionId: string): PendingInput | undefined {
    const ids = (this.#pending.get(sessionId) ?? []).filter((id) => this.#live.has(id))
    if (ids.length === 0) return undefined
    const notes = ids.map((id) => this.#note(this.#live.get(id)!))
    return {
      content: notes.map((n) => ({ type: 'text' as const, text: n.text + '\n\n' })),
      before: [{ kind: 'job_notification', payload: { jobIds: ids } }],
      delivered: () => {
        const left = (this.#pending.get(sessionId) ?? []).filter((id) => !ids.includes(id))
        if (left.length > 0) this.#pending.set(sessionId, left)
        else this.#pending.delete(sessionId)
        for (const n of notes) if (n.inlined) this.#live.get(n.jobId)?.job.unread(true)
      },
    }
  }

  /** Run 结束：作为追加指令送出、却没有送达的通知挂起到下一个 Run。 */
  runEnded(sessionId: string, result: RunResult): void {
    const sent = this.#sent.get(sessionId)
    if (!sent) return
    this.#sent.delete(sessionId)
    const undelivered = new Set(result.undeliveredSteering ?? [])
    for (const note of sent) {
      if (undelivered.has(note.text)) {
        this.#pending.set(sessionId, [...(this.#pending.get(sessionId) ?? []), ...note.jobIds])
        log.info('job notification deferred', { sessionId, jobIds: note.jobIds })
      } else for (const id of note.inlined) this.#live.get(id)?.job.unread(true)
    }
  }

  // ---- 启动恢复与关闭 ----

  /**
   * 启动恢复：为没有 job_end 的 Job 提交 job_end lost（进程已由孤儿清理终止）；返回补记的数量。只读有日志目录的 Session 的条目
   * （#start 在提交 job_start 之前建立目录），不扫描没有启动过 Job 的 Session。
   */
  async recover(_source: RecoverySource): Promise<number> {
    const { store, logDir } = this.#options
    let count = 0
    const dirs = await readdir(logDir).catch(() => [] as string[])
    for (const sessionId of dirs) {
      const session = await store.sessions.getSession(sessionId)
      if (!session) continue
      const entries = await store.sessions.listEntries(session.id)
      const ended = new Set(entries.filter((e) => e.kind === 'job_end').map((e) => (e.payload as unknown as JobEndPayload).jobId))
      for (const entry of entries) {
        if (entry.kind !== 'job_start') continue
        const start = entry.payload as unknown as JobStartPayload
        if (ended.has(start.jobId)) continue
        const outputBytes = await stat(start.logPath).then(
          (s) => s.size,
          () => 0,
        )
        await this.#commit(session.id, {
          kind: 'job_end',
          payload: { jobId: start.jobId, status: 'lost', outputBytes, truncated: outputBytes > JOB_LOG_MAX_BYTES },
        })
        log.warn('job marked lost', { sessionId: session.id, jobId: start.jobId })
        count++
      }
    }
    return count
  }

  /** 有序关闭：终止全部 Job（job_end killed），在关闭上下文贡献之前；之后的启动被拒绝。 */
  async close(): Promise<void> {
    this.#closing = true
    const running = [...this.#live.values()].filter((l) => l.job.running && !l.discarded)
    await Promise.all(running.map((l) => this.#kill(l, 'system')))
    await Promise.all([...this.#live.values()].map((l) => l.writes))
  }

  // ---- 内部 ----

  async #start(sessionId: string, request: BackgroundJobRequest): Promise<{ jobId: string; label: string }> {
    if (this.#closing) throw new Error('The sidecar is shutting down; background jobs cannot start')
    const running = [...this.#live.values()].filter((l) => l.job.info.sessionId === sessionId && l.job.running && !l.discarded).length
    if (running >= JOB_MAX_RUNNING)
      throw new Error(`At most ${JOB_MAX_RUNNING} background jobs can run at once in a session; stop one with job_kill or wait for one to finish`)
    const jobId = 'job_' + randomUUID().replaceAll('-', '').slice(0, 12)
    const kind = request.tty ? 'pty' : 'bash'
    // 命令文本可能含模型写入的登记值：label、快照与条目都用替换后的文本。
    const command = redactSecretValues(request.command)
    const label = jobLabel(command)
    const dir = join(this.#options.logDir, sessionId)
    const logPath = join(dir, jobId + '.log')
    const goalId = await this.#goalOf?.(sessionId)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = await open(logPath, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_EXCL, 0o600)
    let resolveEnded!: () => void
    const ended = new Promise<void>((resolve) => (resolveEnded = resolve))
    const live: LiveJob = {
      job: new BackgroundJob(
        {
          jobId,
          sessionId,
          kind,
          label,
          command,
          toolCallId: request.toolCallId,
          ...(goalId ? { goalId } : {}),
          startedAt: Date.now(),
        },
        request.sandbox ? { sandbox: request.sandbox.mode } : {},
      ),
      logPath,
      writes: Promise.resolve(),
      file,
      logBytes: 0,
      decoder: new StringDecoder('utf8'),
      redactor: createSecretStreamRedactor(),
      runId: this.#sessions?.runs.activeRunId(sessionId) ?? jobId,
      lastFrameAt: 0,
      ended,
      resolveEnded,
      discarded: false,
    }
    this.#live.set(jobId, live)
    let release: (() => void) | undefined
    try {
      live.process = await request.spawn({
        command: request.command,
        cwd: request.cwd,
        ...(request.sandbox ? { sandbox: request.sandbox } : {}),
        ...(request.tty ? { tty: true } : {}),
        onData: (chunk) => this.#emit(live, live.redactor.push(live.decoder.write(chunk))),
        onSpawn: ({ pid, pgid }) => {
          release = this.#options.track?.({ pid, pgid, kind: kind === 'pty' ? 'pty' : 'job', sessionId, jobId, command: request.command })
        },
        onExit: () => release?.(),
      })
    } catch (error) {
      this.#live.delete(jobId)
      closeSync(file.fd)
      throw error
    }
    try {
      await this.#commit(sessionId, {
        kind: 'job_start',
        payload: { jobId, kind, label, command, toolCallId: request.toolCallId, ...(goalId ? { goalId } : {}), logPath },
      })
    } catch (error) {
      live.discarded = true
      live.process.kill('SIGKILL')
      throw error
    }
    log.info('job started', { sessionId, jobId, kind, pid: live.process.pid })
    this.#publishUpdate(live)
    void live.process.exited.then((exit) => this.#finish(live, exit))
    return { jobId, label }
  }

  /** 已脱敏的输出：环形缓冲、日志（上限内）与进度帧。 */
  #emit(live: LiveJob, text: string): void {
    if (text === '') return
    const offset = live.job.append(text)
    const bytes = Buffer.from(text, 'utf8')
    if (live.file && live.logBytes < JOB_LOG_MAX_BYTES) {
      const room = JOB_LOG_MAX_BYTES - live.logBytes
      const slice = bytes.length <= room ? bytes : bytes.subarray(0, room)
      live.logBytes += slice.length
      if (slice.length < bytes.length) live.job.markTruncated()
      this.#write(live, slice)
    } else if (live.logBytes >= JOB_LOG_MAX_BYTES) live.job.markTruncated()
    if (live.frame) live.frame.text += text
    else live.frame = { offset, text }
    const wait = PROGRESS_INTERVAL_MS - (Date.now() - live.lastFrameAt)
    if (wait <= 0) this.#flushFrame(live)
    else live.frameTimer ??= setTimeout(() => this.#flushFrame(live), wait)
  }

  #write(live: LiveJob, data: Buffer | string): void {
    const file = live.file
    if (!file) return
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    live.writes = live.writes.then(
      () => file.write(bytes).then(() => undefined),
      () => undefined,
    )
    live.writes.catch((error: unknown) => log.warn('job log write failed', { jobId: live.job.info.jobId, error: errorMessage(error) }))
  }

  #flushFrame(live: LiveJob): void {
    if (live.frameTimer) clearTimeout(live.frameTimer)
    live.frameTimer = undefined
    const frame = live.frame
    if (!frame || frame.text === '') return
    live.frame = undefined
    live.lastFrameAt = Date.now()
    const { sessionId, jobId } = live.job.info
    this.#options.hub.publishProgress(sessionId, live.runId, { type: 'job_output', jobId, offset: frame.offset, chunk: frame.text })
  }

  #publishUpdate(live: LiveJob): void {
    const snapshot = live.job.snapshot()
    this.#options.hub.publishProgress(snapshot.sessionId, live.runId, { type: 'job_update', job: redactSecretsDeep(snapshot) })
  }

  async #finish(live: LiveJob, exit: { exitCode: number; signal?: string }): Promise<void> {
    const { job } = live
    const { sessionId, jobId } = job.info
    try {
      this.#emit(live, live.redactor.push(live.decoder.end()) + live.redactor.flush())
      this.#flushFrame(live)
      const status = job.finish(exit)
      if (job.snapshot().truncated) this.#write(live, TRUNCATED_MARKER)
      const file = live.file
      live.file = undefined
      await live.writes
      await file?.close().catch(() => undefined)
      if (live.discarded) return
      const snapshot = job.snapshot()
      await this.#commit(sessionId, {
        kind: 'job_end',
        payload: {
          jobId,
          status,
          exitCode: exit.exitCode,
          ...(exit.signal ? { signal: exit.signal } : {}),
          outputBytes: snapshot.outputBytes,
          truncated: snapshot.truncated,
        },
      })
      log.info('job ended', { sessionId, jobId, status, exitCode: exit.exitCode })
      this.#publishUpdate(live)
      if (!job.observedEnd && !this.#closing) this.#notify(live)
    } catch (error) {
      log.error('job end failed', { sessionId, jobId, error: errorMessage(error) })
    } finally {
      live.resolveEnded()
    }
  }

  /** 完成通知：Session 有 Run 时作为追加指令送达（前置 job_notification），否则挂起到下一个 Run。 */
  #notify(live: LiveJob): void {
    const { sessionId, jobId } = live.job.info
    const note = this.#note(live)
    const delivered = this.#sessions?.runs.deliver(sessionId, {
      text: note.text,
      content: [{ type: 'text', text: note.text }],
      before: [{ kind: 'job_notification', payload: { jobIds: [jobId] } }],
    })
    if (delivered) {
      this.#sent.set(sessionId, [...(this.#sent.get(sessionId) ?? []), { text: note.text, jobIds: [jobId], inlined: note.inlined ? [jobId] : [] }])
      log.info('job notification sent', { sessionId, jobId })
    } else {
      this.#pending.set(sessionId, [...(this.#pending.get(sessionId) ?? []), jobId])
      log.info('job notification pending', { sessionId, jobId })
    }
  }

  #note(live: LiveJob): { jobId: string; text: string; inlined: boolean } {
    const { text, inlined } = jobNotificationText(live.job.snapshot(), live.job.unread(false).text)
    // 通知作为 user message 入库（不经第二道替换）：文本在这里再替换一次。
    return { jobId: live.job.info.jobId, text: redactSecretValues(text), inlined }
  }

  /** reason：job_kill 给出的原因（模型写的文本，按值替换登记明文后记入日志）。 */
  async #kill(live: LiveJob, by: 'model' | 'user' | 'system', reason?: string): Promise<void> {
    if (!live.job.running || !live.process) return live.ended
    if (live.job.requestStop()) {
      log.info('job stop requested', {
        sessionId: live.job.info.sessionId,
        jobId: live.job.info.jobId,
        by,
        ...(reason === undefined ? {} : { reason: redactSecretValues(reason) }),
      })
      this.#publishUpdate(live)
      live.process.kill('SIGTERM')
      const timer = setTimeout(() => live.process?.kill('SIGKILL'), this.#options.killGraceMs ?? JOB_KILL_GRACE_MS)
      void live.ended.finally(() => clearTimeout(timer))
    }
    await live.ended
  }

  /** job_input：写入本 Session running 的 pty Job 的终端输入。日志只记字节数，不记文本。 */
  #input(sessionId: string, jobId: string, data: string): void {
    const live = this.#live.get(jobId)
    if (!live || live.discarded || live.job.info.sessionId !== sessionId) throw new Error(`No background job ${jobId} in this session`)
    if (live.job.status !== 'running' || !live.process?.write) throw new Error(`Background job ${jobId} does not accept input`)
    live.process.write(data)
    log.info('job input sent', { sessionId, jobId, bytes: Buffer.byteLength(data, 'utf8') })
  }

  #interruptSignal(sessionId: string): AbortSignal {
    let controller = this.#interrupts.get(sessionId)
    if (!controller) this.#interrupts.set(sessionId, (controller = new AbortController()))
    return controller.signal
  }

  /** 有追加指令到达：唤醒本 Session 中等待的 job_output。 */
  #interrupt(sessionId: string): void {
    this.#interrupts.get(sessionId)?.abort()
    this.#interrupts.delete(sessionId)
  }

  async #commit(sessionId: string, entry: RunEntry): Promise<StoredEntry> {
    const [committed] = await this.#options.store.sessions.appendEntries(sessionId, [toNewEntry(entry)])
    this.#options.hub.publishEntry(committed!)
    return committed!
  }

  /** 历史 Job 的日志路径：<logDir>/<sessionId>/<jobId>.log。 */
  async #findLog(jobId: string): Promise<string | undefined> {
    const sessions = await readdir(this.#options.logDir).catch(() => [] as string[])
    for (const session of sessions) {
      const path = join(this.#options.logDir, session, jobId + '.log')
      if (
        await stat(path).then(
          (s) => s.isFile(),
          () => false,
        )
      )
        return path
    }
    return undefined
  }
}

/** bytes 中完整 UTF-8 字符的长度（去掉末尾不完整的多字节序列）。 */
function completeUtf8(bytes: Buffer): number {
  let end = bytes.length
  let back = 0
  while (back < 4 && end - back - 1 >= 0 && ((bytes[end - back - 1] ?? 0) & 0xc0) === 0x80) back++
  const leadIndex = end - back - 1
  if (leadIndex < 0) return end
  const lead = bytes[leadIndex] ?? 0
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  return need > back + 1 ? leadIndex : end
}

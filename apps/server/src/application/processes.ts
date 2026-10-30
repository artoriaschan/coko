// 子进程登记与孤儿清理（ADR 0012；docs/subsystems/execution.md）。Sidecar 启动的长寿命子进程（前台 bash 的进程组、stdio MCP Server，
// 之后还有后台 Job 与 PTY）在 spawn 成功后登记到 host_processes，退出后删除。启动时（打开存储之后、启动恢复之前）逐行核对：pid 存在且
// lstart 与登记一致 → 上次遗留的孤儿，有进程组时向组、否则向 pid 发 SIGTERM，宽限 2 秒后 SIGKILL；否则（已退出或 pid 被复用）只删行。
// 有序关闭在关闭存储之前以同样的方式终止全部登记进程。
import { randomUUID } from 'node:crypto'
import type { ExecPort, ExecRequest } from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import type { HostProcess, HostProcessKind, SessionStore } from '@coko/session'
import { hostProcessTable, type HostProcessTable } from '../adapters/processes.ts'

export const KILL_GRACE_MS = 2_000
const POLL_MS = 25

const log = getLogger(['runtime', 'processes'])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 要登记的进程：spawn 报告的 pid（与 detached 时的进程组），以及类别、所属 Session / Job 与命令。 */
export interface TrackedProcess {
  pid: number
  pgid?: number | undefined
  kind: HostProcessKind
  sessionId?: string | undefined
  jobId?: string | undefined
  /** bash 的命令文本或 MCP Server 的可执行文件；脱敏后存库，不写日志。 */
  command: string
}

/** 登记一个进程，返回进程退出后调用的释放函数（删除登记；可重复调用）。 */
export type TrackProcess = (process: TrackedProcess) => () => void

export interface ProcessRegistryOptions {
  store: Pick<SessionStore, 'processes'>
  /** 默认读真实进程表（ps）并发真实信号。 */
  table?: HostProcessTable
  /** SIGTERM 到 SIGKILL 的宽限；默认 2 000 ms。 */
  killGraceMs?: number
}

type Target = { pid: number; pgid?: number | undefined }

export class ProcessRegistry {
  readonly #store: Pick<SessionStore, 'processes'>
  readonly #table: HostProcessTable
  readonly #graceMs: number
  readonly #pending = new Set<Promise<unknown>>()
  #closing = false

  constructor(options: ProcessRegistryOptions) {
    this.#store = options.store
    this.#table = options.table ?? hostProcessTable
    this.#graceMs = options.killGraceMs ?? KILL_GRACE_MS
  }

  /**
   * 登记：读 lstart 后写入一行（进程已退出时不写）。登记与删除都是后台写入，不阻塞调用方；释放早于登记完成时，在登记之后删除。
   * 有序关闭开始后启动的进程不再登记，立即 SIGKILL（之后没有人会终止它）。
   */
  track: TrackProcess = (process) => {
    const target: Target = { pid: process.pid, pgid: process.pgid }
    if (this.#closing) {
      this.#table.signal(target, 'SIGKILL')
      log.warn('process started during shutdown killed', { pid: process.pid, kind: process.kind })
      return () => undefined
    }
    const id = randomUUID()
    const registered = this.#background(async () => {
      const identity = await this.#table.inspect(process.pid)
      if (!identity) return false
      await this.#store.processes.register({
        id,
        pid: process.pid,
        pgid: process.pgid ?? null,
        startedAt: identity.startedAt,
        kind: process.kind,
        sessionId: process.sessionId ?? null,
        jobId: process.jobId ?? null,
        // 命令文本可能含模型回显的登记值或凭据：入库前按值与凭据形态脱敏（ADR 0004、0007）。
        command: redactText(process.command),
      })
      return true
    }, 'register')
    let released = false
    return () => {
      if (released) return
      released = true
      void this.#background(async () => {
        if (await registered) await this.#store.processes.remove(id)
      }, 'remove')
    }
  }

  /** 让经该端口启动的每个命令都登记为 `kind`（请求自带的 onSpawn / onExit 照常调用）。 */
  trackExec(port: ExecPort, context: Omit<TrackedProcess, 'pid' | 'pgid' | 'command'>): ExecPort {
    return {
      exec: (request: ExecRequest) => {
        let release: (() => void) | undefined
        return port.exec({
          ...request,
          onSpawn: (spawned) => {
            release = this.track({ ...context, ...spawned, command: request.command })
            request.onSpawn?.(spawned)
          },
          onExit: () => {
            release?.()
            request.onExit?.()
          },
        })
      },
    }
  }

  /** 等待已发起的登记与删除写完。 */
  async flush(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending)
  }

  /** 启动清理：pid 存在且启动时间一致的进程被终止，其余行只删除；返回终止的数量。 */
  async cleanup(): Promise<number> {
    const live = await this.#verify((row, reason) => log.info('stale process registration removed', { pid: row.pid, kind: row.kind, reason }))
    await this.#terminate(live)
    for (const { row } of live) log.warn('orphan process terminated', { pid: row.pid, kind: row.kind, ...(row.sessionId ? { sessionId: row.sessionId } : {}) })
    return live.length
  }

  /** 有序关闭（存储关闭之前）：之后启动的进程不再登记；终止全部仍在运行的登记进程并清空登记表。 */
  async terminateAll(): Promise<void> {
    this.#closing = true
    await this.flush()
    const live = await this.#verify(() => undefined)
    await this.#terminate(live)
    for (const { row } of live) log.info('registered process terminated at shutdown', { pid: row.pid, kind: row.kind })
    await this.flush()
  }

  #background<T>(work: () => Promise<T>, operation: string): Promise<T | false> {
    const promise = work().catch((error: unknown) => {
      log.warn('process registration failed', { operation, error: message(error) })
      return false as const
    })
    this.#pending.add(promise)
    void promise.finally(() => this.#pending.delete(promise))
    return promise
  }

  /** 逐行核对身份：一致的返回（带信号目标），其余删除。进程组只在 ps 报告的当前组仍是登记的组时使用。 */
  async #verify(onStale: (row: HostProcess, reason: 'not-running' | 'pid-reused') => void): Promise<{ row: HostProcess; target: Target }[]> {
    const live: { row: HostProcess; target: Target }[] = []
    for (const row of await this.#store.processes.list()) {
      const identity = await this.#table.inspect(row.pid)
      if (identity && identity.startedAt === row.startedAt) {
        live.push({ row, target: { pid: row.pid, pgid: row.pgid !== null && identity.pgid === row.pgid ? row.pgid : undefined } })
        continue
      }
      await this.#store.processes.remove(row.id)
      onStale(row, identity ? 'pid-reused' : 'not-running')
    }
    return live
  }

  /** SIGTERM，宽限期内轮询，仍存在的 SIGKILL；之后删除这些行。 */
  async #terminate(live: readonly { row: HostProcess; target: Target }[]): Promise<void> {
    if (live.length === 0) return
    for (const { target } of live) this.#table.signal(target, 'SIGTERM')
    const deadline = Date.now() + this.#graceMs
    while (live.some(({ target }) => this.#table.alive(target)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    for (const { target } of live) if (this.#table.alive(target)) this.#table.signal(target, 'SIGKILL')
    for (const { row } of live) await this.#store.processes.remove(row.id)
  }
}

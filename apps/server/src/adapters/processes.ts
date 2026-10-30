// 宿主进程表的读取与信号（ADR 0012；docs/subsystems/execution.md）：`ps -o lstart=,pgid= -p <pid>` 读进程启动时间与进程组，
// 按进程组（kill(-pgid)）或单个 pid 发信号。ps 以固定的 LC_ALL=C、TZ=UTC 运行，同一进程两次读到的 lstart 原文相同，
// 与时区、语言设置无关。只用于登记过的 pid，不按名字或命令行搜索进程。
import { execFile } from 'node:child_process'

/** ps 读到的进程身份：`startedAt` 为 lstart 原文（秒级），`pgid` 为当前进程组。 */
export interface ProcessIdentity {
  startedAt: string
  pgid: number
}

/** 信号的目标：给出 pgid 时为该进程组，否则为单个 pid。 */
export interface ProcessTarget {
  pid: number
  pgid?: number | undefined
}

/** 宿主进程表的端口；ProcessRegistry 经它读取与发信号，测试可以替换。 */
export interface HostProcessTable {
  /** 进程不存在时 undefined。 */
  inspect(pid: number): Promise<ProcessIdentity | undefined>
  /** 向进程组（给出 pgid）或单个 pid 发信号；目标已不存在时不报错。 */
  signal(target: ProcessTarget, signal: NodeJS.Signals): void
  /** 目标（进程组或 pid）中是否仍有进程；没有权限发信号的也算存在。 */
  alive(target: ProcessTarget): boolean
}

const PS_ENV = { PATH: '/bin:/usr/bin', LC_ALL: 'C', TZ: 'UTC' }
const PS_TIMEOUT_MS = 5_000

/** `ps -o lstart=,pgid=` 的一行：lstart 有五个字段（Thu Oct 30 06:22:09 2026），最后一个字段是 pgid。 */
export function parsePsLine(stdout: string): ProcessIdentity | undefined {
  const line = stdout.trim().split('\n')[0]?.trim()
  if (!line) return undefined
  const fields = line.split(/\s+/)
  const pgid = Number(fields.pop())
  if (!Number.isSafeInteger(pgid) || pgid <= 0 || fields.length === 0) return undefined
  return { startedAt: fields.join(' '), pgid }
}

export function inspectProcess(pid: number): Promise<ProcessIdentity | undefined> {
  return new Promise((resolve) => {
    // ps 对不存在的 pid 以 1 退出且没有输出。
    execFile('ps', ['-o', 'lstart=,pgid=', '-p', String(pid)], { env: PS_ENV, timeout: PS_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? undefined : parsePsLine(stdout))
    })
  })
}

const targetOf = ({ pid, pgid }: ProcessTarget) => (pgid === undefined ? pid : -pgid)

/** 向目标发信号；返回是否送达（目标已不存在时 false，不抛错）。 */
export function signalTarget(target: ProcessTarget, signal: NodeJS.Signals): boolean {
  try {
    process.kill(targetOf(target), signal)
    return true
  } catch {
    return false
  }
}

export function signalProcess(target: ProcessTarget, signal: NodeJS.Signals): void {
  signalTarget(target, signal)
}

export function processAlive(target: ProcessTarget): boolean {
  try {
    process.kill(targetOf(target), 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const hostProcessTable: HostProcessTable = { inspect: inspectProcess, signal: signalProcess, alive: processAlive }

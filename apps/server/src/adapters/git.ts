// 宿主执行的 git（ADR 0016）：argv（不经 shell）、GIT_TERMINAL_PROMPT=0、LC_ALL=C、超时 60 秒、登记 kind git（ADR 0012）；输出只记日志摘要。
// git 以独立进程组启动：超时对整组 SIGTERM，宽限后 SIGKILL（git 派生的 ssh、hook 等一并结束）。
import { spawn } from 'node:child_process'
import { filterEnv } from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { TrackProcess } from '../application/processes.ts'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'
import { signalTarget, type ProcessTarget } from './processes.ts'

export interface GitRequest {
  args: readonly string[]
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface GitResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GitPort {
  run(request: GitRequest): Promise<GitResult>
}

/** git 执行的缺省时限。 */
export const GIT_TIMEOUT_MS = 60_000
/** SIGTERM 到 SIGKILL 的宽限。 */
const KILL_GRACE_MS = 2_000
/** stdout / stderr 各自保留的上限（git status --porcelain 等的输出远小于此）。 */
const OUTPUT_LIMIT = 4 * 1024 * 1024

/** 在时限内没有结束的 git（已被终止）。 */
export class GitTimeoutError extends Error {
  override readonly name = 'GitTimeoutError'
}

/** 存根：调用即失败（未装配 git 时）。 */
export const unavailableGit: GitPort = {
  run: () => Promise.reject(new Error('git execution is not available')),
}

export interface GitRunnerOptions {
  /** 基础环境（Sidecar 的环境）：与 bash 相同地剔除 Sidecar 配置与凭据变量（HOST_ENV_EXCLUSIONS），再覆盖 GIT_TERMINAL_PROMPT=0 与 LC_ALL=C。 */
  env: Readonly<Record<string, string | undefined>>
  /** 子进程登记（kind git）；缺省不登记。 */
  track?: TrackProcess
  /** 可执行文件；缺省经 PATH 解析的 git。 */
  executable?: string
  /** SIGTERM 到 SIGKILL 的宽限；缺省 2 000 ms。 */
  killGraceMs?: number
}

const log = getLogger(['adapters', 'git'])

export function createGitRunner(options: GitRunnerOptions): GitPort {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(filterEnv(options.env, HOST_ENV_EXCLUSIONS))) if (value !== undefined) env[name] = value
  env.GIT_TERMINAL_PROMPT = '0'
  env.LC_ALL = 'C'
  const executable = options.executable ?? 'git'
  const grace = options.killGraceMs ?? KILL_GRACE_MS
  return {
    run(request) {
      const timeoutMs = request.timeoutMs ?? GIT_TIMEOUT_MS
      const started = Date.now()
      return new Promise<GitResult>((resolve, reject) => {
        const detached = process.platform !== 'win32'
        const child = spawn(executable, [...request.args], { cwd: request.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let aborted = false
        let killTimer: NodeJS.Timeout | undefined
        let release: (() => void) | undefined
        const target: ProcessTarget | undefined = child.pid === undefined ? undefined : { pid: child.pid, ...(detached ? { pgid: child.pid } : {}) }
        if (target && options.track) release = options.track({ ...target, kind: 'git', command: ['git', ...request.args].join(' ') })
        child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
          if (stdout.length < OUTPUT_LIMIT) stdout += chunk
        })
        child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
          if (stderr.length < OUTPUT_LIMIT) stderr += chunk
        })
        const terminate = () => {
          if (!target) return
          signalTarget(target, 'SIGTERM')
          killTimer = setTimeout(() => signalTarget(target, 'SIGKILL'), grace)
        }
        const timer = setTimeout(() => {
          timedOut = true
          terminate()
        }, timeoutMs)
        const onAbort = () => {
          aborted = true
          terminate()
        }
        request.signal?.addEventListener('abort', onAbort, { once: true })
        const finish = () => {
          clearTimeout(timer)
          request.signal?.removeEventListener('abort', onAbort)
          release?.()
        }
        child.once('error', (error) => {
          finish()
          if (killTimer) clearTimeout(killTimer)
          log.warn('git failed to start', { subcommand: request.args[0], error: error.message })
          reject(error)
        })
        child.once('close', (code, signal) => {
          finish()
          // 进程组中可能还有忽略 SIGTERM 的子进程：宽限到期的 SIGKILL 照常发出（目标为整组）。
          if (killTimer && !timedOut && !aborted) clearTimeout(killTimer)
          const durationMs = Date.now() - started
          // 只记摘要：子命令、退出码与输出长度，不记参数（路径、分支名）与输出文本。
          log.debug('git finished', { subcommand: request.args[0], exitCode: code, signal, durationMs, stdoutBytes: stdout.length, stderrBytes: stderr.length })
          if (timedOut) {
            log.warn('git timed out', { subcommand: request.args[0], timeoutMs })
            return reject(new GitTimeoutError(`git ${request.args[0] ?? ''} did not finish within ${timeoutMs} ms`))
          }
          if (aborted) return reject(request.signal?.reason ?? new Error('git aborted'))
          resolve({ exitCode: code ?? -1, stdout, stderr })
        })
      })
    },
  }
}

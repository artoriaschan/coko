// 外部 Hook 的执行（ADR 0013）：/bin/bash -c <command>，cwd 为 Session 工作目录，独立进程组（detached），登记 kind hook（ADR 0012）；
// 环境为 Sidecar 基础环境（去掉 COKO_* 与凭据形态的变量，与 bash 工具相同）加 COKO_PROJECT_DIR、COKO_SESSION_ID、COKO_HOOK_EVENT，不注入 Secret；
// stdin 写一行 JSON 后关闭；stdout / stderr 各保留前 64 KB。超时或中止时向进程组 SIGTERM，2 秒后仍有进程则 SIGKILL，进程组消失后删除登记。
// 不经 Seatbelt：Hook 与已批准的 MCP stdio Server 处于同一信任级别。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { filterEnv } from '@coko/agent'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'
import { processAlive, signalTarget, type ProcessTarget } from './processes.ts'
import type { TrackProcess } from '../application/processes.ts'

export interface HookRunRequest {
  command: string
  cwd: string
  /** Sidecar 基础环境之外的变量（COKO_PROJECT_DIR、COKO_SESSION_ID、COKO_HOOK_EVENT）。 */
  env: Record<string, string>
  /** 写入 stdin 的一行 JSON。 */
  input: string
  timeoutMs: number
  sessionId?: string
  signal?: AbortSignal
}

export interface HookRunOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  /** 启动失败等宿主错误。 */
  error?: string
}

export interface HookRunner {
  run(request: HookRunRequest): Promise<HookRunOutcome>
}

/** stdout / stderr 各自保留的上限（字节）。 */
export const HOOK_OUTPUT_MAX_BYTES = 64 * 1024
/** SIGTERM 到 SIGKILL 的宽限。 */
export const HOOK_KILL_GRACE_MS = 2_000
const POLL_MS = 25
/** 主进程退出后等待管道关闭的时间（派生的后台进程可能继承了管道）。 */
const PIPE_GRACE_MS = 200

export interface HookRunnerOptions {
  /** Sidecar 的基础环境。 */
  env: Readonly<Record<string, string | undefined>>
  /** 子进程登记（ADR 0012）；省略时不登记（单元测试）。 */
  track?: TrackProcess
  shell?: string
  killGraceMs?: number
}

/** 有上限的输出缓冲：超出部分丢弃。 */
function capped() {
  const chunks: Buffer[] = []
  let size = 0
  return {
    push(chunk: Buffer) {
      if (size >= HOOK_OUTPUT_MAX_BYTES) return
      const part = chunk.subarray(0, HOOK_OUTPUT_MAX_BYTES - size)
      chunks.push(part)
      size += part.length
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createHookRunner(options: HookRunnerOptions): HookRunner {
  const shell = options.shell ?? '/bin/bash'
  const grace = options.killGraceMs ?? HOOK_KILL_GRACE_MS
  const base = filterEnv(options.env, HOST_ENV_EXCLUSIONS)
  return {
    run(request) {
      const started = Date.now()
      return new Promise<HookRunOutcome>((resolve) => {
        const env: Record<string, string> = {}
        const merged: Record<string, string | undefined> = { ...base, ...request.env }
        for (const [name, value] of Object.entries(merged)) if (value !== undefined) env[name] = value
        let child: ChildProcessWithoutNullStreams
        try {
          child = spawn(shell, ['-c', request.command], { cwd: request.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
        } catch (error) {
          resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, durationMs: 0, error: error instanceof Error ? error.message : String(error) })
          return
        }
        const stdout = capped()
        const stderr = capped()
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        // Hook 不读 stdin 就退出时写入可能 EPIPE：忽略。
        child.stdin.on('error', () => undefined)
        const target: ProcessTarget | undefined = child.pid === undefined ? undefined : { pid: child.pid, pgid: child.pid }
        const release =
          target && options.track ? options.track({ ...target, kind: 'hook', sessionId: request.sessionId, command: request.command }) : () => undefined

        let timedOut = false
        let terminating: Promise<void> | undefined
        let exit: { code: number | null } | undefined
        let settled = false
        const finish = (extra: Partial<HookRunOutcome> = {}) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          request.signal?.removeEventListener('abort', onAbort)
          void (terminating ?? Promise.resolve()).then(() => {
            release()
            resolve({
              exitCode: exit?.code ?? null,
              stdout: stdout.text(),
              stderr: stderr.text(),
              timedOut,
              durationMs: Date.now() - started,
              ...extra,
            })
          })
        }
        /** 向进程组 SIGTERM，宽限期内轮询，仍有进程则 SIGKILL；进程组消失（或 SIGKILL 已发出）后结束。 */
        const terminate = () => {
          if (!target || terminating) return
          terminating = (async () => {
            signalTarget(target, 'SIGTERM')
            const deadline = Date.now() + grace
            while (processAlive(target) && Date.now() < deadline) await sleep(POLL_MS)
            if (processAlive(target)) signalTarget(target, 'SIGKILL')
            while (processAlive(target) && Date.now() < deadline + 1_000) await sleep(POLL_MS)
          })()
          void terminating.then(() => finish())
        }
        const timer = setTimeout(() => {
          timedOut = true
          terminate()
        }, request.timeoutMs)
        const onAbort = () => terminate()
        if (request.signal?.aborted) onAbort()
        else request.signal?.addEventListener('abort', onAbort, { once: true })

        child.once('error', (error) => {
          if (!exit) finish({ error: error.message })
        })
        // 正常退出：两个管道都关闭后结束；派生的后台进程继承了管道时最多再等 PIPE_GRACE_MS。
        let closed = 0
        const settle = () => {
          if (exit && closed === 2 && !terminating) finish()
        }
        child.stdout.once('close', () => (closed++, settle()))
        child.stderr.once('close', () => (closed++, settle()))
        child.once('exit', (code) => {
          exit = { code }
          if (terminating) return
          settle()
          setTimeout(() => (terminating ? undefined : finish()), PIPE_GRACE_MS)
        })
        child.stdin.end(request.input.endsWith('\n') ? request.input : request.input + '\n')
      })
    },
  }
}

/** 没有 Hook 的装配（库调用方与单元测试）：调用即失败。 */
export const unavailableHookRunner: HookRunner = {
  run: () => Promise.reject(new Error('Hook execution is not available')),
}

// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import {
  isConfined,
  SandboxUnavailableError,
  type ExecOutcome,
  type ExecPort,
  type ExecProcess,
  type ProcessExit,
  type SandboxPolicy,
  type SpawnedProcess,
  type SpawnRequest,
} from './exec.ts'
import { PTY_COLS, PTY_ROWS, PTY_TERM, PtyUnavailableError, type PtyPort } from './pty.ts'

/** Variables of the Sidecar process that must not leak into user commands. */
const HOST_ONLY_ENV = ['ELECTRON_RUN_AS_NODE']
const EXIT_STDIO_GRACE_MS = 100

/** An exact variable name or a pattern tested against each name. */
export type EnvExclusion = string | RegExp

export interface LocalExecOptions {
  /** Shell executable; default `/bin/bash`, falling back to `/bin/sh`. */
  shell?: string
  /** Base environment; default `process.env`. Host-only and excluded variables are removed either way. */
  env?: Record<string, string | undefined>
  /**
   * Variables the host keeps from user commands, for example its own configuration and credentials.
   * Applied to the base environment in addition to the host-only variables.
   */
  excludeEnv?: readonly EnvExclusion[]
  /**
   * Confinement for requests with a confined sandbox mode. Omitted: such requests reject with SandboxUnavailableError
   * (this package ships no sandbox; hosts provide one, for example Seatbelt on macOS).
   */
  sandbox?: LocalSandbox
  /** Pseudo terminals for `spawn({ tty: true })`. Omitted: such requests reject with PtyUnavailableError. */
  pty?: PtyPort
}

/** A host's sandbox runner for the local shell. */
export interface LocalSandbox {
  /**
   * The argv prefix that confines `<shell> -c <command>` to `policy` (for example `sandbox-exec -p <profile> --`).
   * Throws SandboxUnavailableError when the policy cannot be enforced.
   */
  wrap(policy: SandboxPolicy): readonly string[]
  /** Case-insensitive output substring the kernel emits for a denied file effect (Seatbelt: "operation not permitted"). */
  denialSignature: string
}

/** Output kept for matching a denial signature that straddles chunk boundaries. */
const DENIAL_TAIL = 64 * 1024
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES'])

const matches = (name: string, exclusion: EnvExclusion) =>
  typeof exclusion === 'string' ? name === exclusion : new RegExp(exclusion.source, exclusion.flags.replace('g', '')).test(name)

/** Copy of `base` without host-only variables and those matching `exclude`. */
export function filterEnv(base: Readonly<Record<string, string | undefined>>, exclude: readonly EnvExclusion[] = []): Record<string, string | undefined> {
  const all = [...HOST_ONLY_ENV, ...exclude]
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(base)) if (!all.some((exclusion) => matches(name, exclusion))) env[name] = value
  return env
}

/** Signal number → name (`15` → `SIGTERM`). */
const SIGNAL_NAMES = new Map(Object.entries(osConstants.signals).map(([name, number]) => [number, name]))

function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Wait for exit without hanging on pipes inherited by detached descendants: after `exit`, resolve once
 * both pipes ended, or after they stayed idle for a short grace period.
 */
function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    let exited = false
    let exitCode: number | null = null
    let idleTimer: NodeJS.Timeout | undefined
    let stdoutEnded = child.stdout === null
    let stderrEnded = child.stderr === null
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve(code)
    }
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish(exitCode), EXIT_STDIO_GRACE_MS)
    }
    const maybeFinish = () => {
      if (exited && stdoutEnded && stderrEnded) finish(exitCode)
    }
    child.stdout?.once('end', () => {
      stdoutEnded = true
      maybeFinish()
    })
    child.stderr?.once('end', () => {
      stderrEnded = true
      maybeFinish()
    })
    const onData = () => {
      if (exited && !settled) armIdle()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('exit', (code) => {
      exited = true
      exitCode = code
      maybeFinish()
      if (!settled) armIdle()
    })
    child.once('close', (code) => finish(code))
  })
}

/** Host lifecycle callbacks must not break the command they observe. */
function notify<T extends unknown[]>(callback: ((...args: T) => void) | undefined, ...args: T): void {
  try {
    callback?.(...args)
  } catch {
    // The host records its own failures.
  }
}

/**
 * Local shell execution: each command runs in its own process group so cancellation kills descendants too.
 * The process leads that group (detached spawn), so `onSpawn` reports `pgid = pid`.
 */
export function createLocalExecPort(options: LocalExecOptions = {}): ExecPort {
  const shell = options.shell ?? (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')
  const baseEnv = () => filterEnv(options.env ?? process.env, options.excludeEnv)

  /** 检查工作目录、按沙箱档位加前缀，得到 `[...前缀, <shell>, -c, <command>]`。 */
  const prepare = async ({ command, cwd, sandbox }: Pick<SpawnRequest, 'command' | 'cwd' | 'sandbox'>) => {
    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new Error(`Working directory does not exist: ${cwd}`)
    }
    // fail-closed：受限档位只经宿主的沙箱运行，不能启用时命令不运行。
    const confined = isConfined(sandbox) ? sandbox : undefined
    let prefix: readonly string[] = []
    if (confined) {
      if (!options.sandbox) throw new SandboxUnavailableError(confined.mode, 'this host provides no sandbox')
      prefix = options.sandbox.wrap(confined)
    }
    return { argv: [...prefix, shell, '-c', command], confined }
  }
  /** 以独立进程组启动（stdin 关闭）。 */
  const start = async (request: Pick<SpawnRequest, 'command' | 'cwd' | 'env' | 'sandbox'>) => {
    const { argv, confined } = await prepare(request)
    const child = spawn(argv[0]!, argv.slice(1), { cwd: request.cwd, detached: true, env: request.env ?? baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    return { child, confined }
  }
  /**
   * PTY 中启动（node-pty 等宿主端口）：cwd 为真实路径，120×30，TERM 缺省 xterm-256color。PTY 子进程是自己会话与进程组的组长
   * （pgid = pid），kill 由端口向进程组发信号。
   */
  const spawnTty = async (request: SpawnRequest): Promise<ExecProcess> => {
    const pty = options.pty
    if (!pty) throw new PtyUnavailableError()
    const { argv } = await prepare(request)
    const cwd = await realpath(request.cwd)
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.env ?? baseEnv())) if (value !== undefined) env[name] = value
    env.TERM ??= PTY_TERM
    const term = await pty.spawn({ argv, cwd, env, cols: PTY_COLS, rows: PTY_ROWS })
    const pid = term.pid
    notify<[SpawnedProcess]>(request.onSpawn, { pid, pgid: pid })
    let done = false
    term.onData((chunk) => request.onData(Buffer.from(chunk, 'utf8')))
    const exited = new Promise<ProcessExit>((resolve) =>
      term.onExit(({ exitCode, signal }) => {
        const name = signal ? SIGNAL_NAMES.get(signal) : undefined
        resolve(signal ? { exitCode: 128 + signal, ...(name ? { signal: name } : {}) } : { exitCode })
      }),
    )
    void exited.then(() => {
      done = true
      notify(request.onExit)
    })
    return {
      pid,
      pgid: pid,
      kill: (signal = 'SIGTERM') => {
        if (!done) term.kill(signal)
      },
      write: (text) => {
        if (!done) term.write(text)
      },
      exited,
    }
  }
  /** 沙箱可执行文件缺失或不可执行：命令没有运行。 */
  const startFailure = (error: unknown, confined: SandboxPolicy | undefined): unknown => {
    const code = (error as { code?: unknown }).code
    if (confined && typeof code === 'string' && SPAWN_FAILURES.has(code)) return new SandboxUnavailableError(confined.mode, (error as Error).message)
    return error
  }
  const exitOf = (child: ChildProcess, exitCode: number | null): ProcessExit => {
    const signalCode = child.signalCode
    return { exitCode: exitCode ?? (signalCode ? 128 + (osConstants.signals[signalCode] ?? 0) : 1), ...(signalCode ? { signal: signalCode } : {}) }
  }

  return {
    async spawn(request): Promise<ExecProcess> {
      if (request.tty) return spawnTty(request)
      const { command, cwd, env, onData, sandbox, onSpawn, onExit } = request
      const { child, confined } = await start({ command, cwd, env, sandbox })
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      const exit = waitForExit(child)
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve())
        exit.catch((error: unknown) => reject(startFailure(error, confined)))
      })
      const pid = child.pid!
      notify<[SpawnedProcess]>(onSpawn, { pid, pgid: pid })
      let done = false
      const exited = exit.then(
        (code) => exitOf(child, code),
        // 启动之后的 'error'（极少见）按失败退出处理。
        (): ProcessExit => ({ exitCode: 1 }),
      )
      void exited.then(() => {
        done = true
        notify(onExit)
      })
      return {
        pid,
        pgid: pid,
        kill: (signal = 'SIGTERM') => {
          if (!done) killProcessGroup(pid, signal)
        },
        exited,
      }
    },
    async exec({ command, cwd, env, onData, signal, timeoutMs, sandbox, onSpawn, onExit }): Promise<ExecOutcome> {
      if (signal?.aborted) return { kind: 'aborted' }
      const { child, confined } = await start({ command, cwd, env, sandbox })
      // 'spawn' fires only for a started process and before 'exit'; a spawn failure emits 'error' instead.
      let spawned = false
      child.once('spawn', () => {
        spawned = true
        const pid = child.pid!
        notify<[SpawnedProcess]>(onSpawn, { pid, pgid: pid })
      })
      let aborted = false
      let timedOut = false
      const kill = () => {
        if (child.pid) killProcessGroup(child.pid)
      }
      const onAbort = () => {
        aborted = true
        kill()
      }
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true
              kill()
            }, timeoutMs)
          : undefined
      const signature = confined ? options.sandbox!.denialSignature.toLowerCase() : undefined
      let tail = ''
      let denied = false
      const observe = (chunk: Buffer) => {
        onData(chunk)
        if (signature === undefined || denied) return
        tail = (tail + chunk.toString('utf8')).slice(-DENIAL_TAIL)
        if (tail.toLowerCase().includes(signature)) denied = true
      }
      child.stdout?.on('data', observe)
      child.stderr?.on('data', observe)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        let exitCode: number | null
        try {
          exitCode = await waitForExit(child)
        } catch (error) {
          throw startFailure(error, confined)
        }
        if (aborted) return { kind: 'aborted' }
        if (timedOut) return { kind: 'timeout' }
        const code = exitOf(child, exitCode).exitCode
        return code !== 0 && denied ? { kind: 'exited', exitCode: code, sandboxDenied: true } : { kind: 'exited', exitCode: code }
      } finally {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (spawned) notify(onExit)
      }
    },
  }
}

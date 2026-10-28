// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import { isConfined, SandboxUnavailableError, type ExecOutcome, type ExecPort, type SandboxPolicy } from './exec.ts'

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

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
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

/** Local shell execution: each command runs in its own process group so cancellation kills descendants too. */
export function createLocalExecPort(options: LocalExecOptions = {}): ExecPort {
  const shell = options.shell ?? (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')
  const baseEnv = () => filterEnv(options.env ?? process.env, options.excludeEnv)
  return {
    async exec({ command, cwd, env, onData, signal, timeoutMs, sandbox }): Promise<ExecOutcome> {
      if (signal?.aborted) return { kind: 'aborted' }
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
      const argv = [...prefix, shell, '-c', command]
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd,
        detached: true,
        env: env ?? baseEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
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
          // 沙箱可执行文件缺失或不可执行：命令没有运行。
          const code = (error as { code?: unknown }).code
          if (confined && typeof code === 'string' && SPAWN_FAILURES.has(code)) throw new SandboxUnavailableError(confined.mode, (error as Error).message)
          throw error
        }
        if (aborted) return { kind: 'aborted' }
        if (timedOut) return { kind: 'timeout' }
        const signalCode = child.signalCode
        const code = exitCode ?? (signalCode ? 128 + (osConstants.signals[signalCode] ?? 0) : 1)
        return code !== 0 && denied ? { kind: 'exited', exitCode: code, sandboxDenied: true } : { kind: 'exited', exitCode: code }
      } finally {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

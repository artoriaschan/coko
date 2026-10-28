// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import type { ExecOutcome, ExecPort } from './exec.ts'

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
}

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
    async exec({ command, cwd, env, onData, signal, timeoutMs }): Promise<ExecOutcome> {
      if (signal?.aborted) return { kind: 'aborted' }
      try {
        if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
      } catch {
        throw new Error(`Working directory does not exist: ${cwd}`)
      }

      const child = spawn(shell, ['-c', command], {
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
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const exitCode = await waitForExit(child)
        if (aborted) return { kind: 'aborted' }
        if (timedOut) return { kind: 'timeout' }
        const signalCode = child.signalCode
        return { kind: 'exited', exitCode: exitCode ?? (signalCode ? 128 + (osConstants.signals[signalCode] ?? 0) : 1) }
      } finally {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

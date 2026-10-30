import type { SandboxMode } from '../session-entries/permissions.ts'

/**
 * Execution port: how the Agent runs shell commands. The Sidecar uses the local implementation;
 * other hosts (containers, remote) provide their own with the same semantics.
 */
export interface ExecRequest {
  command: string
  cwd: string
  /** Full environment for the command. Omitted: the host default. */
  env?: Record<string, string | undefined>
  /** Combined stdout and stderr chunks, in arrival order. */
  onData: (chunk: Buffer) => void
  /** Aborting must terminate the whole process tree before the returned promise settles. */
  signal?: AbortSignal
  /** Kill the process tree after this many milliseconds. */
  timeoutMs?: number
  /**
   * File-write confinement (ADR 0005). Omitted or `danger-full-access`: unconfined. A confined mode the port cannot
   * enforce rejects with SandboxUnavailableError before anything runs (fail-closed).
   */
  sandbox?: SandboxPolicy
  /**
   * Lifecycle (ADR 0012): called once the process was started, with its pid and, when it leads its own process group,
   * the group id. Not called when the command could not be started. The host registers the process here.
   */
  onSpawn?: (process: SpawnedProcess) => void
  /** Called once after the process exited (or was killed), only if `onSpawn` was called. The host removes its registration. */
  onExit?: () => void
}

/** A started process as reported to `onSpawn`. `pgid` is present when the process leads its own process group (detached). */
export interface SpawnedProcess {
  pid: number
  pgid?: number
}

/** Where a confined command may write: `read-only` nothing, `workspace-write` only under `writableRoots` (real paths). */
export interface SandboxPolicy {
  mode: SandboxMode
  writableRoots: readonly string[]
  /**
   * Path segments (lowercase) that stay read-only at any depth under the writable roots, matched case-insensitively
   * (`.git`, `.coko`, shell and credential files). Omitted: none.
   */
  protectedNames?: readonly string[]
}

export type ExecOutcome =
  /**
   * Exit code; a signal-terminated shell reports 128 + signal number. `sandboxDenied`: a confined command exited non-zero
   * and its output carries the sandbox's denial signature.
   */
  { kind: 'exited'; exitCode: number; sandboxDenied?: boolean } | { kind: 'aborted' } | { kind: 'timeout' }

export interface ExecPort {
  /**
   * Run a command. Resolves after the process exited and its output was delivered. Rejects only
   * when the command could not be started (for example a missing working directory, or SandboxUnavailableError).
   */
  exec(request: ExecRequest): Promise<ExecOutcome>
}

/** A confined sandbox mode was requested but the host cannot enforce it; the command did not run. */
export class SandboxUnavailableError extends Error {
  override readonly name = 'SandboxUnavailableError'
  readonly code = 'sandbox-unavailable'
  readonly mode: SandboxMode
  constructor(mode: SandboxMode, reason?: string) {
    super(`The ${mode} sandbox is not available${reason ? `: ${reason}` : ''}`)
    this.mode = mode
  }
}

/** Whether a request must run confined. */
export const isConfined = (sandbox: SandboxPolicy | undefined): sandbox is SandboxPolicy => sandbox !== undefined && sandbox.mode !== 'danger-full-access'

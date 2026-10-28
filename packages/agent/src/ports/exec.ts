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
}

export type ExecOutcome =
  /** Exit code; a signal-terminated shell reports 128 + signal number. */
  { kind: 'exited'; exitCode: number } | { kind: 'aborted' } | { kind: 'timeout' }

export interface ExecPort {
  /**
   * Run a command. Resolves after the process exited and its output was delivered. Rejects only
   * when the command could not be started (for example a missing working directory).
   */
  exec(request: ExecRequest): Promise<ExecOutcome>
}

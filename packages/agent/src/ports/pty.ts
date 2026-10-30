/**
 * PTY port: how the Agent runs a command in a pseudo terminal (interactive programs fed through job_input). The Sidecar
 * provides it with node-pty; the agent package does not depend on node-pty. Without a port, a `tty: true` call returns a
 * `pty-unavailable` error result.
 */
export interface PtySpawnRequest {
  /** Program and arguments (sandbox prefix + shell -c command). */
  argv: readonly string[]
  /** Real path of the working directory. */
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

export interface PtyExit {
  exitCode: number
  /** Signal number when the process was terminated by a signal. */
  signal?: number
}

export interface PtyProcess {
  readonly pid: number
  write(text: string): void
  resize(cols: number, rows: number): void
  /** Signal the process group (default SIGTERM). */
  kill(signal?: NodeJS.Signals): void
  onData(listener: (chunk: string) => void): () => void
  onExit(listener: (exit: PtyExit) => void): () => void
}

export interface PtyPort {
  /** Rejects when the process could not be started. */
  spawn(request: PtySpawnRequest): Promise<PtyProcess>
}

/** The host has no PTY port; the command did not run. */
export class PtyUnavailableError extends Error {
  override readonly name = 'PtyUnavailableError'
  readonly code = 'pty-unavailable'
  constructor(reason = 'No pseudo terminal is available on this host') {
    super(reason)
  }
}

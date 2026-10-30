// 宿主执行的 git（ADR 0016）：argv、GIT_TERMINAL_PROMPT=0、LC_ALL=C、超时 60 秒、登记 kind git；输出只记日志摘要。
// 存根：只定义端口；worktree 的实现填充执行。
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

/** 存根：调用即失败（worktree 尚未接入时不会有调用方）。 */
export const unavailableGit: GitPort = {
  run: () => Promise.reject(new Error('git execution is not available')),
}

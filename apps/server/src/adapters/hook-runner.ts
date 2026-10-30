// 外部 Hook 的执行（ADR 0013）：/bin/bash -c、独立进程组、登记 kind hook、stdin 一行 JSON、超时 SIGTERM 后 2 秒 SIGKILL。
// 存根：只定义端口；Hook 的实现填充执行。
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
}

export interface HookRunner {
  run(request: HookRunRequest): Promise<HookRunOutcome>
}

/** 存根：调用即失败（Hook 尚未接入时不会有调用方）。 */
export const unavailableHookRunner: HookRunner = {
  run: () => Promise.reject(new Error('Hook execution is not available')),
}

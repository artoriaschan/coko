import type { ErrorCode } from '@coko/protocol'
import { isStoreError } from '@coko/session'

const STATUS: Record<ErrorCode, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'run-in-progress': 409,
  'nothing-to-retry': 409,
  'model-not-configured': 409,
  'model-required': 409,
  'approval-not-pending': 409,
  'no-active-run': 409,
  'nothing-to-continue': 409,
  'confirmation-pending': 409,
  'recovery-failed': 409,
  'session-busy': 409,
  'already-exists': 409,
  'revision-conflict': 409,
  'invalid-transition': 409,
  'job-not-running': 409,
  'hook-blocked': 400,
  'child-session': 409,
  'agent-not-running': 409,
  'schedule-not-allowed': 409,
  'not-a-git-repo': 400,
  'invalid-name': 400,
  'unsafe-worktree-path': 400,
  'worktree-exists': 409,
  'worktree-busy': 409,
  'worktree-dirty': 409,
  'worktree-removed': 409,
  'nothing-to-hand-off': 400,
  'digest-mismatch': 409,
  'storage-unavailable': 503,
  internal: 500,
}

/** application 层的可预期失败；http 层按 code 映射状态码。 */
export class AppError extends Error {
  override readonly name = 'AppError'
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.details = details
  }

  get status(): number {
    return STATUS[this.code]
  }
}

/** 错误的消息文本（日志与 cleanup.failures 用）；不是 Error 的值转为字符串。 */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** 把 StoreError 等已知失败转换为 AppError；未知错误归为 internal。 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (isStoreError(error)) {
    if (error.code === 'not-found') return new AppError('not-found', error.message)
    if (error.code === 'revision-conflict') return new AppError('revision-conflict', error.message, { ...error.details })
    if (error.fatal || error.code === 'closed') return new AppError('storage-unavailable', error.message, { storeCode: error.code })
  }
  return new AppError('internal', 'Internal error')
}

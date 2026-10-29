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

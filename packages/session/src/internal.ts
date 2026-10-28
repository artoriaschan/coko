// 两种实现共用的小工具；不从包入口导出。
import { StoreError } from './errors.ts'

/** Workspace 未给名称时取路径最后一段。 */
export function defaultWorkspaceName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || path
}

export function notFound(what: string, id: string): StoreError {
  return new StoreError('not-found', `${what} ${id} does not exist`, { [what]: id })
}

export function revisionConflict(key: string, expected: number, actual: number): StoreError {
  return new StoreError('revision-conflict', `setting "${key}" is at revision ${actual}, expected ${expected}`, { key, expected, actual })
}

export function closedError(): StoreError {
  return new StoreError('closed', 'session store is closed')
}

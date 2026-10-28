// 两种实现共用的小工具；不从包入口导出。
import { StoreError } from './errors.ts'
import type { JsonValue, SessionEntry, StoreOptions } from './types.ts'

/** 存储中的一行；payload 解析失败时为 undefined。 */
export type StoredEntry = Omit<SessionEntry, 'payload'> & { payload: JsonValue | undefined }

/** 读取路径：逐条迁移到当前版本，不合格的跳过并报告（不带 payload）。 */
export function upgradeEntries(rows: readonly StoredEntry[], options: Pick<StoreOptions, 'payloads' | 'onInvalidEntry'>): SessionEntry[] {
  const result: SessionEntry[] = []
  for (const row of rows) {
    const upgraded =
      row.payload === undefined
        ? { ok: false as const, reason: 'payload is not valid JSON' }
        : options.payloads.upgrade(row.kind, row.payloadVersion, row.payload)
    if (upgraded.ok) {
      result.push({ ...row, payloadVersion: upgraded.payloadVersion, payload: upgraded.payload })
      continue
    }
    try {
      options.onInvalidEntry?.({ sessionId: row.sessionId, seq: row.seq, kind: row.kind, payloadVersion: row.payloadVersion, reason: upgraded.reason })
    } catch {
      // 报告失败不影响读取。
    }
  }
  return result
}

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

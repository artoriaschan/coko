// 两种实现共用的小工具；不从包入口导出。
import { StoreError } from './errors.ts'
import { THINKING_LEVELS, type JsonValue, type SessionEntry, type SessionModelChoice, type StoreOptions, type ThinkingLevel } from './types.ts'

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

/** 与模型一起写入的档位：没有模型或未给档位时为 off。 */
export const levelOf = (choice: Partial<SessionModelChoice>): ThinkingLevel => (choice.model && choice.thinkingLevel) || 'off'

const isLevel = (text: string): text is ThinkingLevel => (THINKING_LEVELS as readonly string[]).includes(text)

/** 库中读回的档位：不是七档之一（手改或未来版本写入）时为 off。 */
export const parseLevel = (text: string): ThinkingLevel => (isLevel(text) ? text : 'off')

/** Workspace 未给名称时取路径最后一段。 */
export function defaultWorkspaceName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || path
}

export function notFound(what: string, id: string): StoreError {
  return new StoreError('not-found', `${what} ${id} does not exist`, { [what]: id })
}

export function alreadyExists(entity: string, id: string): StoreError {
  return new StoreError('already-exists', `${entity} ${id} already exists`, { entity, id })
}

export function revisionConflict(key: string, expected: number, actual: number): StoreError {
  return new StoreError('revision-conflict', `setting "${key}" is at revision ${actual}, expected ${expected}`, { key, expected, actual })
}

/** Memory 的作用域与 workspaceId 必须一致：workspace 作用域需要 workspaceId，user 作用域不能有。 */
export function checkMemoryScope(input: { scope: string; workspaceId?: string | null }): string | null {
  if (input.scope !== 'user' && input.scope !== 'workspace')
    throw new StoreError('invalid-input', `unknown memory scope ${input.scope}`, { scope: input.scope })
  const workspaceId = input.workspaceId ?? null
  if ((input.scope === 'workspace') !== (workspaceId !== null))
    throw new StoreError('invalid-input', 'workspace memories need a workspaceId; user memories must not have one', { scope: input.scope })
  return workspaceId
}

export function closedError(): StoreError {
  return new StoreError('closed', 'session store is closed')
}

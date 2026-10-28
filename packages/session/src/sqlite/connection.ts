// 单个 DatabaseSync 连接上的事务、租约校验与失败状态。
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import { StoreError } from '../errors.ts'
import { closedError } from '../internal.ts'

/** SQLite 主错误码（扩展码的低 8 位）。 */
export function sqliteCode(error: unknown): number | undefined {
  const errcode = (error as { errcode?: unknown } | null)?.errcode
  return typeof errcode === 'number' ? errcode & 0xff : undefined
}

export const SQLITE_BUSY = 5
export const SQLITE_CORRUPT = 11
export const SQLITE_NOTADB = 26

function wrap(error: unknown): StoreError {
  if (error instanceof StoreError) return error
  return new StoreError('storage-failed', error instanceof Error ? error.message : String(error), { sqliteCode: sqliteCode(error) }, { cause: error })
}

export class Connection {
  readonly db: DatabaseSync
  readonly instanceId: string
  readonly now: () => number
  private readonly statements = new Map<string, StatementSync>()
  private failure: StoreError | undefined
  private closed = false

  constructor(db: DatabaseSync, instanceId: string, now: () => number) {
    this.db = db
    this.instanceId = instanceId
    this.now = now
  }

  /** 预编译并缓存语句；只用于固定 SQL 文本。 */
  statement(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.statement(sql).all(...params) as T[]
  }

  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.statement(sql).run(...params).changes)
  }

  get failed(): StoreError | undefined {
    return this.failure
  }

  fail(error: StoreError): void {
    this.failure ??= error
  }

  private ensureUsable(): void {
    if (this.closed) throw closedError()
    if (this.failure) throw this.failure
  }

  /** 只读操作。 */
  read<T>(fn: () => T): T {
    this.ensureUsable()
    try {
      return fn()
    } catch (error) {
      throw wrap(error)
    }
  }

  /**
   * 写操作：BEGIN IMMEDIATE → 校验本实例仍持有租约 → fn → COMMIT。COMMIT 返回即已提交。
   * 失败时回滚；回滚本身失败则连接进入 unknown-state，此后所有操作拒绝。
   */
  write<T>(fn: () => T, options: { checkLease?: boolean } = {}): T {
    this.ensureUsable()
    try {
      this.db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      throw wrap(error)
    }
    try {
      if (options.checkLease !== false) this.assertLease()
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.rollback(error)
      throw wrap(error)
    }
  }

  private rollback(cause: unknown): void {
    if (!this.db.isTransaction) return
    try {
      this.db.exec('ROLLBACK')
    } catch (rollbackError) {
      const error = new StoreError('unknown-state', 'rollback failed; close and reopen the store', {}, { cause: rollbackError })
      this.fail(error)
      throw new StoreError('unknown-state', error.message, {}, { cause })
    }
  }

  private assertLease(): void {
    const row = this.get<{ instance_id: string; pid: number; heartbeat_at: number }>('SELECT instance_id, pid, heartbeat_at FROM host_lease WHERE id = 1')
    if (row?.instance_id === this.instanceId) return
    const error = new StoreError('lease-lost', 'host lease was taken over by another instance', {
      instanceId: row?.instance_id,
      pid: row?.pid,
    })
    this.fail(error)
    throw error
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.db.close()
  }
}

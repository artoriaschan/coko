// 打开序列（ADR 0003）：0600 文件 → quick_check（失败隔离）→ 版本检查 → WAL / synchronous=FULL / 外键
// → 宿主租约 → 迁移前 VACUUM INTO 备份 → 逐步迁移 → FTS5 探测 → 心跳。
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { StoreError } from '../errors.ts'
import { Connection, SQLITE_BUSY, SQLITE_CORRUPT, SQLITE_NOTADB, sqliteCode } from './connection.ts'
import { HOST_LEASE_DDL, MIGRATIONS, type Migration } from './schema.ts'

export interface OpenDatabaseOptions {
  path: string
  now: () => number
  leaseTtlMs: number
  heartbeatMs: number
  busyTimeoutMs: number
  /** 仅测试注入；默认 MIGRATIONS。 */
  migrations?: readonly Migration[]
}

export interface MigrationReport {
  from: number
  to: number
  /** 迁移已有数据前的 VACUUM INTO 备份；新库或无需迁移时为 null。 */
  backupPath: string | null
}

export interface OpenedDatabase {
  connection: Connection
  migration: MigrationReport
  fts5: boolean
  /** 停止心跳并释放租约，然后关闭连接。 */
  close(): void
}

export async function openDatabase(options: OpenDatabaseOptions): Promise<OpenedDatabase> {
  const migrations = options.migrations ?? MIGRATIONS
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration #${i} must have version ${i + 1}, got ${m.version}`)
  })
  const latest = migrations.length
  const path = resolve(options.path)

  await prepareFile(path)
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { timeout: options.busyTimeoutMs, enableForeignKeyConstraints: true })
  } catch (error) {
    throw openFailed(path, error)
  }

  let connection: Connection | undefined
  try {
    await checkIntegrity(db, path)

    const version = userVersion(db)
    if (version > latest) {
      throw new StoreError('version-too-new', `database schema version ${version} is newer than supported version ${latest}`, {
        path,
        version,
        supported: latest,
      })
    }

    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA foreign_keys = ON')
    connection = new Connection(db, randomUUID(), options.now)
    acquireLease(connection, path, options.leaseTtlMs)
  } catch (error) {
    if (db.isOpen) db.close()
    throw error instanceof StoreError ? error : openFailed(path, error)
  }

  const conn = connection
  let migration: MigrationReport
  try {
    migration = await migrate(conn, path, migrations)
  } catch (error) {
    releaseLease(conn)
    conn.close()
    throw error
  }
  const fts5 = probeFts5(conn.db)

  const heartbeat = setInterval(() => beat(conn), options.heartbeatMs)
  heartbeat.unref()

  return {
    connection: conn,
    migration,
    fts5,
    close() {
      clearInterval(heartbeat)
      releaseLease(conn)
      conn.close()
    },
  }
}

async function prepareFile(path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await chmod(path, 0o600)
  } catch (error) {
    throw openFailed(path, error)
  }
}

function openFailed(path: string, error: unknown): StoreError {
  return new StoreError('open-failed', `cannot open database: ${error instanceof Error ? error.message : String(error)}`, { path }, { cause: error })
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/** quick_check 失败或文件不是数据库时，关闭连接、改名隔离原文件并报告 fatal；不重建。 */
async function checkIntegrity(db: DatabaseSync, path: string): Promise<void> {
  let problems: string[]
  try {
    const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
    problems = rows.map((r) => r.quick_check).filter((r) => r !== 'ok')
  } catch (error) {
    const code = sqliteCode(error)
    if (code !== SQLITE_NOTADB && code !== SQLITE_CORRUPT) throw openFailed(path, error)
    problems = [error instanceof Error ? error.message : String(error)]
  }
  if (problems.length === 0) return

  db.close()
  let quarantinedTo: string | null = null
  let quarantineError: unknown
  try {
    quarantinedTo = await quarantine(path)
  } catch (error) {
    quarantineError = error
  }
  throw new StoreError(
    'corrupt',
    quarantinedTo ? `database failed integrity check and was moved to ${quarantinedTo}` : 'database failed integrity check and could not be moved aside',
    { path, quarantinedTo, problems: problems.slice(0, 10) },
    { cause: quarantineError },
  )
}

async function quarantine(path: string): Promise<string> {
  const target = `${path}.corrupt-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
  await rename(path, target)
  // WAL 与原库一起隔离，避免被新库误用；shm 是可重建的共享内存索引。
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(path + suffix)) await rename(path + suffix, target + suffix)
  }
  return target
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 在 BEGIN IMMEDIATE 事务内获取租约。现有租约属于其他实例，且其进程存活、心跳未超过 TTL 时，报告 lease-held。
 * 进程已退出或心跳超时（含 pid 被复用的情况）则接管。
 */
function acquireLease(conn: Connection, path: string, ttlMs: number): void {
  try {
    conn.write(
      () => {
        conn.db.exec(HOST_LEASE_DDL)
        const now = conn.now()
        const current = conn.get<{ instance_id: string; pid: number; heartbeat_at: number }>(
          'SELECT instance_id, pid, heartbeat_at FROM host_lease WHERE id = 1',
        )
        if (current && now - current.heartbeat_at <= ttlMs && isPidAlive(current.pid)) {
          throw leaseHeld(path, current)
        }
        conn.run(
          `INSERT INTO host_lease (id, instance_id, pid, acquired_at, heartbeat_at) VALUES (1, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET instance_id = excluded.instance_id, pid = excluded.pid,
             acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at`,
          conn.instanceId,
          process.pid,
          now,
          now,
        )
      },
      { checkLease: false },
    )
  } catch (error) {
    if (error instanceof StoreError && error.code === 'lease-held') throw error
    // 等满 busy timeout 仍拿不到写锁：另一实例正在写，按租约冲突报告。
    if (error instanceof StoreError && sqliteCode(error.cause) === SQLITE_BUSY) throw leaseHeld(path, undefined, error.cause)
    throw error
  }
}

function leaseHeld(path: string, holder: { instance_id: string; pid: number; heartbeat_at: number } | undefined, cause?: unknown): StoreError {
  return new StoreError(
    'lease-held',
    holder ? `database is in use by another Coko instance (pid ${holder.pid})` : 'database is locked by another Coko instance',
    { path, instanceId: holder?.instance_id, pid: holder?.pid, heartbeatAt: holder?.heartbeat_at },
    { cause },
  )
}

function beat(conn: Connection): void {
  if (conn.failed) return
  try {
    const changed = conn.write(() => conn.run('UPDATE host_lease SET heartbeat_at = ? WHERE id = 1 AND instance_id = ?', conn.now(), conn.instanceId))
    void changed
  } catch {
    // lease-lost 已记录在连接上；其他瞬时错误留给下一次心跳。
  }
}

function releaseLease(conn: Connection): void {
  if (conn.failed) return
  try {
    conn.write(() => conn.run('DELETE FROM host_lease WHERE id = 1 AND instance_id = ?', conn.instanceId))
  } catch {
    // 释放失败不影响关闭；下个实例按 pid 与心跳判断接管。
  }
}

async function migrate(conn: Connection, path: string, migrations: readonly Migration[]): Promise<MigrationReport> {
  const from = userVersion(conn.db)
  const to = migrations.length
  if (from === to) return { from, to, backupPath: null }

  let backupPath: string | null = null
  if (from > 0) {
    backupPath = `${path}.backup-v${from}-${new Date().toISOString().replaceAll(':', '-')}`
    try {
      conn.db.prepare('VACUUM INTO ?').run(backupPath)
      await chmod(backupPath, 0o600)
    } catch (error) {
      throw new StoreError(
        'migration-failed',
        `backup before migration failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          path,
          from,
          to,
          version: from,
          backupPath,
        },
        { cause: error },
      )
    }
  }

  let version = from
  for (const step of migrations.slice(from)) {
    try {
      conn.write(() => {
        step.up(conn.db)
        // user_version 写在库头，与迁移步骤同一事务提交或回滚。
        conn.db.exec(`PRAGMA user_version = ${step.version}`)
      })
    } catch (error) {
      throw new StoreError(
        'migration-failed',
        `migration to version ${step.version} failed`,
        { path, from, to, version, failedVersion: step.version, backupPath },
        { cause: error },
      )
    }
    version = step.version
  }
  return { from, to, backupPath }
}

/** FTS5 只作可重建的派生索引（ADR 0003）；运行时不支持时调用方降级为普通查询。 */
function probeFts5(db: DatabaseSync): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE temp.coko_fts5_probe USING fts5(x)')
    db.exec('DROP TABLE temp.coko_fts5_probe')
    return true
  } catch {
    return false
  }
}

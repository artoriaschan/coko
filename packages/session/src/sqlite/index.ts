// SQLite 入口：node:sqlite 只在本入口导入（ADR 0003）。
import type { SessionStore, StoreOptions } from '../types.ts'
import { openDatabase, type MigrationReport } from './open.ts'
import { createMemoryRepository, createSecretRepository } from './memory-secrets.ts'
import { createPluginRepository } from './plugins.ts'
import { createProcessRepository } from './processes.ts'
import { createRecoveryQueries, type RecoveryQueries } from './recovery.ts'
import {
  createProviderRepository,
  createScheduleRepository,
  createSessionRepository,
  createSettingsRepository,
  createWorktreeRepository,
} from './repositories.ts'
import { MIGRATIONS } from './schema.ts'

export type { MigrationReport } from './open.ts'
export type { RecoveryQueries, UnfinishedRun } from './recovery.ts'

/** 程序支持的库版本（PRAGMA user_version）。 */
export const SQLITE_SCHEMA_VERSION = MIGRATIONS.length

export interface SqliteStoreOptions extends StoreOptions {
  /** 库文件路径，例如 <userData>/coko.db；目录不存在时以 0700 创建。 */
  path: string
  /** 心跳超过该时长的租约可被接管。默认 30s。 */
  leaseTtlMs?: number
  /** 心跳间隔。默认 10s。 */
  heartbeatMs?: number
  /** 等待写锁的上限。默认 5s。 */
  busyTimeoutMs?: number
  /** false 时 Memory 检索不用 FTS5（测试以 COKO_TEST_NO_FTS 强制降级）。默认 true。 */
  fts?: boolean
}

export interface SqliteStore extends SessionStore {
  /** 本实例的租约标识。 */
  readonly instanceId: string
  readonly migration: MigrationReport
  /** Memory 检索是否使用 FTS5（运行时支持、索引已建立且未被关闭）；否则降级为 LIKE。 */
  readonly capabilities: { fts5: boolean }
  /** 启动恢复用的跨 Session 查询（未完成的 Run、每个 Session 某 kind 的最后一条）。 */
  readonly recovery: RecoveryQueries
}

/**
 * 打开序列见 ADR 0003。失败以 fatal StoreError 拒绝：corrupt（原文件已隔离）、version-too-new（不写库）、lease-held、
 * migration-failed、open-failed。
 */
export async function openSqliteStore(options: SqliteStoreOptions): Promise<SqliteStore> {
  const opened = await openDatabase({
    path: options.path,
    now: options.now ?? Date.now,
    leaseTtlMs: options.leaseTtlMs ?? 30_000,
    heartbeatMs: options.heartbeatMs ?? 10_000,
    busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
  })
  const conn = opened.connection
  const fts = options.fts !== false && opened.fts5 && conn.get('SELECT 1 FROM sqlite_master WHERE name = ?', 'memories_fts') !== undefined
  let closing: Promise<void> | undefined
  return {
    instanceId: conn.instanceId,
    migration: opened.migration,
    capabilities: { fts5: fts },
    sessions: createSessionRepository(conn, options),
    settings: createSettingsRepository(conn),
    providers: createProviderRepository(conn),
    memories: createMemoryRepository(conn, { fts }),
    plugins: createPluginRepository(conn),
    secrets: createSecretRepository(conn),
    processes: createProcessRepository(conn),
    worktrees: createWorktreeRepository(conn),
    schedules: createScheduleRepository(conn, options),
    recovery: createRecoveryQueries(conn, options),
    close() {
      closing ??= new Promise<void>((resolve) => {
        opened.close()
        resolve()
      })
      return closing
    },
  }
}

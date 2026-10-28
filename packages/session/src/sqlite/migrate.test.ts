import { mkdtemp, rm, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { StoreError } from '../errors.ts'
import { openDatabase, type OpenDatabaseOptions } from './open.ts'
import type { Migration } from './schema.ts'

// 迁移列表是内部注入点：用合成迁移验证编号前向迁移、备份与失败处理。
const v1: Migration = { version: 1, up: (db) => db.exec("CREATE TABLE notes (body TEXT NOT NULL) STRICT; INSERT INTO notes VALUES ('kept')") }
const v2: Migration = { version: 2, up: (db) => db.exec("ALTER TABLE notes ADD COLUMN tag TEXT NOT NULL DEFAULT 'none'") }
const v3Fails: Migration = {
  version: 3,
  up: (db) => {
    db.exec('CREATE TABLE half_done (x INTEGER) STRICT')
    throw new Error('boom')
  },
}

function inspect(path: string): { version: number; tables: string[]; notes: unknown[] } {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return {
      version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      tables: (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name),
      notes: db
        .prepare('SELECT * FROM notes')
        .all()
        .map((r) => ({ ...r })),
    }
  } finally {
    db.close()
  }
}

describe('SQLite 编号前向迁移', () => {
  it('已有数据迁移前以 VACUUM INTO 备份；失败步骤回滚，已提交步骤与租约释放保持正确', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const options = (migrations: Migration[]): OpenDatabaseOptions => ({
      path,
      migrations,
      now: Date.now,
      leaseTtlMs: 30_000,
      heartbeatMs: 60_000,
      busyTimeoutMs: 1_000,
    })

    const fresh = await openDatabase(options([v1]))
    expect(fresh.migration).toEqual({ from: 0, to: 1, backupPath: null })
    fresh.close()

    const upgraded = await openDatabase(options([v1, v2]))
    upgraded.close()
    const backupPath = upgraded.migration.backupPath
    expect(upgraded.migration).toMatchObject({ from: 1, to: 2 })
    expect(backupPath).toMatch(/coko\.db\.backup-v1-/)
    expect((await stat(backupPath as string)).mode & 0o777).toBe(0o600)
    expect(inspect(backupPath as string)).toMatchObject({ version: 1, notes: [{ body: 'kept' }] })
    expect(inspect(path)).toMatchObject({ version: 2, notes: [{ body: 'kept', tag: 'none' }] })

    const error = await openDatabase(options([v1, v2, v3Fails])).then(
      (db) => {
        db.close()
        return undefined
      },
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(StoreError)
    expect(error).toMatchObject({ code: 'migration-failed', fatal: true, details: { version: 2, failedVersion: 3 } })
    expect((error as StoreError).details.backupPath).toMatch(/coko\.db\.backup-v2-/)
    expect(inspect(path)).toMatchObject({ version: 2, notes: [{ body: 'kept', tag: 'none' }] })
    expect(inspect(path).tables).not.toContain('half_done')

    // 迁移失败释放了租约：同一程序版本可以立即重新打开。
    const reopened = await openDatabase(options([v1, v2]))
    expect(reopened.migration).toEqual({ from: 2, to: 2, backupPath: null })
    reopened.close()
  })
})

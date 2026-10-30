// 迁移 v7：宿主登记的子进程表 host_processes（ADR 0012）。v6 库打开后备份、原数据可读、新表为 STRICT。
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

describe('SQLite 迁移 v7', () => {
  it('v6 库升级到 7：.backup-v6-*（0600）、原有 Session 与条目可读、host_processes 为 STRICT 且可写入', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v7-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const v6 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 6), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v6.connection.db
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'kept', 'custom-provider-1', 'custom-model-1', 1, 5, 'high', 0)")
    db.exec(`INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '{"text":"from v6"}', NULL, 2)`)
    v6.close()

    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, onInvalidEntry: () => {} })
    onTestFinished(() => store.close())
    expect(SQLITE_SCHEMA_VERSION).toBe(7)
    expect(store.migration).toMatchObject({ from: 6, to: 7 })
    const backup = store.migration.backupPath!
    expect(backup).toMatch(/coko\.db\.backup-v6-/)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)
    expect(await store.sessions.getSession('s1')).toMatchObject({ title: 'kept', thinkingLevel: 'high', updatedAt: 5 })
    expect((await store.sessions.listEntries('s1')).map((e) => e.payload)).toEqual([{ text: 'from v6' }])
    await store.processes.register({ id: 'p1', pid: 123, startedAt: 'Thu Oct 30 14:22:09 2026', kind: 'mcp', command: 'node server.mjs' })
    expect((await store.processes.list()).map((p) => p.id)).toEqual(['p1'])

    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      const sql = (raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'host_processes'").get() as { sql: string }).sql
      expect(sql).toMatch(/STRICT$/)
      const columns = (raw.prepare("SELECT name FROM pragma_table_info('host_processes')").all() as { name: string }[]).map((r) => r.name)
      expect(columns).toEqual(['id', 'pid', 'pgid', 'started_at', 'kind', 'session_id', 'job_id', 'command', 'created_at'])
    } finally {
      raw.close()
    }
    const old = new DatabaseSync(backup, { readOnly: true })
    try {
      expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(6)
    } finally {
      old.close()
    }
  })
})

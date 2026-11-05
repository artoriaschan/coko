import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

it('v11 升级保留旧会话与条目，目录与 cwd 为空；原库备份仍为 v11', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coko-v12-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'coko.db')
  const old = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 11), now: Date.now, leaseTtlMs: 30000, heartbeatMs: 60000, busyTimeoutMs: 1000 })
  old.connection.db.exec(`INSERT INTO workspaces VALUES ('w1', '/old/workspace', 'Old', 10);
    INSERT INTO sessions (id, workspace_id, title, created_at, updated_at) VALUES ('s1', 'w1', 'Old session', 10, 20);
    INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '"retained"', NULL, 20);`)
  old.close()
  const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  onTestFinished(() => store.close())
  expect(store.migration).toMatchObject({ from: 11, to: SQLITE_SCHEMA_VERSION })
  expect(await store.sessions.getSession('s1')).toMatchObject({ title: 'Old session', directory: null, cwd: null, updatedAt: 20 })
  expect(await store.sessions.listEntries('s1')).toEqual([expect.objectContaining({ payload: 'retained' })])
  expect(await store.sessions.getWorkspace('w1')).toMatchObject({ path: '/old/workspace' })
  const backup = new DatabaseSync(store.migration.backupPath!, { readOnly: true })
  try {
    expect(backup.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 })
    expect(
      backup
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .map((column) => column.name),
    ).not.toContain('directory')
  } finally {
    backup.close()
  }
})

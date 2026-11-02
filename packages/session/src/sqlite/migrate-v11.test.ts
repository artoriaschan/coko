import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { openSqliteStore } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

it('v10 升级保留附加目录顺序，主要位置默认为零；新位置在重启后保留，备份仍为 v10', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coko-v11-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'coko.db')
  const old = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 10), now: Date.now, leaseTtlMs: 30000, heartbeatMs: 60000, busyTimeoutMs: 1000 })
  old.connection.db.exec(`INSERT INTO workspaces VALUES ('w1', '/work/one', 'One', 10);
    INSERT INTO projects (id, name, primary_workspace_id, additional_folders, created_at) VALUES ('p1', 'One', 'w1', '["/work/two","/work/three"]', 10);`)
  old.close()
  let store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  onTestFinished(() => store.close())
  expect(await store.projects.get('p1')).toMatchObject({ primaryFolderIndex: 0, additionalFolders: ['/work/two', '/work/three'] })
  const backup = new DatabaseSync(store.migration.backupPath!, { readOnly: true })
  try {
    expect(backup.prepare('PRAGMA user_version').get()).toEqual({ user_version: 10 })
  } finally {
    backup.close()
  }
  await store.projects.update('p1', { primaryFolderIndex: 2 })
  await store.close()
  store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  expect(await store.projects.get('p1')).toMatchObject({ primaryFolderIndex: 2, additionalFolders: ['/work/two', '/work/three'] })
})

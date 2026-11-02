import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { openSqliteStore } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

it('v9 升级：每个 Workspace 成为项目，根会话含 worktree 归入项目，子会话不存归属，备份可读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coko-v10-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'coko.db')
  const old = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 9), now: Date.now, leaseTtlMs: 30000, heartbeatMs: 60000, busyTimeoutMs: 1000 })
  old.connection.db.exec(`
    INSERT INTO workspaces VALUES ('w1', '/work/one', 'One', 10), ('w2', '/work/two', 'Two', 20);
    INSERT INTO worktrees VALUES ('wt', 'w1', 'isolated', '/work/isolated', 'coko/isolated', 'abc', '/work/one', 'active', 'user', 10, NULL);
    INSERT INTO sessions (id, workspace_id, title, created_at, updated_at, parent_session_id, worktree_id) VALUES
      ('root', 'w1', 'Existing', 11, 15, NULL, NULL),
      ('isolated', 'w1', 'Worktree', 12, 16, NULL, 'wt'),
      ('child', 'w1', 'Child', 13, 17, 'root', NULL);
  `)
  old.close()
  const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  onTestFinished(() => store.close())
  expect(await store.projects.list()).toEqual([
    { id: 'project-w1', name: 'One', primaryWorkspaceId: 'w1', additionalFolders: [], primaryFolderIndex: 0, pinnedAt: null, createdAt: 10 },
    { id: 'project-w2', name: 'Two', primaryWorkspaceId: 'w2', additionalFolders: [], primaryFolderIndex: 0, pinnedAt: null, createdAt: 20 },
  ])
  for (const id of ['root', 'isolated'])
    expect(await store.sessions.getSession(id)).toMatchObject({ projectId: 'project-w1', pinnedAt: null, archivedAt: null })
  expect(await store.sessions.getSession('isolated')).toMatchObject({ worktreeId: 'wt', updatedAt: 16 })
  expect(await store.sessions.getSession('child')).toMatchObject({ projectId: null, parentSessionId: 'root' })
  const backup = store.migration.backupPath!
  expect((await stat(backup)).mode & 0o777).toBe(0o600)
  const before = new DatabaseSync(backup, { readOnly: true })
  try {
    expect(before.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 })
    expect(before.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 3 })
  } finally {
    before.close()
  }
})

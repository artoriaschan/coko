// 迁移 v8：子 Session 与 worktree 绑定、worktrees / schedules 表、host_processes 重建（kind 增加 hook、git）。v7 库打开后备份、
// 原数据与登记行可读、新表为 STRICT。
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((r) => r.name)
const ddl = (db: DatabaseSync, name: string) => (db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string } | undefined)?.sql

describe('SQLite 迁移 v8', () => {
  it('v7 库升级到 8：.backup-v7-*（0600）、原 Session / 条目 / 登记行可读、新表 STRICT、子 Session 与 hook / git 登记可写', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v8-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const v7 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 7), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v7.connection.db
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'kept', 'p', 'm', 1, 5, 'high', 0)")
    db.exec(`INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '{"text":"from v7"}', NULL, 2)`)
    db.exec("INSERT INTO host_processes VALUES ('p1', 123, 123, 'Thu Oct 30 14:22:09 2026', 'job', 's1', 'j1', 'npm test', 3)")
    db.exec("INSERT INTO host_processes VALUES ('p2', 124, NULL, 'Thu Oct 30 14:22:10 2026', 'mcp', NULL, NULL, 'node s.mjs', 4)")
    v7.close()

    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, onInvalidEntry: () => {} })
    onTestFinished(() => store.close())
    expect(SQLITE_SCHEMA_VERSION).toBe(8)
    expect(store.migration).toMatchObject({ from: 7, to: 8 })
    const backup = store.migration.backupPath!
    expect(backup).toMatch(/coko\.db\.backup-v7-/)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)

    expect(await store.sessions.getSession('s1')).toMatchObject({ title: 'kept', thinkingLevel: 'high', updatedAt: 5, parentSessionId: null, worktreeId: null })
    expect((await store.sessions.listEntries('s1')).map((e) => e.payload)).toEqual([{ text: 'from v7' }])
    expect(await store.processes.list()).toEqual([
      { id: 'p1', pid: 123, pgid: 123, startedAt: 'Thu Oct 30 14:22:09 2026', kind: 'job', sessionId: 's1', jobId: 'j1', command: 'npm test', createdAt: 3 },
      { id: 'p2', pid: 124, pgid: null, startedAt: 'Thu Oct 30 14:22:10 2026', kind: 'mcp', sessionId: null, jobId: null, command: 'node s.mjs', createdAt: 4 },
    ])
    await store.processes.register({ id: 'p3', pid: 125, pgid: 125, startedAt: 'x', kind: 'hook', sessionId: 's1', command: 'check.sh' })
    await store.processes.register({ id: 'p4', pid: 126, startedAt: 'y', kind: 'git', command: 'git status' })
    const child = await store.sessions.createSession({ workspaceId: 'w1', parentSessionId: 's1' })
    expect((await store.sessions.listSessions()).map((s) => s.id)).toEqual(['s1'])
    expect((await store.sessions.listChildren('s1')).map((s) => s.id)).toEqual([child.id])

    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      for (const table of ['worktrees', 'schedules', 'host_processes']) expect(ddl(raw, table)).toMatch(/STRICT$/)
      expect(columns(raw, 'sessions').slice(-2)).toEqual(['parent_session_id', 'worktree_id'])
      expect(columns(raw, 'host_processes')).toEqual(['id', 'pid', 'pgid', 'started_at', 'kind', 'session_id', 'job_id', 'command', 'created_at'])
      expect(columns(raw, 'worktrees')).toEqual([
        'id',
        'workspace_id',
        'name',
        'path',
        'branch',
        'base_commit',
        'repo_root',
        'status',
        'created_by',
        'created_at',
        'removed_at',
      ])
      expect(columns(raw, 'schedules')).toEqual([
        'id',
        'session_id',
        'title',
        'prompt',
        'rule',
        'status',
        'next_at',
        'last_occurrence',
        'revision',
        'created_at',
        'updated_at',
      ])
      for (const index of ['sessions_by_parent', 'schedules_by_next']) expect(ddl(raw, index)).toEqual(expect.any(String))
      expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      raw.close()
    }
    const old = new DatabaseSync(backup, { readOnly: true })
    try {
      expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(7)
      expect(old.prepare('SELECT COUNT(*) AS n FROM host_processes').get()).toEqual({ n: 2 })
    } finally {
      old.close()
    }
  })
})

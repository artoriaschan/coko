// 迁移 v9：plugins 表、memories_fts（FTS5，触发器同步）、host_processes 重建（kind 增加 lsp）。v8 库打开后备份、原数据与登记行可读、
// 新表为 STRICT；没有 FTS5（或宿主关闭）时检索走 LIKE。
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

const ddl = (db: DatabaseSync, name: string) => (db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string } | undefined)?.sql
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((r) => r.name)

async function v8Database() {
  const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v9-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'coko.db')
  const v8 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 8), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
  const db = v8.connection.db
  db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
  db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'kept', 'p', 'm', 1, 5, 'high', 0, NULL, NULL)")
  db.exec(`INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '{"text":"from v8"}', NULL, 2)`)
  db.exec("INSERT INTO memories VALUES ('m1', 'user', NULL, 'Prefers pnpm over npm', 'agent', 1, 1)")
  db.exec("INSERT INTO host_processes VALUES ('p1', 123, 123, 'Thu Oct 30 14:22:09 2026', 'hook', 's1', NULL, 'check.sh', 3)")
  db.exec("INSERT INTO host_processes VALUES ('p2', 124, NULL, 'Thu Oct 30 14:22:10 2026', 'git', NULL, NULL, 'git status', 4)")
  v8.close()
  return path
}

describe('SQLite 迁移 v9', () => {
  it('v8 库升级到 9：.backup-v8-*（0600）、原数据与登记行可读、新表 STRICT、lsp 可登记、plugins 可写', async () => {
    const path = await v8Database()
    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, onInvalidEntry: () => {} })
    onTestFinished(() => store.close())
    expect(SQLITE_SCHEMA_VERSION).toBeGreaterThanOrEqual(9)
    expect(store.migration).toMatchObject({ from: 8, to: SQLITE_SCHEMA_VERSION })
    const backup = store.migration.backupPath!
    expect(backup).toMatch(/coko\.db\.backup-v8-/)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)

    expect(await store.sessions.getSession('s1')).toMatchObject({ title: 'kept', thinkingLevel: 'high' })
    expect((await store.sessions.listEntries('s1')).map((e) => e.payload)).toEqual([{ text: 'from v8' }])
    expect(await store.processes.list()).toEqual([
      { id: 'p1', pid: 123, pgid: 123, startedAt: 'Thu Oct 30 14:22:09 2026', kind: 'hook', sessionId: 's1', jobId: null, command: 'check.sh', createdAt: 3 },
      { id: 'p2', pid: 124, pgid: null, startedAt: 'Thu Oct 30 14:22:10 2026', kind: 'git', sessionId: null, jobId: null, command: 'git status', createdAt: 4 },
    ])
    await store.processes.register({ id: 'p3', pid: 125, pgid: 125, startedAt: 'x', kind: 'lsp', command: 'tsserver --stdio' })
    expect((await store.processes.list()).at(-1)).toMatchObject({ id: 'p3', kind: 'lsp' })
    await store.plugins.upsert({ name: 'sample', version: '1.0.0', sourceKind: 'dir', sourceLocation: '/s', path: '/h/plugins/sample', digest: 'd' })
    // 迁移前已有的 Memory 进入索引（rebuild）。
    expect((await store.memories.search('pnpm')).map((m) => m.id)).toEqual(['m1'])

    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      for (const table of ['plugins', 'host_processes']) expect(ddl(raw, table)).toMatch(/STRICT$/)
      expect(columns(raw, 'plugins')).toEqual([
        'name',
        'version',
        'source_kind',
        'source_location',
        'source_ref',
        'commit',
        'path',
        'digest',
        'approved_digest',
        'enabled',
        'installed_at',
        'updated_at',
      ])
      expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      raw.close()
    }
    const old = new DatabaseSync(backup, { readOnly: true })
    try {
      expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(8)
      expect(old.prepare('SELECT COUNT(*) AS n FROM host_processes').get()).toEqual({ n: 2 })
    } finally {
      old.close()
    }
  })

  it('FTS5 可用时建立 memories_fts，插入、更新与删除后索引同步，结果按相关度', async () => {
    const path = await v8Database()
    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
    onTestFinished(() => store.close())
    // Node 24 与 Electron 41 的 node:sqlite 都编译了 FTS5（electron-runtime.test.ts 记录）。
    expect(store.capabilities.fts5).toBe(true)
    const indexed = (term: string) => {
      const raw = new DatabaseSync(path, { readOnly: true })
      try {
        return (raw.prepare('SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?').all(`"${term}"`) as { rowid: number }[]).length
      } finally {
        raw.close()
      }
    }
    const once = await store.memories.create({ scope: 'user', content: 'deploy with docker', source: 'user' })
    const twice = await store.memories.create({ scope: 'user', content: 'docker docker compose for docker builds', source: 'user' })
    expect(indexed('docker')).toBe(2)
    expect((await store.memories.search('docker')).map((m) => m.id)).toEqual([twice.id, once.id])
    await store.memories.update(once.id, { content: 'deploy with podman' })
    expect(indexed('docker')).toBe(1)
    expect(indexed('podman')).toBe(1)
    await store.memories.delete(twice.id)
    expect(indexed('docker')).toBe(0)
    expect(await store.memories.search('docker')).toEqual([])
  })

  it('fts: false（COKO_TEST_NO_FTS）时检索走 LIKE：语义相同，按 updatedAt 倒序', async () => {
    const path = await v8Database()
    let clock = 10
    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, fts: false, now: () => clock })
    onTestFinished(() => store.close())
    expect(store.capabilities.fts5).toBe(false)
    const a = await store.memories.create({ scope: 'user', content: 'Docker docker docker', source: 'user' })
    clock = 20
    const b = await store.memories.create({ scope: 'user', content: 'uses DOCKER_HOST 50%_off', source: 'user' })
    expect((await store.memories.search('docker')).map((m) => m.id)).toEqual([b.id, a.id])
    // LIKE 的通配符按字面匹配。
    expect((await store.memories.search('50%_')).map((m) => m.id)).toEqual([b.id])
    expect(await store.memories.search('5%x')).toEqual([])
  })
})

// 迁移 v2 与恢复查询：未完成的 Run（有 run_start 而无其后同 runId 的 run_end）、每个 Session 某 kind 的最后一条条目。
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPayloadRegistry, type PayloadDefinition } from '@coko/session'
import { openSqliteStore, SQLITE_SCHEMA_VERSION, type SqliteStore } from '@coko/session/sqlite'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

const anyJson = { check: () => undefined }
const kinds: PayloadDefinition[] = ['run_start', 'run_end', 'message', 'note'].map((kind) => ({ kind, versions: [anyJson] }))
// run_end 第 2 版：v1 的 { state } 改名为 { status }，用来确认读回经过迁移。
const runEndV2: PayloadDefinition = {
  kind: 'run_end',
  versions: [
    anyJson,
    {
      check: (p) => (typeof p === 'object' && p !== null && 'status' in p ? undefined : 'expected status'),
      migrate: (p) => ({ status: (p as { state: string }).state }),
    },
  ],
}
const payloads = createPayloadRegistry(kinds)

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-recovery-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function open(path: string, registry = payloads): Promise<SqliteStore> {
  const store = await openSqliteStore({ path, payloads: registry })
  onTestFinished(() => store.close())
  return store
}

describe('SQLite 迁移 v2', () => {
  it('v1 库打开后为版本 2：迁移前备份 .backup-v1-*（0600），原有 Session 与条目可读，新增 (session_id, kind, seq) 索引', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    // 只含第 1 步迁移的库，即上一版程序写下的库。
    const v1 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 1), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v1.connection.db
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'kept', NULL, NULL, 1, 1)")
    db.exec(`INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '{"text":"from v1"}', NULL, 1)`)
    v1.close()

    const store = await open(path)
    expect(SQLITE_SCHEMA_VERSION).toBe(2)
    expect(store.migration).toMatchObject({ from: 1, to: 2 })
    const backup = store.migration.backupPath!
    expect(backup).toMatch(/coko\.db\.backup-v1-/)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)
    expect((await store.sessions.getSession('s1'))?.title).toBe('kept')
    expect((await store.sessions.listEntries('s1')).map((e) => e.payload)).toEqual([{ text: 'from v1' }])

    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      const columns = (raw.prepare("SELECT name FROM pragma_index_info('session_entries_by_kind')").all() as { name: string }[]).map((r) => r.name)
      expect(columns).toEqual(['session_id', 'kind', 'seq'])
    } finally {
      raw.close()
    }
    const old = new DatabaseSync(backup, { readOnly: true })
    try {
      expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    } finally {
      old.close()
    }
  })
})

describe('恢复查询', () => {
  it('listUnfinishedRuns：只返回有 run_start 而没有其后同 runId 的 run_end 的 Run，按 Session 与 seq 排序', async () => {
    const store = await open(join(await tempDir(), 'coko.db'))
    const workspace = await store.sessions.registerWorkspace({ path: '/w' })
    const a = await store.sessions.createSession({ workspaceId: workspace.id })
    const b = await store.sessions.createSession({ workspaceId: workspace.id })
    const c = await store.sessions.createSession({ workspaceId: workspace.id })
    await store.sessions.appendEntries(a.id, [
      { kind: 'run_start', runId: 'r1', payload: {} },
      { kind: 'run_end', runId: 'r1', payload: {} },
      { kind: 'run_start', runId: 'r2', payload: {} },
      { kind: 'message', runId: 'r2', payload: {} },
    ])
    await store.sessions.appendEntries(b.id, [
      { kind: 'run_start', runId: 'r3', payload: {} },
      { kind: 'run_end', runId: 'r3', payload: {} },
    ])
    // 另一 Run 的 run_end 不结束 r4；没有 runId 的 run_start 不是可恢复的 Run。
    await store.sessions.appendEntries(c.id, [
      { kind: 'run_start', runId: 'r4', payload: {} },
      { kind: 'run_end', runId: 'other', payload: {} },
      { kind: 'run_start', payload: {} },
    ])

    const unfinished = await store.recovery.listUnfinishedRuns()
    const expected = [
      { sessionId: a.id, runId: 'r2', startSeq: 3 },
      { sessionId: c.id, runId: 'r4', startSeq: 1 },
    ].sort((x, y) => (x.sessionId < y.sessionId ? -1 : 1))
    expect(unfinished).toEqual(expected)

    await store.sessions.appendEntries(a.id, [{ kind: 'run_end', runId: 'r2', payload: {} }])
    expect((await store.recovery.listUnfinishedRuns()).map((r) => r.runId)).toEqual(['r4'])
  })

  it('listLatestEntries：每个 Session 该 kind 的最后一条，payload 迁移到当前版本', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const first = await openSqliteStore({ path, payloads })
    const workspace = await first.sessions.registerWorkspace({ path: '/w' })
    const a = await first.sessions.createSession({ workspaceId: workspace.id })
    const b = await first.sessions.createSession({ workspaceId: workspace.id })
    await first.sessions.createSession({ workspaceId: workspace.id })
    await first.sessions.appendEntries(a.id, [
      { kind: 'run_end', runId: 'r1', payload: { state: 'completed' } },
      { kind: 'note', payload: {} },
      { kind: 'run_end', runId: 'r2', payload: { state: 'interrupted' } },
      { kind: 'note', payload: {} },
    ])
    await first.sessions.appendEntries(b.id, [{ kind: 'run_end', runId: 'r3', payload: { state: 'paused' } }])
    await first.close()

    const store = await open(path, createPayloadRegistry([...kinds.filter((k) => k.kind !== 'run_end'), runEndV2]))
    const latest = await store.recovery.listLatestEntries('run_end')
    expect(latest.map((e) => [e.sessionId, e.seq, e.runId, e.payloadVersion, e.payload]).sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1))).toEqual(
      [
        [a.id, 3, 'r2', 2, { status: 'interrupted' }],
        [b.id, 1, 'r3', 2, { status: 'paused' }],
      ].sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
    )
  })
})

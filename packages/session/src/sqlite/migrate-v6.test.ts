// 迁移 v6：区分 Session 的模型字段是“被清空”（Provider 被删除或升级时清除）还是“从未设置”。v4 留下墓碑（只清 model_id）的
// Session 视为被清空；按旧版 v4 已迁过的库没有墓碑，其中模型字段为空且有运行记录（message、run_start 或 run_end 条目；没有模型
// 不能开始 Run）的 Session 视为被清空。其余为从未设置。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

describe('SQLite 迁移 v6', () => {
  it('v4 墓碑与模型为空且运行过的 Session 标为被清空，墓碑被清掉；有模型或从未运行的不标；其余字段不变', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v6-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const v5 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 5), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v5.connection.db
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec(`INSERT INTO sessions VALUES
      ('ran-kept', 'w1', 'a', 'custom-provider-1', 'custom-model-1', 1, 5, 'high'),
      ('ran-cleared', 'w1', 'b', NULL, NULL, 1, 6, 'off'),
      ('ran-ended', 'w1', 'c', NULL, NULL, 1, 7, 'off'),
      ('never', 'w1', 'd', NULL, NULL, 1, 8, 'off'),
      ('tombstone', 'w1', 'e', NULL, NULL, 1, 9, 'off')`)
    // v4 清空时记下的 Session（设置过模型、从未运行）。
    db.exec("INSERT INTO model_cleared_sessions VALUES ('tombstone')")
    db.exec(`INSERT INTO session_entries (session_id, seq, kind, payload_version, payload, run_id, created_at) VALUES
      ('ran-kept', 1, 'message', 1, '{}', 'r1', 2),
      ('ran-cleared', 1, 'permission_mode', 1, '{}', NULL, 2),
      ('ran-cleared', 2, 'message', 1, '{}', 'r1', 3),
      ('ran-ended', 1, 'run_end', 1, '{}', 'r1', 3),
      ('never', 1, 'permission_mode', 1, '{}', NULL, 2)`)
    v5.close()

    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, onInvalidEntry: () => {} })
    onTestFinished(() => store.close())
    expect(store.migration).toMatchObject({ from: 5, to: 6 })
    const byId = Object.fromEntries((await store.sessions.listSessions()).map((s) => [s.id, s]))
    expect(byId['ran-kept']).toMatchObject({
      model: { providerId: 'custom-provider-1', modelId: 'custom-model-1' },
      thinkingLevel: 'high',
      modelCleared: false,
      updatedAt: 5,
    })
    expect(byId['ran-cleared']).toMatchObject({ model: null, modelCleared: true, updatedAt: 6 })
    expect(byId['ran-ended']).toMatchObject({ model: null, modelCleared: true, updatedAt: 7 })
    expect(byId['never']).toMatchObject({ model: null, modelCleared: false, updatedAt: 8 })
    expect(byId['tombstone']).toMatchObject({ model: null, modelCleared: true, updatedAt: 9 })
    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      expect(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'model_cleared_sessions'").get()).toEqual({ n: 0 })
    } finally {
      raw.close()
    }
  })

  it('按旧版 v4 迁过、没有 model_cleared_sessions 的库：只按运行记录标记', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v6-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const v5 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 5), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v5.connection.db
    db.exec('DROP TABLE model_cleared_sessions')
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec("INSERT INTO sessions VALUES ('ran', 'w1', 'a', NULL, NULL, 1, 5, 'off'), ('never', 'w1', 'b', NULL, NULL, 1, 6, 'off')")
    db.exec("INSERT INTO session_entries (session_id, seq, kind, payload_version, payload, run_id, created_at) VALUES ('ran', 1, 'message', 1, '{}', 'r1', 2)")
    v5.close()
    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS, onInvalidEntry: () => {} })
    onTestFinished(() => store.close())
    expect((await store.sessions.getSession('ran'))?.modelCleared).toBe(true)
    expect((await store.sessions.getSession('never'))?.modelCleared).toBe(false)
  })
})

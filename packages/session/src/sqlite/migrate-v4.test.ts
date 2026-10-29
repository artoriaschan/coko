// 迁移 v4（ADR 0010）：去掉 Provider kind、用户输入的 ID 作主键；不迁移旧数据。
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

describe('SQLite 迁移 v4', () => {
  it('v3 库打开后经过版本 4：先备份；旧 Provider、Credential 与默认模型被清除，Session 的模型字段为空，其余 Session、条目与设置可读', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v4-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    // 上一版程序（版本 3）写下的库：kind 列、随机 ID 的 Provider 与密文，Session 引用它，默认模型指向它。
    const v3 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 3), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    const db = v3.connection.db
    db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    db.exec("INSERT INTO providers VALUES ('7f3c-uuid', 'DeepSeek', 'deepseek', 'openai-completions', '', '[\"deepseek-flash\"]', 1, 1)")
    db.exec("INSERT INTO provider_credentials VALUES ('7f3c-uuid', X'0102', 'ab12', 1)")
    db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'uses old provider', '7f3c-uuid', 'deepseek-flash', 1, 5)")
    db.exec("INSERT INTO sessions VALUES ('s2', 'w1', 'no model', NULL, NULL, 2, 2)")
    db.exec(`INSERT INTO session_entries VALUES ('s1', 1, 'note', 1, '{"text":"kept"}', NULL, 1)`)
    db.exec(`INSERT INTO settings VALUES ('defaultModel', '{"providerId":"7f3c-uuid","modelId":"deepseek-flash"}', 2, 1)`)
    db.exec(`INSERT INTO settings VALUES ('theme', '"dark"', 1, 1)`)
    v3.close()

    const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
    onTestFinished(() => store.close())
    // 之后的迁移（v5 起）照常继续执行。
    expect(store.migration).toMatchObject({ from: 3, to: SQLITE_SCHEMA_VERSION })
    const backup = store.migration.backupPath!
    expect(backup).toMatch(/coko\.db\.backup-v3-/)
    expect((await stat(backup)).mode & 0o777).toBe(0o600)

    expect(await store.providers.list()).toEqual([])
    expect(await store.providers.getCredentialCiphertext('7f3c-uuid')).toBeUndefined()
    expect(await store.settings.get('defaultModel')).toBeUndefined()
    expect(await store.settings.get('theme')).toMatchObject({ value: 'dark', revision: 1 })
    // 模型字段为空，其余字段（含 updatedAt）不变；条目可读。
    expect(await store.sessions.getSession('s1')).toEqual({
      id: 's1',
      workspaceId: 'w1',
      title: 'uses old provider',
      model: null,
      thinkingLevel: 'off',
      createdAt: 1,
      updatedAt: 5,
    })
    expect((await store.sessions.getSession('s2'))?.title).toBe('no model')
    expect((await store.sessions.listEntries('s1')).map((e) => e.payload)).toEqual([{ text: 'kept' }])

    // 新表没有 kind 列；新库可按用户输入的 ID 创建 Provider 并保存密文。
    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      const columns = (raw.prepare("SELECT name FROM pragma_table_info('providers')").all() as { name: string }[]).map((r) => r.name)
      expect(columns).not.toContain('kind')
      expect(columns).toEqual(['id', 'name', 'api', 'base_url', 'models', 'created_at', 'updated_at'])
    } finally {
      raw.close()
    }
    const created = await store.providers.create({
      id: 'custom-provider-1',
      name: '一',
      api: 'openai-completions',
      baseUrl: 'https://a.example/v1',
      models: [],
    })
    await store.providers.setCredential(created.id, { ciphertext: new Uint8Array([3]), hint: 'cd34' })
    expect((await store.providers.list()).map((p) => [p.id, p.credential])).toEqual([['custom-provider-1', { hint: 'cd34' }]])

    // 备份保留旧数据，可供人工恢复。
    const old = new DatabaseSync(backup, { readOnly: true })
    try {
      expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3)
      expect(
        old
          .prepare('SELECT id, kind FROM providers')
          .all()
          .map((r) => ({ ...r })),
      ).toEqual([{ id: '7f3c-uuid', kind: 'deepseek' }])
    } finally {
      old.close()
    }
  })
})

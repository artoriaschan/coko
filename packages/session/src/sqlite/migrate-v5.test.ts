// 迁移 v5：Session 的 Thinking Level 与模型一起保存；已有 Session 为 off。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openSqliteStore } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

describe('SQLite 迁移 v5', () => {
  it('v4 库打开后已有 Session 的 Thinking Level 为 off、其余字段不变；之后写入的档位在重新打开后读回', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-migrate-v5-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'coko.db')
    const v4 = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 4), now: Date.now, leaseTtlMs: 30_000, heartbeatMs: 60_000, busyTimeoutMs: 1_000 })
    v4.connection.db.exec("INSERT INTO workspaces VALUES ('w1', '/w', 'w', 1)")
    v4.connection.db.exec("INSERT INTO sessions VALUES ('s1', 'w1', 'kept', 'custom-provider-1', 'custom-model-1', 1, 5)")
    v4.close()

    const first = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
    expect(first.migration).toMatchObject({ from: 4, to: 5 })
    expect(await first.sessions.getSession('s1')).toEqual({
      id: 's1',
      workspaceId: 'w1',
      title: 'kept',
      model: { providerId: 'custom-provider-1', modelId: 'custom-model-1' },
      thinkingLevel: 'off',
      createdAt: 1,
      updatedAt: 5,
    })
    await first.sessions.setSessionModel('s1', { providerId: 'custom-provider-1', modelId: 'custom-model-1' }, 'high')
    await first.close()

    const second = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
    onTestFinished(() => second.close())
    expect(await second.sessions.getSession('s1')).toMatchObject({ thinkingLevel: 'high' })
  })
})

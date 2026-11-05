import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { openSqliteStore, SQLITE_SCHEMA_VERSION } from '@coko/session/sqlite'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openDatabase } from './open.ts'
import { MIGRATIONS } from './schema.ts'

it('v12 Provider keeps the protocol default and later persists an explicit incremental-tools override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coko-v13-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.db')
  const old = await openDatabase({ path, migrations: MIGRATIONS.slice(0, 12), now: Date.now, leaseTtlMs: 30000, heartbeatMs: 60000, busyTimeoutMs: 1000 })
  old.connection.db.exec(
    "INSERT INTO providers (id,name,api,base_url,models,created_at,updated_at) VALUES ('old','Old','anthropic-messages','https://example.com','[]',10,20)",
  )
  old.close()
  const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  onTestFinished(() => store.close())
  expect(store.migration).toMatchObject({ from: 12, to: SQLITE_SCHEMA_VERSION })
  expect(await store.providers.get('old')).toMatchObject({ id: 'old', api: 'anthropic-messages', updatedAt: 20 })
  expect((await store.providers.get('old'))?.incrementalTools).toBeUndefined()
  await store.providers.update('old', { incrementalTools: false })
  expect((await store.providers.list())[0]?.incrementalTools).toBe(false)
  await store.close()
  const restarted = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  onTestFinished(() => restarted.close())
  expect((await restarted.providers.get('old'))?.incrementalTools).toBe(false)
  await restarted.providers.update('old', { incrementalTools: true })
  expect((await restarted.providers.get('old'))?.incrementalTools).toBe(true)
  await restarted.providers.update('old', { incrementalTools: undefined })
  expect((await restarted.providers.get('old'))?.incrementalTools).toBeUndefined()
})

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { StoreError } from '@coko/session'
import { openSqliteStore, SQLITE_SCHEMA_VERSION, type SqliteStore, type SqliteStoreOptions } from '@coko/session/sqlite'
import { createPayloadRegistry } from '@coko/session'
import { describeRepositoryContract } from '../repository-contract.ts'
import { docPayload, docPayloadV1, permissiveDefinitions, TEST_PAYLOADS } from '../test-payloads.ts'

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-session-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function openIn(dir: string, options: Partial<SqliteStoreOptions> = {}): Promise<SqliteStore> {
  const store = await openSqliteStore({ payloads: TEST_PAYLOADS, path: join(dir, 'coko.db'), ...options })
  onTestFinished(() => store.close())
  return store
}

async function openError(promise: Promise<unknown>): Promise<StoreError> {
  const error = await promise.then(
    (store) => {
      void (store as SqliteStore).close()
      return undefined
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(StoreError)
  return error as StoreError
}

function userVersion(path: string): number {
  const db = new DatabaseSync(path)
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  } finally {
    db.close()
  }
}

describeRepositoryContract('SQLite 实现', async (options) => {
  const dir = await mkdtemp(join(tmpdir(), 'coko-session-'))
  const store = await openSqliteStore({ path: join(dir, 'coko.db'), ...options })
  onTestFinished(async () => {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  })
  return store
})

describe('SQLite 打开与持久化', () => {
  it('库中不是七档之一的 Thinking Level 读回为 off', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const first = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
    const workspace = await first.sessions.registerWorkspace({ path: '/w' })
    const session = await first.sessions.createSession({ workspaceId: workspace.id, model: { providerId: 'p', modelId: 'm' }, thinkingLevel: 'high' })
    await first.close()
    const raw = new DatabaseSync(path)
    raw.prepare("UPDATE sessions SET thinking_level = 'turbo' WHERE id = ?").run(session.id)
    raw.close()
    const store = await openIn(dir)
    expect((await store.sessions.getSession(session.id))?.thinkingLevel).toBe('off')
  })

  it('新库以 0600 创建并迁移到当前版本，无需备份', async () => {
    const dir = await tempDir()
    const store = await openIn(dir)
    expect(store.migration).toEqual({ from: 0, to: SQLITE_SCHEMA_VERSION, backupPath: null })
    expect((await stat(join(dir, 'coko.db'))).mode & 0o777).toBe(0o600)
  })

  it('升级程序后重新打开：旧版本写入的 payload 读回为迁移后的当前版本，迁移后不合格的行跳过但保留在库中', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const old = await openSqliteStore({ path, payloads: createPayloadRegistry([...permissiveDefinitions, docPayloadV1]) })
    const workspace = await old.sessions.registerWorkspace({ path: '/w' })
    const session = await old.sessions.createSession({ workspaceId: workspace.id })
    await old.sessions.appendEntries(session.id, [
      { kind: 'doc', payload: { text: 'written by v1' } },
      { kind: 'doc', payload: { text: '' } },
    ])
    await old.close()

    const skipped: number[] = []
    const upgraded = await openIn(dir, { payloads: createPayloadRegistry([...permissiveDefinitions, docPayload]), onInvalidEntry: (e) => skipped.push(e.seq) })
    expect((await upgraded.sessions.listEntries(session.id)).map((e) => [e.seq, e.payloadVersion, e.payload])).toEqual([[1, 2, { body: 'written by v1' }]])
    expect(skipped).toEqual([2])
    await upgraded.close()
    const raw = new DatabaseSync(path, { readOnly: true })
    try {
      expect(raw.prepare('SELECT seq, payload_version, payload FROM session_entries ORDER BY seq').all()).toEqual([
        { seq: 1, payload_version: 1, payload: '{"text":"written by v1"}' },
        { seq: 2, payload_version: 1, payload: '{"text":""}' },
      ])
    } finally {
      raw.close()
    }
  })

  it('关闭后重新打开，Workspace、Session、条目、设置与 Credential 密文读回一致，seq 继续递增', async () => {
    const dir = await tempDir()
    const first = await openSqliteStore({ payloads: TEST_PAYLOADS, path: join(dir, 'coko.db') })
    const workspace = await first.sessions.registerWorkspace({ path: '/work/coko' })
    const session = await first.sessions.createSession({ workspaceId: workspace.id, title: '重启读回', model: { providerId: 'p', modelId: 'm' } })
    const committed = await first.sessions.appendEntries(session.id, [
      { kind: 'user-message', payload: { text: '写一个文件' }, runId: 'r1' },
      { kind: 'tool-call', payload: { name: 'write', args: { path: 'a.txt' } }, runId: 'r1' },
    ])
    await first.sessions.appendEntries(session.id, [{ kind: 'tool-result', payload: { ok: true }, runId: 'r1' }])
    await first.settings.set('theme', 'dark', 0)
    const provider = await first.providers.create({
      id: 'custom-provider-1',
      name: 'P',
      api: 'openai-responses',
      baseUrl: 'https://x',
      models: [{ id: 'm', input: ['text', 'image'], thinkingLevels: [{ level: 'off' }] }],
    })
    const savedProvider = await first.providers.setCredential(provider.id, { ciphertext: new Uint8Array([9, 8, 7]), hint: '7777' })
    const savedSession = await first.sessions.getSession(session.id)
    await first.close()

    const second = await openIn(dir)
    expect(second.migration).toEqual({ from: SQLITE_SCHEMA_VERSION, to: SQLITE_SCHEMA_VERSION, backupPath: null })
    expect(await second.sessions.listWorkspaces()).toEqual([workspace])
    expect(await second.sessions.listSessions()).toEqual([savedSession])
    const entries = await second.sessions.listEntries(session.id)
    expect(entries.map((e) => [e.seq, e.kind])).toEqual([
      [1, 'user-message'],
      [2, 'tool-call'],
      [3, 'tool-result'],
    ])
    expect(entries.slice(0, 2)).toEqual(committed)
    expect((await second.sessions.appendEntries(session.id, [{ kind: 'assistant-message', payload: 'done' }]))[0]?.seq).toBe(4)
    expect(await second.settings.get('theme')).toMatchObject({ value: 'dark', revision: 1 })
    expect(await second.providers.list()).toEqual([savedProvider])
    expect((await second.providers.get(provider.id))?.credential).toEqual({ hint: '7777' })
    expect(Array.from((await second.providers.getCredentialCiphertext(provider.id)) ?? [])).toEqual([9, 8, 7])
  })
})

describe('SQLite 一次存储', () => {
  it('Credential 写入失败时整个事务回滚：Provider 新建与修改都不落库，原 Credential 不变', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const store = await openIn(dir)
    const input = { id: 'custom-provider-1', name: '一', api: 'openai-completions', baseUrl: 'https://a.example/v1', models: [{ id: 'm' }] }
    const existing = await store.providers.create({ ...input, id: 'custom-provider-0' }, { ciphertext: new Uint8Array([1]), hint: 'aaaa' })
    // 另一连接装一个让密文写入失败的触发器（模拟磁盘或约束错误发生在 Provider 写入之后）。
    const raw = new DatabaseSync(path)
    try {
      raw.exec(`CREATE TRIGGER fail_credential BEFORE INSERT ON provider_credentials WHEN NEW.hint = 'boom' BEGIN SELECT RAISE(ABORT, 'disk full'); END;
        CREATE TRIGGER fail_credential_update BEFORE UPDATE ON provider_credentials WHEN NEW.hint = 'boom' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`)
    } finally {
      raw.close()
    }
    await expect(store.providers.create(input, { ciphertext: new Uint8Array([2]), hint: 'boom' })).rejects.toThrow('disk full')
    await expect(store.providers.update(existing.id, { name: '改' }, { ciphertext: new Uint8Array([3]), hint: 'boom' })).rejects.toThrow('disk full')
    expect(await store.providers.list()).toEqual([existing])
    expect(Array.from((await store.providers.getCredentialCiphertext(existing.id)) ?? [])).toEqual([1])
  })
})

describe('SQLite 宿主租约', () => {
  it('第二个实例获取租约失败并得到 lease-held，第一个实例不受影响；关闭后可再次打开', async () => {
    const dir = await tempDir()
    const first = await openIn(dir)
    const error = await openError(openSqliteStore({ payloads: TEST_PAYLOADS, path: join(dir, 'coko.db') }))
    expect(error).toMatchObject({ code: 'lease-held', fatal: true })
    expect(error.details).toMatchObject({ pid: process.pid, instanceId: first.instanceId })

    await first.settings.set('k', 1, 0)
    await first.close()
    const second = await openIn(dir)
    expect(await second.settings.get('k')).toMatchObject({ value: 1 })
  })

  it('持有者心跳超过 TTL 时被接管，原实例之后的写入以 lease-lost 拒绝', async () => {
    const dir = await tempDir()
    const ttl = 30_000
    const holder = await openIn(dir, { now: () => 1_000, leaseTtlMs: ttl, heartbeatMs: 3_600_000 })

    await expect(
      openError(openSqliteStore({ payloads: TEST_PAYLOADS, path: join(dir, 'coko.db'), now: () => 1_000 + ttl - 1, leaseTtlMs: ttl })),
    ).resolves.toMatchObject({
      code: 'lease-held',
    })
    const taker = await openIn(dir, { now: () => 1_000 + ttl + 1, leaseTtlMs: ttl })

    const lost = await openError(holder.settings.set('k', 'old', 0))
    expect(lost).toMatchObject({ code: 'lease-lost', fatal: true })
    await expect(holder.sessions.listWorkspaces()).rejects.toMatchObject({ code: 'lease-lost' })
    expect(await taker.settings.get('k')).toBeUndefined()
    await taker.settings.set('k', 'new', 0)
  })
})

describe('SQLite 损坏隔离与版本检查', () => {
  it('非数据库文件被改名隔离并返回 fatal corrupt，不重建', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const garbage = Buffer.from('not a sqlite database '.repeat(300))
    await writeFile(path, garbage)

    const error = await openError(openSqliteStore({ payloads: TEST_PAYLOADS, path }))
    expect(error).toMatchObject({ code: 'corrupt', fatal: true })
    const quarantined = error.details.quarantinedTo as string
    expect(quarantined.startsWith(join(dir, 'coko.db.corrupt-'))).toBe(true)
    expect(await readFile(quarantined)).toEqual(garbage)
    expect(existsSync(path)).toBe(false)
  })

  it('页面损坏的库在快速检查失败后被隔离', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const store = await openSqliteStore({ payloads: TEST_PAYLOADS, path })
    const workspace = await store.sessions.registerWorkspace({ path: '/w' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id })
    await store.sessions.appendEntries(
      session.id,
      Array.from({ length: 500 }, (_, i) => ({ kind: 'note', payload: `entry ${i} `.repeat(20) })),
    )
    await store.close()
    expect(existsSync(`${path}-wal`)).toBe(false)

    const bytes = await readFile(path)
    // 保留第 1 页（库头与 schema），之后的页全部写坏。
    bytes.fill(0xab, 4096)
    await writeFile(path, bytes)

    const error = await openError(openSqliteStore({ payloads: TEST_PAYLOADS, path }))
    expect(error).toMatchObject({ code: 'corrupt', fatal: true })
    expect(await readFile(error.details.quarantinedTo as string)).toEqual(bytes)
    expect(existsSync(path)).toBe(false)
  })

  it('租约由存活的其他实例持有时，即使快速检查会失败也报告 lease-held，不隔离、不改动文件', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    const store = await openSqliteStore({ payloads: TEST_PAYLOADS, path })
    const workspace = await store.sessions.registerWorkspace({ path: '/w' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id })
    await store.sessions.appendEntries(
      session.id,
      Array.from({ length: 500 }, (_, i) => ({ kind: 'note', payload: `entry ${i} `.repeat(20) })),
    )
    await store.close()
    // 模拟仍在运行的另一实例：本进程 pid、刚刚的心跳。
    const raw = new DatabaseSync(path)
    raw
      .prepare('INSERT INTO host_lease (id, instance_id, pid, acquired_at, heartbeat_at) VALUES (1, ?, ?, ?, ?)')
      .run('other', process.pid, Date.now(), Date.now())
    raw.close()
    expect(existsSync(`${path}-wal`)).toBe(false)

    const bytes = await readFile(path)
    // 只写坏条目数据所在的末尾页；库头、schema 与租约表所在的前部页保持完好。
    bytes.fill(0xab, bytes.length - 4096 * 8)
    await writeFile(path, bytes)
    // 前置：快速检查确实失败（报告问题或直接报 malformed）。
    const check = new DatabaseSync(path, { readOnly: true })
    let healthy: boolean
    try {
      healthy = (check.prepare('PRAGMA quick_check').all() as { quick_check: string }[]).every((r) => r.quick_check === 'ok')
    } catch {
      healthy = false
    } finally {
      check.close()
    }
    expect(healthy).toBe(false)

    const error = await openError(openSqliteStore({ payloads: TEST_PAYLOADS, path }))
    expect(error).toMatchObject({ code: 'lease-held', fatal: true, details: { instanceId: 'other', pid: process.pid } })
    expect(await readFile(path)).toEqual(bytes)
    expect((await readdir(dir)).filter((name) => name.includes('.corrupt-'))).toEqual([])
  })

  it('库版本高于程序支持版本时拒绝打开，库文件逐字节不变', async () => {
    const dir = await tempDir()
    const path = join(dir, 'coko.db')
    await (await openSqliteStore({ payloads: TEST_PAYLOADS, path })).close()
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`)
    db.close()
    const before = await readFile(path)

    const error = await openError(openSqliteStore({ payloads: TEST_PAYLOADS, path }))
    expect(error).toMatchObject({ code: 'version-too-new', fatal: true })
    expect(error.details).toMatchObject({ version: SQLITE_SCHEMA_VERSION + 1, supported: SQLITE_SCHEMA_VERSION })
    expect((await readFile(path)).equals(before)).toBe(true)
    expect(userVersion(path)).toBe(SQLITE_SCHEMA_VERSION + 1)
  })
})

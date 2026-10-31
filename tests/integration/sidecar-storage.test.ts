// ADR 0003 经协议的证据：损坏库隔离、版本过高拒绝（库文件逐字节不变）、读取时跳过不合格条目。
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, spawnSidecar, startSidecar, tempDir } from './sidecar-harness.ts'

describe('Sidecar 存储的启动失败与损坏条目', () => {
  it('损坏库启动 → fatal storage-corrupt 并以 1 退出，原文件被改名隔离且内容不变', async () => {
    const dirs = await sidecarDirs()
    await mkdir(dirs.dataDir, { recursive: true })
    const db = join(dirs.dataDir, 'coko.db')
    const garbage = Buffer.from('definitely not sqlite '.repeat(400))
    await writeFile(db, garbage)

    const proc = spawnSidecar({ dirs })
    expect(await proc.waitMessage('fatal')).toMatchObject({ code: 'storage-corrupt' })
    expect((await proc.exited).code).toBe(1)
    expect(proc.messages.some((m) => m.type === 'ready')).toBe(false)
    const quarantined = (await readdir(dirs.dataDir)).filter((name) => name.startsWith('coko.db.corrupt-') && !name.endsWith('-wal') && !name.endsWith('-shm'))
    expect(quarantined).toHaveLength(1)
    expect((await readFile(join(dirs.dataDir, quarantined[0]!))).equals(garbage)).toBe(true)
    expect(existsSync(db)).toBe(false)
  })

  it('库版本高于程序支持版本 → fatal storage-version-too-new，库文件逐字节不变', async () => {
    const dirs = await sidecarDirs()
    const first = await startSidecar({ dirs })
    expect(await first.stop()).toEqual({ code: 0, signal: null })
    const db = join(dirs.dataDir, 'coko.db')
    const raw = new DatabaseSync(db)
    const supported = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    raw.exec(`PRAGMA user_version = ${supported + 1}`)
    raw.close()
    const before = await readFile(db)

    const proc = spawnSidecar({ dirs })
    expect(await proc.waitMessage('fatal')).toMatchObject({ code: 'storage-version-too-new' })
    expect((await proc.exited).code).toBe(1)
    expect((await readFile(db)).equals(before)).toBe(true)
  })

  it('库中不合格的条目读取时被跳过并记 warn，其余条目照常返回，库中保留', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [{ content: 'fine' }] })
    const first = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(first)
    const api = client(first, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: root })
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    const live = await connect(first, cookie)
    live.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await live.waitFor((m) => m.type === 'subscribed')
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hi' })
    await live.waitFor(isRunEnd(sessionId))
    const good = (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
    expect(good.map((e) => e.kind)).toEqual(['permission_mode', 'run_start', 'message', 'message', 'model_request', 'run_end'])
    expect(await first.stop()).toEqual({ code: 0, signal: null })

    const db = join(dirs.dataDir, 'coko.db')
    const raw = new DatabaseSync(db)
    const insert = raw.prepare(
      'INSERT INTO session_entries (session_id, seq, kind, payload_version, payload, run_id, created_at) VALUES (?, ?, ?, 1, ?, NULL, 1)',
    )
    insert.run(sessionId, good.length + 1, 'message', JSON.stringify({ role: 'assistant', note: 'missing content' }))
    insert.run(sessionId, good.length + 2, 'kind_from_the_future', JSON.stringify({}))
    raw.close()

    const second = await startSidecar({ dirs })
    const secondApi = client(second, await exchange(second))
    const detail = await secondApi.get(apiPaths.session(sessionId))
    expect(detail.status).toBe(200)
    expect(detail.body.entries).toEqual(good)
    expect(await second.stop()).toEqual({ code: 0, signal: null })

    const log = await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')
    const skipped = log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { message?: string; level?: string; properties?: Record<string, unknown> })
      .filter((line) => line.message === 'session entry skipped')
    expect(skipped.map((line) => [line.properties?.seq, line.properties?.kind])).toEqual([
      [good.length + 1, 'message'],
      [good.length + 2, 'kind_from_the_future'],
    ])
    expect(log).not.toContain('missing content')
    const check = new DatabaseSync(db, { readOnly: true })
    try {
      expect((check.prepare('SELECT COUNT(*) AS n FROM session_entries WHERE session_id = ?').get(sessionId) as { n: number }).n).toBe(good.length + 2)
    } finally {
      check.close()
    }
  })
})

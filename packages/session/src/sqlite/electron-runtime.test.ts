// 产品运行时是 Electron 内置 Node（与开发机 Node 的 SQLite 版本不同）：以 ELECTRON_RUN_AS_NODE=1 启动真实子进程验证打开与租约。
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const electronPath = createRequire(import.meta.url)('electron') as string
const fixture = fileURLToPath(new URL('./electron-fixture.ts', import.meta.url))

interface Proc {
  child: ChildProcess
  /** 等待下一行 JSON 输出。 */
  next(): Promise<Record<string, unknown>>
  exited: Promise<number | null>
}

function start(mode: string, dbPath: string): Proc {
  const child = spawn(electronPath, [fixture, mode, dbPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const lines: string[] = []
  const waiters: ((line: string | undefined) => void)[] = []
  const rl = createInterface({ input: child.stdout! })
  rl.on('line', (line) => (waiters.shift() ?? ((l: string | undefined) => void lines.push(l!)))(line))
  rl.on('close', () => waiters.splice(0).forEach((w) => w(undefined)))
  return {
    child,
    exited,
    next: () =>
      new Promise((resolve, reject) => {
        const handle = (line: string | undefined) =>
          line === undefined ? reject(new Error(`fixture exited without output; stderr:\n${stderr}`)) : resolve(JSON.parse(line) as Record<string, unknown>)
        const queued = lines.shift()
        if (queued !== undefined) handle(queued)
        else waiters.push(handle)
      }),
  }
}

async function run(mode: string, dbPath: string): Promise<{ output: Record<string, unknown>; code: number | null }> {
  const proc = start(mode, dbPath)
  const output = await proc.next()
  return { output, code: await proc.exited }
}

async function tempDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-electron-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'coko.db')
}

describe('Electron 内置 Node 中的 SQLite 存储', { timeout: 60_000 }, () => {
  it('一个进程提交后，另一个进程重新打开读回相同条目与 seq；记录 FTS5 可用', async () => {
    const db = await tempDb()
    const written = await run('write', db)
    expect(written.code).toBe(0)
    expect(written.output.versions).toEqual({ electron: '41.0.3', node: '24.14.0', sqlite: '3.51.2' })
    // 2026-10-28 实测：Electron 41.0.3 的 node:sqlite 编译了 FTS5。升级 Electron 后若变化，此断言提示更新文档。
    expect(written.output.fts5).toBe(true)

    const read = await run('read', db)
    expect(read.code).toBe(0)
    expect(read.output.entries).toEqual(written.output.entries)
    expect((read.output.entries as { seq: number }[]).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('持有租约的进程运行时，第二个进程得到 fatal lease-held；持有者正常关闭后可再打开', async () => {
    const db = await tempDb()
    const holder = start('hold', db)
    const ready = await holder.next()
    expect(ready).toMatchObject({ ready: true })

    const second = await run('read', db)
    expect(second.code).toBe(2)
    expect(second.output.error).toMatchObject({ code: 'lease-held', fatal: true, details: { pid: ready.pid, instanceId: ready.instanceId } })

    holder.child.stdin?.end()
    expect(await holder.next()).toEqual({ closed: true })
    expect(await holder.exited).toBe(0)
    expect((await run('read', db)).code).toBe(0)
  })

  it('持有者被 SIGKILL 后，新进程不必等待 TTL 即接管租约', async () => {
    const db = await tempDb()
    const holder = start('hold', db)
    expect(await holder.next()).toMatchObject({ ready: true })
    holder.child.kill('SIGKILL')
    await holder.exited

    const next = await run('read', db)
    expect(next.output.error).toBeUndefined()
    expect(next.code).toBe(0)
  })
})

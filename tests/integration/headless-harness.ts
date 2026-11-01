// 无界面运行（apps/server/src/headless，ADR 0019）的集成测试 harness：以 ELECTRON_RUN_AS_NODE=1 运行源码入口，收集 stdout、stderr 与退出码；
// 读回库中的条目（node:sqlite，只读）。headless、headless-approvals 与 secrets-gate-headless 共用。
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { onTestFinished } from 'vitest'
import type { SidecarDirs } from './sidecar-harness.ts'

const electronPath = createRequire(import.meta.url)('electron') as string
export const headlessEntry = fileURLToPath(new URL('../../apps/server/src/headless/index.ts', import.meta.url))

export interface HeadlessRun {
  readonly child: ChildProcess
  stdout(): string
  stderr(): string
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

/** 启动 headless；环境只有 PATH、HOME、COKO_HOME 与 extra（不继承宿主的凭据变量）。 */
export function spawnHeadless(dirs: SidecarDirs, args: string[], env: Record<string, string> = {}, entry = headlessEntry): HeadlessRun {
  const child = spawn(electronPath, [entry, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_RUN_AS_NODE: '1', COKO_HOME: dirs.cokoHome, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  let stdout = ''
  let stderr = ''
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  return { child, stdout: () => stdout, stderr: () => stderr, exited }
}

/** 运行到退出。 */
export async function runHeadless(dirs: SidecarDirs, args: string[], env: Record<string, string> = {}) {
  const run = spawnHeadless(dirs, args, env)
  const { code, signal } = await run.exited
  return { code, signal, stdout: run.stdout(), stderr: run.stderr() }
}

/** 基本参数：--data-dir 与 --log-dir 取自 dirs。 */
export const baseArgs = (dirs: SidecarDirs, ...rest: string[]) => ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, ...rest]

export const lines = (stdout: string) =>
  stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

export interface Row {
  session_id: string
  seq: number
  kind: string
  run_id: string | null
  payload: Record<string, unknown>
}

/** 库中的条目（按 Session 与 seq）。 */
export function dbEntries(dirs: SidecarDirs, sessionId?: string): Row[] {
  const path = join(dirs.dataDir, 'coko.db')
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = (
      sessionId
        ? db.prepare('SELECT session_id, seq, kind, run_id, payload FROM session_entries WHERE session_id = ? ORDER BY seq').all(sessionId)
        : db.prepare('SELECT session_id, seq, kind, run_id, payload FROM session_entries ORDER BY session_id, seq').all()
    ) as (Omit<Row, 'payload'> & { payload: string })[]
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) as Record<string, unknown> }))
  } finally {
    db.close()
  }
}

/** 库中的一张表（只读）。 */
export function dbRows(dirs: SidecarDirs, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
  try {
    return db.prepare(sql).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

/** headless 的日志（<log-dir>/headless.jsonl）。 */
export async function headlessLog(dirs: SidecarDirs): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  const path = join(dirs.logDir, 'headless.jsonl')
  if (!existsSync(path)) return []
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

// 子进程登记与孤儿清理（ADR 0012）：真实 Sidecar（faux）+ 前台 bash 的 sleep 300 + 经 .mcp.json 批准、忽略 stdin 关闭的 stdio MCP 测试 Server。
// SIGKILL Sidecar 后以同一数据目录重启：两者在 5 秒内消失（轮询进程表）；lstart 不符的登记只删行；有序关闭后登记表为空。
// 依赖 `ps -o lstart=` 与进程组信号，只在 darwin 验证；其他平台显式跳过。本文件不新增文件读取根或注入点（无符号链接用例）。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, type McpResponse } from '@coko/protocol'
import { stubbornStdioServerEntry } from '../fixtures/mcp/index.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  killAndRestart,
  processExists,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitProcessesGone,
  type SidecarDirs,
} from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'

/** 测试结束时终止记录的进程组与 pid（只针对本测试启动或读到的 pid）。 */
function reap(...targets: number[]): void {
  onTestFinished(() => {
    for (const pid of targets)
      for (const target of [-pid, pid])
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          // 已退出。
        }
  })
}

type Row = { id: string; pid: number; pgid: number | null; kind: string; session_id: string | null; command: string }

function rows(dirs: SidecarDirs): Row[] {
  const path = join(dirs.dataDir, 'coko.db')
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT id, pid, pgid, kind, session_id, command FROM host_processes ORDER BY created_at').all() as Row[]
  } finally {
    db.close()
  }
}

async function logRecords(dirs: SidecarDirs): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  return (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

const readPid = async (path: string) => Number((await readFile(path, 'utf8').catch(() => '')).trim())

/**
 * 启动 Sidecar（full-access），批准 Workspace 中 .mcp.json 的 stubborn Server 并等它连接，再让 faux 模型调用前台 bash：
 * shell 写出自己与 sleep 300 的 pid 后等待。等到两个 pid 都出现、登记表有 bash 与 mcp 两行后返回。
 */
async function runningProcesses(root: string, dirs: SidecarDirs, env: Record<string, string>) {
  const sidecar = await startSidecar({ dirs, env })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const mcpLog = join(root, 'stubborn.jsonl')
  await writeFile(
    join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { stubborn: { command: process.execPath, args: [stubbornStdioServerEntry], env: { MCP_FIXTURE_LOG: mcpLog } } } }),
  )
  const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body as { id: string }
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)

  const pending = ((await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse).servers.find((s) => s.name === 'stubborn')!
  expect(pending.status).toBe('pending-approval')
  const approved = await api.post(mcpPaths.approvals, { workspaceId: workspace.id, name: 'stubborn', digest: pending.approval!.digest, approve: true })
  expect(approved.status).toBe(200)
  await expect
    .poll(async () => ((await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse).servers.find((s) => s.name === 'stubborn')?.status, {
      timeout: 20_000,
    })
    .toBe('connected')
  const starts = (await readFile(mcpLog, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; pid: number })
  const mcp = starts.find((e) => e.event === 'start')!.pid
  reap(mcp)

  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })).status).toBe(202)
  let shell = 0
  let sleep = 0
  await expect
    .poll(
      async () => {
        shell = await readPid(join(root, 'shell.pid'))
        sleep = await readPid(join(root, 'sleep.pid'))
        return shell > 0 && sleep > 0
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  reap(shell, sleep)
  await expect
    .poll(
      () =>
        rows(dirs)
          .map((r) => r.kind)
          .sort(),
      { timeout: 10_000 },
    )
    .toEqual(['bash', 'mcp'])
  const registered = rows(dirs)
  expect(registered.find((r) => r.kind === 'bash')).toMatchObject({ pid: shell, pgid: shell })
  expect(registered.find((r) => r.kind === 'mcp')).toMatchObject({ pid: mcp, pgid: null, command: process.execPath })
  expect([shell, sleep, mcp].every(processExists)).toBe(true)
  return { sidecar, shell, sleep, mcp }
}

async function setup() {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const command = `echo $$ > ${join(root, 'shell.pid')}; sleep 300 & echo $! > ${join(root, 'sleep.pid')}; wait`
  const script = await fauxScript(root, { responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command } }] }] })
  return { root, dirs, env: { COKO_FAUX_SCRIPT: script } }
}

describe.skipIf(!darwin)('子进程登记与孤儿清理（darwin）', { timeout: 120_000 }, () => {
  it('SIGKILL Sidecar 后重启：前台 bash 的进程组与忽略 stdin 关闭的 MCP Server 在 5 秒内消失，日志 orphan process terminated', async () => {
    const { root, dirs, env } = await setup()
    const { sidecar, shell, sleep, mcp } = await runningProcesses(root, dirs, env)

    const restarted = await killAndRestart(sidecar, { dirs, env })
    await waitProcessesGone([shell, sleep, mcp], 5_000)
    expect(rows(dirs).filter((r) => r.pid === shell || r.pid === mcp)).toEqual([])
    // 文件日志有缓冲：有序关闭后读取。
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
    const terminated = (await logRecords(dirs)).filter((r) => r.message === 'orphan process terminated').map((r) => r.properties)
    expect(terminated).toEqual(
      expect.arrayContaining([expect.objectContaining({ pid: shell, kind: 'bash' }), expect.objectContaining({ pid: mcp, kind: 'mcp' })]),
    )
  })

  it('预先写入 lstart 不符的登记（pid 为仍在运行的无关进程）：重启后该进程仍在，行被删除', async () => {
    const { dirs } = await setup()
    // 先启动一次建好 v7 库。
    const first = await startSidecar({ dirs })
    expect(await first.stop()).toEqual({ code: 0, signal: null })

    const unrelated = spawn('/bin/sleep', ['300'], { detached: true, stdio: 'ignore' })
    unrelated.unref()
    const pid = unrelated.pid!
    reap(pid)
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'))
    try {
      db.prepare(
        'INSERT INTO host_processes (id, pid, pgid, started_at, kind, session_id, job_id, command, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('forged', pid, pid, 'Thu Jan  1 00:00:00 2026', 'bash', null, null, 'sleep 300', Date.now())
    } finally {
      db.close()
    }

    const sidecar = await startSidecar({ dirs })
    expect(rows(dirs)).toEqual([])
    expect(processExists(pid)).toBe(true)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(processExists(pid)).toBe(true)
    const records = await logRecords(dirs)
    expect(records.find((r) => r.message === 'stale process registration removed')?.properties).toMatchObject({ pid, kind: 'bash', reason: 'pid-reused' })
    expect(records.some((r) => r.message === 'orphan process terminated')).toBe(false)
  })

  it('有序关闭（shutdown 消息）后登记表为空，前台 bash 的进程组与 MCP Server 已退出', async () => {
    const { root, dirs, env } = await setup()
    const { sidecar, shell, sleep, mcp } = await runningProcesses(root, dirs, env)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(rows(dirs)).toEqual([])
    await waitProcessesGone([shell, sleep, mcp], 5_000)
  })
})

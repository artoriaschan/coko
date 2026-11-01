// 语言服务器进程的生命周期：真实 Sidecar（faux）与仓库内的 LSP 假服务器。登记为 kind lsp（host_processes）；空闲关闭（COKO_TEST_LSP_IDLE_MS）后
// 登记删除；崩溃后下一次查询重启，连续 3 次失败为 failed，POST /api/lsp/restart 后恢复；超过 4 个时关闭最久未用的；Sidecar 关闭时进程退出；
// SIGKILL Sidecar 后重启清理孤儿（darwin）。状态变化经 lsp_update 推送。
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, lspPaths, permissionPaths, type LspResponse, type LspServerStatus } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  lspFixturePath,
  pollUntil,
  processExists,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitProcessesGone,
  type Sidecar,
  type SidecarDirs,
  type SpawnOptions,
} from './sidecar-harness.ts'

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const hover = (id: string, file = 'a.ts') => ({ content: [call(id, 'lsp', { operation: 'hover', file_path: file, line: 1, character: 1 })] })

type Row = { pid: number; pgid: number | null; kind: string; command: string }
function lspRows(dirs: SidecarDirs): Row[] {
  const path = join(dirs.dataDir, 'coko.db')
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return (db.prepare('SELECT pid, pgid, kind, command FROM host_processes ORDER BY created_at').all() as Row[]).filter((r) => r.kind === 'lsp')
  } finally {
    db.close()
  }
}

/** 本测试启动的语言服务器在用例结束时一律 SIGKILL（只针对记录到的 pid）。 */
function reap(pids: Set<number>) {
  onTestFinished(() => {
    for (const pid of pids)
      for (const target of [-pid, pid])
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          // 已退出。
        }
  })
}

/**
 * 包装脚本：mode 文件为 crash 时以 --crash-after 1 运行假服务器（回答 initialize 后退出），否则照常；其余参数原样交给假服务器。
 */
async function flakyServer(dir: string) {
  const script = join(dir, 'flaky.mjs')
  const mode = join(dir, 'mode')
  await writeFile(mode, 'crash')
  await writeFile(
    script,
    `import { readFileSync } from 'node:fs'
const mode = readFileSync(${JSON.stringify(mode)}, 'utf8').trim()
if (mode === 'crash') process.argv.push('--crash-after', '1')
await import(${JSON.stringify(pathToFileURL(lspFixturePath).href)})
`,
  )
  return { script, mode }
}

async function boot(root: string, responses: unknown[], env: Record<string, string> = {}, dirs?: SidecarDirs) {
  const own = dirs ?? (await sidecarDirs())
  const script = await fauxScript(root, { responses }, `.faux-${Math.random().toString(36).slice(2)}.json`)
  const options: SpawnOptions = { dirs: own, env: { COKO_FAUX_SCRIPT: script, ...env } }
  const sidecar = await startSidecar(options)
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
  const send = async (text: string) => {
    const before = runEnds()
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
    await stream.waitFor(() => runEnds() > before, 30_000)
  }
  const result = (id: string) => {
    const entry = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === id)
    if (!entry) throw new Error(`no tool result ${id}`)
    const payload = entry.payload as { isError: boolean; content: { text?: string }[] }
    return { isError: payload.isError, text: payload.content.map((c) => c.text ?? '').join('') }
  }
  const status = async () => ((await api.get(lspPaths.status(sessionId))).body as LspResponse).status
  const updates = () =>
    stream.messages.flatMap((m) => (m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'lsp_update' ? [m.event.servers] : []))
  const putServers = async (servers: Record<string, unknown>) => {
    const revision = ((await api.get(lspPaths.lsp)).body as LspResponse).global.revision
    expect((await api.put(lspPaths.lsp, { scope: 'global', servers, expectedRevision: revision })).status).toBe(200)
  }
  return { dirs: own, sidecar, api, stream, sessionId, send, result, status, updates, putServers }
}

const fixtureServer = (args: string[], ext = '.ts') => ({
  command: process.execPath,
  args: [lspFixturePath, ...args],
  extensionToLanguage: { [ext]: 'typescript' },
})
const initializeCount = async (record: string) =>
  (await readFile(record, 'utf8').catch(() => '')).split('\n').filter((line) => line.includes('"method":"initialize"')).length

describe('语言服务器进程', { timeout: 120_000 }, () => {
  it('登记 kind lsp；空闲关闭后进程退出、登记删除，lsp_update 推送 running → idle；下一次查询重新启动', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    const record = join(root, 'rec.jsonl')
    const h = await boot(root, [hover('h1'), { content: 'one' }, hover('h2'), { content: 'two' }], { COKO_TEST_LSP_IDLE_MS: '1500' })
    await h.putServers({ ts: fixtureServer(['--record', record, '--hover', 'ok']) })
    const pids = new Set<number>()
    reap(pids)

    await h.send('first')
    expect(h.result('h1').text).toBe('ok')
    const running = (await h.status())[0]!
    expect(running).toMatchObject({ name: 'ts', state: 'running', pid: expect.any(Number) })
    pids.add(running.pid!)
    const rows = await pollUntil(() => (lspRows(h.dirs).length === 1 ? lspRows(h.dirs) : undefined), { timeoutMs: 5_000, what: 'lsp registration' })
    expect(rows![0]).toMatchObject({ pid: running.pid, pgid: running.pid, kind: 'lsp' })
    expect(rows![0]!.command).toContain(lspFixturePath)

    // 空闲关闭：进程退出、登记删除、状态回到 idle（推送与接口）。
    await waitProcessesGone([running.pid!], 10_000)
    await pollUntil(() => lspRows(h.dirs).length === 0, { timeoutMs: 5_000, what: 'registration removed' })
    await pollUntil(async () => (await h.status())[0]!.state === 'idle', { timeoutMs: 5_000, what: 'idle state' })
    const states = h.updates().map((servers) => servers[0]!.state)
    expect(states).toEqual(['starting', 'running', 'idle'])

    await h.send('second')
    expect(h.result('h2').text).toBe('ok')
    const again = (await h.status())[0]!
    pids.add(again.pid!)
    expect(again.pid).not.toBe(running.pid)
    expect(await initializeCount(record)).toBe(2)
  })

  it('--crash-after 1：下一次查询重启；连续 3 次失败后 failed，不再启动；POST /api/lsp/restart 后恢复', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    const record = join(root, 'rec.jsonl')
    const flaky = await flakyServer(root)
    const h = await boot(root, [hover('c1'), hover('c2'), hover('c3'), hover('c4'), { content: 'crashed' }, hover('ok'), { content: 'fine' }])
    await h.putServers({
      ts: { command: process.execPath, args: [flaky.script, '--record', record, '--hover', 'recovered'], extensionToLanguage: { '.ts': 'typescript' } },
    })

    await h.send('crash')
    for (const id of ['c1', 'c2', 'c3']) expect(h.result(id)).toMatchObject({ isError: true, text: expect.stringMatching(/exited/) })
    expect(h.result('c4')).toMatchObject({ isError: true, text: expect.stringContaining('failed 3 times in a row') })
    expect(h.result('c4').text).toContain('Restart it in Settings')
    // 三次查询各启动一次，第四次不再启动。
    expect(await initializeCount(record)).toBe(3)
    expect(await h.status()).toEqual([expect.objectContaining({ name: 'ts', state: 'failed', error: expect.stringMatching(/exited/) })])
    expect(h.updates().at(-1)![0]!.state).toBe('failed')
    await pollUntil(() => lspRows(h.dirs).length === 0, { timeoutMs: 5_000, what: 'registrations removed' })

    await writeFile(flaky.mode, 'ok')
    expect((await h.api.post(lspPaths.restart, { name: 'ts' })).status).toBe(204)
    const restarted = await pollUntil(async () => ((await h.status())[0]!.state === 'running' ? (await h.status())[0] : undefined), {
      timeoutMs: 10_000,
      what: 'running after restart',
    })
    const pids = new Set([restarted!.pid!])
    reap(pids)
    expect(restarted!.error).toBeUndefined()
    await h.send('again')
    expect(h.result('ok')).toMatchObject({ isError: false, text: 'recovered' })
    expect(await initializeCount(record)).toBe(4)
  })

  it('超过 4 个时关闭最久未用的；Sidecar 有序关闭时全部退出', async () => {
    const root = await tempDir()
    const exts = ['.a', '.b', '.c', '.d', '.e']
    for (const ext of exts) await writeFile(join(root, `f${ext}`), 'x\n')
    const h = await boot(root, [...exts.map((ext, i) => hover(`q${i}`, `f${ext}`)), { content: 'done' }])
    await h.putServers(Object.fromEntries(exts.map((ext) => [`s${ext.slice(1)}`, fixtureServer(['--hover', ext], ext)])))
    const pids = new Set<number>()
    reap(pids)
    await h.send('five')
    for (const [i, ext] of exts.entries()) expect(h.result(`q${i}`).text).toBe(ext)
    const byName = async (): Promise<Record<string, LspServerStatus>> => Object.fromEntries((await h.status()).map((s: LspServerStatus) => [s.name, s]))
    const final = (await pollUntil(async () => ((await byName()).sa!.state === 'idle' ? byName() : undefined), { timeoutMs: 10_000, what: 'oldest stopped' }))!
    expect(Object.values(final).map((s) => [s.name, s.state])).toEqual([
      ['sa', 'idle'],
      ['sb', 'running'],
      ['sc', 'running'],
      ['sd', 'running'],
      ['se', 'running'],
    ])
    const live = Object.values(final).flatMap((s) => (s.pid ? [s.pid] : []))
    for (const pid of live) pids.add(pid)
    expect(live).toHaveLength(4)
    await pollUntil(() => lspRows(h.dirs).length === 4, { timeoutMs: 5_000, what: 'four registrations' })

    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    await waitProcessesGone(live, 10_000)
    expect(lspRows(h.dirs)).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')('SIGKILL Sidecar 后语言服务器成为孤儿；重启时清理（进程组只在 darwin 上验证）', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    // 假服务器在 stdin 关闭时自己退出；包装脚本去掉该监听并保持运行，使 SIGKILL Sidecar 之后它成为真正的孤儿。
    const stubborn = join(root, 'stubborn.mjs')
    await writeFile(
      stubborn,
      `await import(${JSON.stringify(pathToFileURL(lspFixturePath).href)})\nprocess.stdin.removeAllListeners('end')\nsetInterval(() => {}, 1000)\n`,
    )
    const h = await boot(root, [hover('h1'), { content: 'one' }])
    await h.putServers({ ts: { command: process.execPath, args: [stubborn, '--hover', 'ok'], extensionToLanguage: { '.ts': 'typescript' } } })
    await h.send('first')
    expect(h.result('h1').text).toBe('ok')
    const pid = (await h.status())[0]!.pid!
    const pids = new Set([pid])
    reap(pids)
    await pollUntil(() => lspRows(h.dirs).length === 1, { timeoutMs: 5_000, what: 'registration' })

    h.sidecar.child.kill('SIGKILL')
    expect((await h.sidecar.exited).signal).toBe('SIGKILL')
    expect(processExists(pid)).toBe(true)
    const restarted: Sidecar = await startSidecar({ dirs: h.dirs, env: {} })
    await waitProcessesGone([pid], 10_000)
    expect(lspRows(h.dirs)).toEqual([])
    // 文件日志有缓冲：有序关闭后读取。
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
    const records = (await readFile(join(h.dirs.logDir, 'sidecar.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
    expect(records.filter((r) => r.message === 'orphan process terminated').map((r) => r.properties)).toEqual([expect.objectContaining({ pid, kind: 'lsp' })])
  })
})

// 子进程登记与孤儿清理（ADR 0012）：真实子进程与真实进程表（ps、kill），内存存储。断言外部事实：进程是否仍在、登记表的内容。
// 依赖 `ps -o lstart=` 与进程组信号；只在 darwin 运行（孤儿清理只在 darwin 验证），其他平台显式跳过。
import { spawn } from 'node:child_process'
import { createLocalExecPort } from '@coko/agent'
import { registerSecretValues, SECRET_REDACTED } from '@coko/logging'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it, onTestFinished } from 'vitest'
import { inspectProcess, parsePsLine, processAlive } from '../adapters/processes.ts'
import { ProcessRegistry } from './processes.ts'

const darwin = process.platform === 'darwin'

/** 启动一个 detached 的测试进程（自己的进程组），测试结束时按记录的 pid 终止其进程组。 */
function start(script: string): number {
  const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' })
  child.unref()
  const pid = child.pid!
  onTestFinished(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // 已退出。
    }
  })
  return pid
}

const store = () => createMemoryStore({ payloads: createPayloadRegistry([]) })
const alive = (pid: number) => processAlive({ pid })

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** sh 写出子进程 pid 后等待；返回 [sh, 子进程]。 */
async function startGroup(childCommand: string): Promise<[number, number]> {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'coko-proc-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'child.pid')
  const leader = start(`${childCommand} & echo $! > ${file}; wait`)
  let child = 0
  await waitFor(async () => {
    child = Number((await readFile(file, 'utf8').catch(() => '')).trim())
    return child > 0
  })
  return [leader, child]
}

describe('ps 输出', () => {
  it('lstart 五个字段与 pgid；空输出与非法 pgid 为 undefined', () => {
    expect(parsePsLine('Thu Oct 30 06:22:09 2026 41234\n')).toEqual({ startedAt: 'Thu Oct 30 06:22:09 2026', pgid: 41234 })
    expect(parsePsLine('  Mon Nov  3 10:01:02 2026   7 ')).toEqual({ startedAt: 'Mon Nov 3 10:01:02 2026', pgid: 7 })
    expect(parsePsLine('')).toBeUndefined()
    expect(parsePsLine('Thu Oct 30 06:22:09 2026 x')).toBeUndefined()
  })
})

describe.skipIf(!darwin)('ProcessRegistry（darwin：真实进程）', { timeout: 30_000 }, () => {
  it('登记：spawn 后写入 pid、进程组与 lstart；释放后删除；释放早于登记完成时也不留行', async () => {
    const s = store()
    const registry = new ProcessRegistry({ store: s })
    const pid = start('sleep 30')
    const release = registry.track({ pid, pgid: pid, kind: 'bash', sessionId: 's1', command: 'sleep 30' })
    await registry.flush()
    const [row] = await s.processes.list()
    expect(row).toMatchObject({ pid, pgid: pid, kind: 'bash', sessionId: 's1', jobId: null, command: 'sleep 30' })
    expect(row!.startedAt).toBe((await inspectProcess(pid))!.startedAt)
    release()
    release()
    await registry.flush()
    expect(await s.processes.list()).toEqual([])

    const other = start('sleep 30')
    registry.track({ pid: other, kind: 'mcp', command: 'node' })()
    await registry.flush()
    expect(await s.processes.list()).toEqual([])
    // 已退出的进程不登记。
    const gone = start('exit 0')
    await waitFor(() => !alive(gone))
    registry.track({ pid: gone, kind: 'bash', command: 'exit 0' })
    await registry.flush()
    expect(await s.processes.list()).toEqual([])
  })

  it('登记的命令文本经脱敏：登记的 Secret 值不入库', async () => {
    const secret = 'svc-secret-0123456789'
    onTestFinished(registerSecretValues(() => [secret]))
    const s = store()
    const registry = new ProcessRegistry({ store: s })
    const pid = start('sleep 30')
    registry.track({ pid, pgid: pid, kind: 'bash', command: `curl -H 'x: ${secret}' host` })
    await registry.flush()
    expect((await s.processes.list())[0]!.command).toBe(`curl -H 'x: ${SECRET_REDACTED}' host`)
  })

  it('trackExec：经端口启动的命令在运行期间有一行，结束后删除；请求自带的回调照常调用', async () => {
    const s = store()
    const registry = new ProcessRegistry({ store: s })
    const port = registry.trackExec(createLocalExecPort(), { kind: 'bash', sessionId: 's1' })
    const seen: string[] = []
    let during: unknown[] = []
    const outcome = await port.exec({
      command: 'sleep 0.5',
      cwd: process.cwd(),
      onData: () => undefined,
      onSpawn: ({ pid, pgid }) => seen.push(`spawn ${pid === pgid}`),
      onExit: () => seen.push('exit'),
    })
    expect(outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect(seen).toEqual(['spawn true', 'exit'])
    await registry.flush()
    expect(await s.processes.list()).toEqual([])

    const running = port.exec({ command: 'sleep 1', cwd: process.cwd(), onData: () => undefined })
    await waitFor(async () => (during = await s.processes.list()).length === 1)
    expect(during[0]).toMatchObject({ kind: 'bash', sessionId: 's1', command: 'sleep 1' })
    await running
    await registry.flush()
    expect(await s.processes.list()).toEqual([])
  })

  it('启动清理：身份一致的进程组被 SIGTERM（组内子进程一起退出），行被删除', async () => {
    const s = store()
    const [leader, child] = await startGroup('sleep 300')
    new ProcessRegistry({ store: s }).track({ pid: leader, pgid: leader, kind: 'bash', command: 'sleep 300' })
    await waitFor(async () => (await s.processes.list()).length === 1)

    const fresh = new ProcessRegistry({ store: s })
    expect(await fresh.cleanup()).toBe(1)
    await waitFor(() => !alive(leader) && !alive(child))
    expect(await s.processes.list()).toEqual([])
  })

  it('启动清理：忽略 SIGTERM 的进程在宽限期后被 SIGKILL', async () => {
    const s = store()
    const { mkdtemp, rm, stat } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'coko-proc-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const ready = join(dir, 'ready')
    const pid = start(`trap '' TERM; touch ${ready}; while :; do sleep 0.1; done`)
    // trap 生效之后才写 ready 文件。
    await waitFor(() =>
      stat(ready).then(
        () => true,
        () => false,
      ),
    )
    new ProcessRegistry({ store: s }).track({ pid, kind: 'mcp', command: 'stubborn' })
    await waitFor(async () => (await s.processes.list()).length === 1)
    const startedAt = Date.now()
    expect(await new ProcessRegistry({ store: s, killGraceMs: 300 }).cleanup()).toBe(1)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300)
    await waitFor(() => !alive(pid))
    expect(await s.processes.list()).toEqual([])
  })

  it('启动清理：lstart 不符（pid 被复用）或进程已不存在时只删行，不发信号', async () => {
    const s = store()
    const unrelated = start('sleep 300')
    const gone = start('exit 0')
    await waitFor(() => !alive(gone))
    await s.processes.register({ id: 'reused', pid: unrelated, pgid: unrelated, startedAt: 'Thu Jan  1 00:00:00 2026', kind: 'bash', command: 'old' })
    await s.processes.register({ id: 'gone', pid: gone, startedAt: 'Thu Jan  1 00:00:00 2026', kind: 'mcp', command: 'old' })
    expect(await new ProcessRegistry({ store: s }).cleanup()).toBe(0)
    expect(alive(unrelated)).toBe(true)
    expect(await s.processes.list()).toEqual([])
  })

  it('启动清理：登记的进程组已不是该进程当前的组时只向 pid 发信号', async () => {
    const s = store()
    // 不 detached 的子进程与本测试进程同组：按组发信号会终止测试自己。
    const child = spawn('/bin/sleep', ['300'], { stdio: 'ignore' })
    onTestFinished(() => void child.kill('SIGKILL'))
    const pid = child.pid!
    await waitFor(async () => (await inspectProcess(pid)) !== undefined)
    const identity = (await inspectProcess(pid))!
    expect(identity.pgid).not.toBe(pid)
    await s.processes.register({ id: 'p', pid, pgid: pid, startedAt: identity.startedAt, kind: 'bash', command: 'sleep 300' })
    expect(await new ProcessRegistry({ store: s }).cleanup()).toBe(1)
    await waitFor(() => child.exitCode !== null || child.signalCode !== null)
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('有序关闭：终止全部登记进程并清空登记表；之后启动的进程不登记、被立即终止', async () => {
    const s = store()
    const registry = new ProcessRegistry({ store: s })
    const [leader, child] = await startGroup('sleep 300')
    const mcp = start('sleep 300')
    registry.track({ pid: leader, pgid: leader, kind: 'bash', command: 'sleep 300' })
    registry.track({ pid: mcp, kind: 'mcp', command: 'node' })
    await registry.terminateAll()
    expect(await s.processes.list()).toEqual([])
    await waitFor(() => !alive(leader) && !alive(child) && !alive(mcp))

    const late = start('sleep 300')
    registry.track({ pid: late, pgid: late, kind: 'bash', command: 'sleep 300' })
    await registry.flush()
    expect(await s.processes.list()).toEqual([])
    await waitFor(() => !alive(late))
  })
})

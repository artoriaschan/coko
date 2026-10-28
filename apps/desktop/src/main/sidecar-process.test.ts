import { afterEach, describe, expect, it } from 'vitest'
import { createFixtureDir, electronPath, placeholderSidecarEntry, processExists, readFixtureEvents } from '../../tests/sidecar-fixture.ts'
import { SidecarProcess, SidecarStartError } from './sidecar-process.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function launch(mode: string, extra: Record<string, string> = {}, timeouts = {}) {
  const fixture = await createFixtureDir()
  cleanups.push(fixture.dispose)
  const sidecar = new SidecarProcess({
    execPath: electronPath,
    entry: placeholderSidecarEntry,
    args: ['--data-dir', fixture.dir],
    env: { ...process.env, COKO_FIXTURE_MODE: mode, COKO_FIXTURE_EVENTS: fixture.eventsPath, ...extra },
    timeouts: { readyMs: 15_000, shutdownMs: 1_000, terminateMs: 1_000, killMs: 2_000, inspectMs: 500, ...timeouts },
  })
  cleanups.push(() => sidecar.stop().then(() => undefined))
  return { sidecar, fixture }
}

describe('SidecarProcess', () => {
  it('以 ELECTRON_RUN_AS_NODE 启动，ready 带回端口与令牌，并传递启动参数', async () => {
    const { sidecar, fixture } = await launch('normal')
    const ready = await sidecar.start()
    expect(ready.port).toBeGreaterThan(0)
    expect(ready.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const events = await readFixtureEvents(fixture.eventsPath)
    expect(events.find((e) => e.event === 'spawned')?.argv).toEqual(['--data-dir', fixture.dir])
    expect(events.find((e) => e.event === 'listening')?.port).toBe(ready.port)
  })

  it('shutdown 请求后 sidecar 自行退出（graceful），进程不再存在', async () => {
    const { sidecar } = await launch('normal')
    await sidecar.start()
    const pid = sidecar.pid!
    const result = await sidecar.stop()
    expect(result).toEqual({ outcome: 'graceful', acknowledged: true })
    expect(processExists(pid)).toBe(false)
  })

  it('忽略 shutdown 时升级为 SIGTERM', async () => {
    const { sidecar } = await launch('ignore-shutdown')
    await sidecar.start()
    const pid = sidecar.pid!
    const result = await sidecar.stop()
    expect(result.outcome).toBe('terminated')
    expect(processExists(pid)).toBe(false)
  })

  it('忽略 shutdown 与 SIGTERM 时升级为 SIGKILL', async () => {
    const { sidecar, fixture } = await launch('ignore-sigterm')
    await sidecar.start()
    const pid = sidecar.pid!
    const result = await sidecar.stop()
    expect(result.outcome).toBe('killed')
    expect(processExists(pid)).toBe(false)
    expect((await readFixtureEvents(fixture.eventsPath)).some((e) => e.event === 'sigterm-ignored')).toBe(true)
  })

  it('fatal 消息使 start 以 sidecar 给出的 code 与 message 失败', async () => {
    const { sidecar } = await launch('fatal')
    const error = await sidecar.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SidecarStartError)
    expect(error).toMatchObject({ code: 'fixture-fatal', message: '占位 Sidecar 按要求启动失败' })
    await sidecar.exited
  })

  it('ready 前退出时以 exited 失败，并保留 stderr 尾部作为诊断', async () => {
    const { sidecar } = await launch('exit')
    const error = await sidecar.start().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sidecar-exited' })
    expect((error as SidecarStartError).diagnostic).toContain('fixture exiting before ready')
  })

  it('非法控制消息视为协议错误并终止子进程', async () => {
    const { sidecar } = await launch('invalid')
    const error = await sidecar.start().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sidecar-protocol' })
    await sidecar.exited
    expect(processExists(sidecar.pid!)).toBe(false)
  })

  it('ready 超时后失败并终止子进程', async () => {
    const { sidecar } = await launch('hang', {}, { readyMs: 1_500 })
    const error = await sidecar.start().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sidecar-timeout' })
    await sidecar.exited
    expect(processExists(sidecar.pid!)).toBe(false)
  })

  it('inspectQuit 返回活动 Run 数；超时则拒绝', async () => {
    const busy = await launch('normal', { COKO_FIXTURE_ACTIVE_RUNS: '2' })
    await busy.sidecar.start()
    await expect(busy.sidecar.inspectQuit()).resolves.toBe(2)
    const slow = await launch('slow-inspect')
    await slow.sidecar.start()
    await expect(slow.sidecar.inspectQuit()).rejects.toThrow(/timed out/)
  })

  it('子进程退出时挂起的 inspectQuit 立即以 Sidecar exited 拒绝，不等超时', async () => {
    const { sidecar } = await launch('slow-inspect', {}, { inspectMs: 30_000 })
    await sidecar.start()
    const pending = sidecar.inspectQuit()
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )
    process.kill(sidecar.pid!, 'SIGKILL')
    await sidecar.exited
    expect(await outcome).toMatchObject({ message: 'Sidecar exited' })
  })

  it('ready 之后的意外退出经 onUnexpectedExit 报告一次', async () => {
    const { sidecar } = await launch('normal')
    const exits: unknown[] = []
    sidecar.onUnexpectedExit((info) => exits.push(info))
    await sidecar.start()
    process.kill(sidecar.pid!, 'SIGKILL')
    await sidecar.exited
    expect(exits).toEqual([{ code: null, signal: 'SIGKILL' }])
  })
})

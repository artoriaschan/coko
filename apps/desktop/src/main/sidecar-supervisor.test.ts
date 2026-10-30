import { afterEach, describe, expect, it } from 'vitest'
import { createFixtureDir, electronPath, placeholderSidecarEntry, processExists, readFixtureEvents } from '../../tests/sidecar-fixture.ts'
import { exchangeLaunchToken } from './sidecar-auth.ts'
import { SidecarProcess } from './sidecar-process.ts'
import { SidecarSupervisor, type SupervisorState } from './sidecar-supervisor.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function supervise(mode: string, extra: Record<string, string> = {}) {
  const fixture = await createFixtureDir()
  cleanups.push(fixture.dispose)
  const states: SupervisorState[] = []
  const supervisor = new SidecarSupervisor({
    create: () =>
      new SidecarProcess({
        execPath: electronPath,
        entry: placeholderSidecarEntry,
        env: { ...process.env, COKO_FIXTURE_MODE: mode, COKO_FIXTURE_EVENTS: fixture.eventsPath, ...extra },
        timeouts: { readyMs: 15_000, shutdownMs: 1_000, terminateMs: 1_000, killMs: 2_000 },
      }),
    exchange: exchangeLaunchToken,
    maxRestarts: 2,
    restartDelaysMs: [0, 50],
    stableMs: 60_000,
  })
  supervisor.onState((state) => states.push(state))
  cleanups.push(() => supervisor.stop().then(() => undefined))
  return { supervisor, states, fixture }
}

/** 等待状态满足条件；状态是 supervisor 主动报告的，不靠固定 sleep。 */
function settled(supervisor: SidecarSupervisor, predicate: (state: SupervisorState) => boolean): Promise<SupervisorState> {
  return new Promise((resolve) => {
    if (predicate(supervisor.state)) return resolve(supervisor.state)
    const off = supervisor.onState((state) => {
      if (!predicate(state)) return
      off()
      resolve(state)
    })
  })
}

const spawned = async (eventsPath: string) => (await readFixtureEvents(eventsPath)).filter((e) => e.event === 'spawned').map((e) => e.pid)

// 每个用例启动真实的 Electron sidecar 进程（单独运行约 2.5 秒）；全量并行时负载高，默认 5 秒不够。
describe('SidecarSupervisor', { timeout: 30_000 }, () => {
  it('ready 之后意外退出：重启 sidecar 并重新交换 cookie，旧端点被替换', async () => {
    const { supervisor, states } = await supervise('normal')
    const first = await supervisor.start()
    expect(first.phase).toBe('ready')
    const before = supervisor.endpoint!
    const pid = supervisor.pid!
    process.kill(pid, 'SIGKILL')
    const after = await settled(supervisor, (s) => s.phase === 'ready' && s.port !== (first.phase === 'ready' ? first.port : 0))
    expect(states.map((s) => s.phase)).toEqual(['starting', 'ready', 'restarting', 'ready'])
    expect(supervisor.pid).not.toBe(pid)
    expect(processExists(pid)).toBe(false)
    expect(supervisor.endpoint?.origin).toBe(`http://127.0.0.1:${after.phase === 'ready' ? after.port : 0}`)
    expect(supervisor.endpoint?.cookie).toMatch(/^coko-session=/)
    expect(supervisor.endpoint).not.toEqual(before)
    // 新 cookie 能通过新 sidecar 的认证。
    const health = await fetch(new URL('/api/health', supervisor.endpoint!.origin), { headers: { cookie: supervisor.endpoint!.cookie } })
    expect(health.status).toBe(200)
  })

  it('重启连续失败达到上限后进入 failed，不再 spawn', async () => {
    const { supervisor, states, fixture } = await supervise('fatal-after-first')
    await supervisor.start()
    process.kill(supervisor.pid!, 'SIGKILL')
    const failed = await settled(supervisor, (s) => s.phase === 'failed')
    expect(failed).toMatchObject({ phase: 'failed', reason: 'crashed', error: { code: 'fixture-fatal' } })
    expect(states.map((s) => (s.phase === 'restarting' ? `restarting:${s.attempt}` : s.phase))).toEqual([
      'starting',
      'ready',
      'restarting:1',
      'restarting:2',
      'failed',
    ])
    expect(await spawned(fixture.eventsPath)).toHaveLength(1 + 2)
    expect(supervisor.endpoint).toBeUndefined()
    for (const pid of await spawned(fixture.eventsPath)) expect(processExists(pid)).toBe(false)
  })

  it('首次启动失败直接进入 failed（不重启），并带回 stderr 诊断', async () => {
    const { supervisor, fixture } = await supervise('fatal', { COKO_FIXTURE_STDERR: 'diagnostic line' })
    const state = await supervisor.start()
    expect(state).toMatchObject({ phase: 'failed', reason: 'startup', error: { code: 'fixture-fatal' } })
    expect(state.phase === 'failed' ? state.diagnostic : '').toContain('diagnostic line')
    expect(await spawned(fixture.eventsPath)).toHaveLength(1)
  })

  it('stop 中断重启：不再 spawn 新进程，状态停在 stopped', async () => {
    const { supervisor, fixture } = await supervise('normal')
    await supervisor.start()
    const restarting = settled(supervisor, (s) => s.phase === 'restarting')
    process.kill(supervisor.pid!, 'SIGKILL')
    await restarting
    await supervisor.stop()
    expect(supervisor.state.phase).toBe('stopped')
    const pids = await spawned(fixture.eventsPath)
    for (const pid of pids) expect(processExists(pid)).toBe(false)
    expect(supervisor.endpoint).toBeUndefined()
  })

  it('stop 发生在 cookie 交换途中：先中止交换并等它结束，再停止进程', async () => {
    const fixture = await createFixtureDir()
    cleanups.push(fixture.dispose)
    const order: string[] = []
    let exchangeStarted!: () => void
    const started = new Promise<void>((resolve) => (exchangeStarted = resolve))
    const supervisor = new SidecarSupervisor({
      create: () => {
        const sidecar = new SidecarProcess({
          execPath: electronPath,
          entry: placeholderSidecarEntry,
          env: { ...process.env, COKO_FIXTURE_MODE: 'normal', COKO_FIXTURE_EVENTS: fixture.eventsPath },
          timeouts: { readyMs: 15_000, shutdownMs: 1_000, terminateMs: 1_000, killMs: 2_000 },
        })
        const stop = sidecar.stop.bind(sidecar)
        sidecar.stop = () => {
          order.push('process-stop')
          return stop()
        }
        return sidecar
      },
      // 模拟一个只在收到中止信号后才结束的交换请求。
      exchange: (_origin, _token, signal) =>
        new Promise<string>((_resolve, reject) => {
          exchangeStarted()
          signal?.addEventListener('abort', () => {
            order.push('exchange-aborted')
            reject(signal.reason)
          })
        }),
    })
    cleanups.push(() => supervisor.stop())
    const starting = supervisor.start()
    await started
    await supervisor.stop()
    expect(order[0]).toBe('exchange-aborted')
    expect(order).toContain('process-stop')
    expect((await starting).phase).toBe('stopped')
    for (const pid of await spawned(fixture.eventsPath)) expect(processExists(pid)).toBe(false)
  })
})

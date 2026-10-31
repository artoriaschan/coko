import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { UpdateStatus } from '../shared/bridge.ts'
import { DESKTOP_LOG_FILE, startDesktopLogging } from './logging.ts'
import {
  createUpdateCoordinator,
  UPDATE_INITIAL_DELAY_MS,
  UPDATE_INTERVAL_MS,
  type AutoUpdaterLike,
  type UpdateCoordinatorOptions,
} from './update-coordinator.ts'

/** 记录调用的 autoUpdater：事件由测试按 Squirrel.Mac 的顺序发出。 */
function fakeUpdater(options: { setFeedThrows?: Error; checkThrows?: Error } = {}) {
  const emitter = new EventEmitter()
  const calls: string[] = []
  const updater: AutoUpdaterLike & { emit: EventEmitter['emit']; listenerCount: EventEmitter['listenerCount'] } = {
    setFeedURL: ({ url }) => {
      calls.push(`setFeedURL ${url}`)
      if (options.setFeedThrows) throw options.setFeedThrows
    },
    checkForUpdates: () => {
      calls.push('checkForUpdates')
      if (options.checkThrows) throw options.checkThrows
    },
    quitAndInstall: () => void calls.push('quitAndInstall'),
    on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener as (...args: unknown[]) => void),
    emit: emitter.emit.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
  }
  return { updater, calls }
}

function coordinator(overrides: Partial<UpdateCoordinatorOptions> & { updater: AutoUpdaterLike }) {
  const statuses: UpdateStatus[] = []
  const order: string[] = []
  const c = createUpdateCoordinator({
    packaged: true,
    feedUrl: 'https://updates.example.test/darwin',
    confirmQuit: async () => {
      order.push('confirm')
      return true
    },
    prepareQuit: async () => void order.push('prepare'),
    ...overrides,
  })
  c.subscribe((status) => statuses.push(status))
  return { c, statuses, order }
}

async function logged(task: () => void | Promise<void>): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-update-log-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const logPath = join(dir, DESKTOP_LOG_FILE)
  const logging = await startDesktopLogging({ logPath, appVersion: '0.0.0-test', console: false })
  try {
    await task()
  } finally {
    await logging.dispose()
  }
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

/** 不读日志的用例同样在日志配置的生命周期内运行：配置关闭后写入会报 EBADF。 */
const withLogging = async (task: () => void | Promise<void>) => void (await logged(task))

describe('UpdateCoordinator（main）', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it.each([
    { packaged: false, feedUrl: 'https://updates.example.test/darwin', reason: 'not-packaged' },
    { packaged: true, feedUrl: '', reason: 'no-feed' },
    { packaged: false, feedUrl: '', reason: 'not-packaged' },
  ])(
    'packaged=$packaged、feed=$feedUrl 时 disabled { reason: $reason }：不设更新源、不检查，日志 auto update disabled',
    async ({ packaged, feedUrl, reason }) => {
      const { updater, calls } = fakeUpdater()
      const { c, statuses } = coordinator({ updater, packaged, feedUrl })
      expect(c.status).toEqual({ state: 'disabled', reason })
      const records = await logged(async () => {
        c.start()
        await c.checkForUpdates()
        await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2)
        updater.emit('update-downloaded', {}, '', '9.9.9')
        await c.installUpdate()
      })
      expect(calls).toEqual([])
      expect(statuses).toEqual([])
      expect(updater.listenerCount('error')).toBe(0)
      expect(records.filter((r) => r.message === 'auto update disabled').map((r) => r.properties)).toEqual([expect.objectContaining({ reason })])
    },
  )

  it('启用时设置更新源，30 秒后第一次检查，之后每 6 小时一次', () =>
    withLogging(async () => {
      const { updater, calls } = fakeUpdater()
      const { c } = coordinator({ updater })
      expect(c.status).toEqual({ state: 'idle' })
      c.start()
      c.start()
      expect(calls).toEqual(['setFeedURL https://updates.example.test/darwin'])
      await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS - 1)
      expect(calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toEqual(['setFeedURL https://updates.example.test/darwin', 'checkForUpdates'])
      updater.emit('update-not-available')
      await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - UPDATE_INITIAL_DELAY_MS)
      expect(calls.filter((call) => call === 'checkForUpdates')).toHaveLength(2)
      c.dispose()
      await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2)
      expect(calls.filter((call) => call === 'checkForUpdates')).toHaveLength(2)
    }))

  it('autoUpdater 事件映射为 UpdateStatus，并记日志 update status { state, version? }', async () => {
    const { updater } = fakeUpdater()
    const { c, statuses } = coordinator({ updater })
    const records = await logged(() => {
      c.start()
      updater.emit('checking-for-update')
      updater.emit('update-not-available')
      updater.emit('checking-for-update')
      updater.emit('update-available')
      updater.emit('update-downloaded', {}, 'notes', '1.2.3')
      updater.emit('error', new Error('Could not get code signature for running application'))
    })
    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'not-available' },
      { state: 'checking' },
      { state: 'downloading' },
      { state: 'downloaded', version: '1.2.3' },
      { state: 'error', message: 'Could not get code signature for running application' },
    ])
    expect(c.status).toEqual(statuses.at(-1))
    expect(records.filter((r) => r.message === 'update status').map((r) => r.properties)).toEqual([
      expect.objectContaining({ state: 'checking' }),
      expect.objectContaining({ state: 'not-available' }),
      expect.objectContaining({ state: 'checking' }),
      expect.objectContaining({ state: 'downloading' }),
      expect.objectContaining({ state: 'downloaded', version: '1.2.3' }),
      expect.objectContaining({ state: 'error' }),
    ])
  })

  it('error 的说明在交给 renderer 前脱敏；没有 error 事件时也不会抛出', () =>
    withLogging(() => {
      const { updater } = fakeUpdater()
      const { c, statuses } = coordinator({ updater })
      c.start()
      expect(() => updater.emit('error', new Error('feed https://u.example.test/?token=sk-updateSecretValue1 failed'))).not.toThrow()
      expect(statuses.at(-1)?.state).toBe('error')
      expect(statuses.at(-1)?.message).not.toContain('sk-updateSecretValue1')
    }))

  it('setFeedURL 或 checkForUpdates 同步抛出时进入 error，不崩溃', () =>
    withLogging(async () => {
      const feed = fakeUpdater({ setFeedThrows: new Error('Could not get code signature for running application') })
      const a = coordinator({ updater: feed.updater })
      a.c.start()
      expect(a.c.status).toEqual({ state: 'error', message: 'Could not get code signature for running application' })
      await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS)
      expect(feed.calls.filter((call) => call === 'checkForUpdates')).toEqual([])

      const check = fakeUpdater({ checkThrows: new Error('Update check failed') })
      const b = coordinator({ updater: check.updater })
      b.c.start()
      await b.c.checkForUpdates()
      expect(b.c.status).toEqual({ state: 'error', message: 'Update check failed' })
    }))

  it('checkForUpdates：检查或下载进行中、已下载时不重复发起；error 之后可以重试', () =>
    withLogging(async () => {
      const { updater, calls } = fakeUpdater()
      const { c } = coordinator({ updater })
      c.start()
      await c.checkForUpdates()
      updater.emit('checking-for-update')
      await c.checkForUpdates()
      updater.emit('update-available')
      await c.checkForUpdates()
      updater.emit('error', new Error('download failed'))
      await c.checkForUpdates()
      updater.emit('checking-for-update')
      updater.emit('update-available')
      updater.emit('update-downloaded', {}, '', '1.2.3')
      await c.checkForUpdates()
      expect(calls.filter((call) => call === 'checkForUpdates')).toHaveLength(2)
    }))

  it('installUpdate：只在 downloaded 时；先经退出确认，再收尾，最后 quitAndInstall', async () => {
    const { updater, calls } = fakeUpdater()
    const { c, order } = coordinator({ updater })
    c.start()
    await c.installUpdate()
    expect(order).toEqual([])
    updater.emit('update-downloaded', {}, '', '1.2.3')
    const records = await logged(() => c.installUpdate())
    expect(order).toEqual(['confirm', 'prepare'])
    expect(calls.at(-1)).toBe('quitAndInstall')
    expect(records.find((r) => r.message === 'update install requested')?.properties).toMatchObject({ version: '1.2.3' })
  })

  it('installUpdate：退出确认被取消时不收尾、不安装', () =>
    withLogging(async () => {
      const { updater, calls } = fakeUpdater()
      const order: string[] = []
      const { c } = coordinator({
        updater,
        confirmQuit: async () => {
          order.push('confirm')
          return false
        },
        prepareQuit: async () => void order.push('prepare'),
      })
      c.start()
      updater.emit('update-downloaded', {}, '', '1.2.3')
      await c.installUpdate()
      expect(order).toEqual(['confirm'])
      expect(calls).not.toContain('quitAndInstall')
      expect(c.status.state).toBe('downloaded')
    }))
})

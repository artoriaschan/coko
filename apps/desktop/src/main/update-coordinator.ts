// 自动更新的协调者（main）：Electron autoUpdater（macOS 为 Squirrel.Mac）的事件映射为 UpdateStatus 并推给 renderer；检查更新，
// 已下载时经退出确认后 quitAndInstall。只在打包且有更新源时启用，否则 disabled（not-packaged / no-feed）。
// autoUpdater 与退出流程由装配方（index.ts）给出，这里只做状态、调度与日志，便于在 node 中单元测试。
import { getLogger, redactText } from '@coko/logging'
import type { UpdateStatus } from '../shared/bridge.ts'

/** Electron autoUpdater 中用到的部分。 */
export interface AutoUpdaterLike {
  setFeedURL(options: { url: string }): void
  checkForUpdates(): void
  quitAndInstall(): void
  on(event: 'checking-for-update' | 'update-available' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-downloaded', listener: (event: unknown, releaseNotes: string, releaseName: string) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface UpdateCoordinatorOptions {
  /** app.isPackaged。 */
  readonly packaged: boolean
  /** 构建期更新源（测试构建可被 COKO_TEST_UPDATE_FEED_URL 替换，见 build-flags.ts 的 resolveUpdateFeed）。 */
  readonly feedUrl: string
  readonly updater: AutoUpdaterLike
  /** 退出确认（与普通退出同一个 QuitCoordinator）；true 表示可以退出。 */
  readonly confirmQuit: () => Promise<boolean>
  /** 退出前的收尾（隐藏窗口、停止 Sidecar、刷新日志），之后 quitAndInstall 触发的退出不再询问。 */
  readonly prepareQuit: () => Promise<void>
  /** 启动后第一次检查的延迟与之后的间隔（毫秒）；缺省 30 秒与 6 小时。 */
  readonly initialDelayMs?: number
  readonly intervalMs?: number
}

export interface UpdateCoordinator {
  readonly status: UpdateStatus
  /** 状态变化时调用；返回取消订阅。 */
  subscribe(listener: (status: UpdateStatus) => void): () => void
  /** 启用时设置更新源并开始定时检查；禁用时记日志 auto update disabled { reason }。在日志就绪之后调用一次。 */
  start(): void
  /** 立即检查一次；disabled 或检查、下载进行中时不做任何事。 */
  checkForUpdates(): Promise<void>
  /** 只在 downloaded 时：经退出确认后收尾并 quitAndInstall；取消确认则什么都不做。 */
  installUpdate(): Promise<void>
  dispose(): void
}

export const UPDATE_INITIAL_DELAY_MS = 30_000
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 检查或下载进行中、已下载待安装时不再发起检查。 */
const BUSY = new Set<UpdateStatus['state']>(['checking', 'available', 'downloading', 'downloaded'])

export function createUpdateCoordinator(options: UpdateCoordinatorOptions): UpdateCoordinator {
  const log = getLogger(['main', 'update'])
  const reason = !options.packaged ? 'not-packaged' : options.feedUrl === '' ? 'no-feed' : undefined
  const enabled = reason === undefined
  let status: UpdateStatus = enabled ? { state: 'idle' } : { state: 'disabled', reason }
  const listeners = new Set<(status: UpdateStatus) => void>()
  const timers: { initial?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> } = {}
  let started = false
  let installing = false

  const set = (next: UpdateStatus) => {
    status = next
    log.info('update status', { state: next.state, ...(next.version !== undefined ? { version: next.version } : {}) })
    for (const listener of listeners) listener(next)
  }

  const check = () => {
    if (!enabled || BUSY.has(status.state)) return
    try {
      options.updater.checkForUpdates()
    } catch (error) {
      set({ state: 'error', message: redactText((error as Error).message) })
    }
  }

  return {
    get status() {
      return status
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    start() {
      if (started) return
      started = true
      if (!enabled) {
        log.info('auto update disabled', { reason })
        return
      }
      const { updater } = options
      updater.on('checking-for-update', () => set({ state: 'checking' }))
      // Squirrel.Mac 发现更新后立即开始下载，没有单独的"可下载"阶段。
      updater.on('update-available', () => set({ state: 'downloading' }))
      updater.on('update-not-available', () => set({ state: 'not-available' }))
      updater.on('update-downloaded', (_event, _notes, releaseName) =>
        set({ state: 'downloaded', ...(typeof releaseName === 'string' && releaseName !== '' ? { version: releaseName } : {}) }),
      )
      // 没有 error 监听时 EventEmitter 会抛出并使 main 崩溃；说明可能含更新源地址等细节，脱敏后交给 renderer。
      updater.on('error', (error) => set({ state: 'error', message: redactText(error?.message ?? String(error)) }))
      try {
        updater.setFeedURL({ url: options.feedUrl })
      } catch (error) {
        set({ state: 'error', message: redactText((error as Error).message) })
        return
      }
      log.info('auto update enabled', {})
      timers.initial = setTimeout(check, options.initialDelayMs ?? UPDATE_INITIAL_DELAY_MS)
      timers.interval = setInterval(check, options.intervalMs ?? UPDATE_INTERVAL_MS)
      timers.initial.unref?.()
      timers.interval.unref?.()
    },
    async checkForUpdates() {
      check()
    },
    async installUpdate() {
      if (status.state !== 'downloaded' || installing) return
      installing = true
      try {
        if (!(await options.confirmQuit())) return
        // prepareQuit 会关闭日志，先记录。
        log.info('update install requested', status.version !== undefined ? { version: status.version } : {})
        await options.prepareQuit()
        options.updater.quitAndInstall()
      } finally {
        installing = false
      }
    },
    // 只停止定时检查与推送；autoUpdater 的监听保留到进程退出（quitAndInstall 之后仍可能发出 error）。
    dispose() {
      clearTimeout(timers.initial)
      clearInterval(timers.interval)
      listeners.clear()
    },
  }
}

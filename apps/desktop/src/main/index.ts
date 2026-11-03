import { open } from 'node:fs/promises'
import { openDirectory } from './open-directory.ts'
import { IMAGE_ATTACHMENT_MAX_BYTES } from '@coko/protocol'
import { basename, extname, join, resolve } from 'node:path'
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  protocol,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
} from 'electron'
import { createTranslator, resolveLocale } from '@coko/i18n'
import { getLogger, redactText } from '@coko/logging'
import { IPC, type BootFailure, type BootResult, type SidecarStateEvent } from '../shared/bridge.ts'
import { APP_HOST, APP_SCHEME, createAppProtocolHandler, type RendererSource } from './app-protocol.ts'
import type { SidecarControlChannel } from './control-channel.ts'
import { createCredentialBridge } from './credentials.ts'
import { watchSidecarReload } from './dev-reload.ts'
import { createProviderModelsBridge } from './provider-models.ts'
import { createNotifier } from './notifications.ts'
import { createUpdateCoordinator } from './update-coordinator.ts'
import { QuitCoordinator } from './quit-coordinator.ts'
import { DESKTOP_LOG_FILE, parseRendererLog, startDesktopLogging, writeRendererLog } from './logging.ts'
import { exchangeLaunchToken } from './sidecar-auth.ts'
import { ignoredTestHooks, resolveUpdateFeed, TEST_BUILD, UPDATE_FEED } from './build-flags.ts'
import { sidecarArgs, sidecarEnvironment } from './sidecar-env.ts'
import { createSecretBridge } from './secrets.ts'
import { SidecarProcess } from './sidecar-process.ts'
import { SidecarSupervisor } from './sidecar-supervisor.ts'
import { decideWebSocketHeaders } from './websocket-headers.ts'
import { e2eBackgroundEnabled } from './e2e-background.ts'
import { createMainWindow, hardenWebContents, revealMainWindow, type MainWindowMode } from './window.ts'

// 必须在 ready 之前：standard 让 coko-app://app 拥有正常的 origin，secure 让其视为安全上下文。
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
])

// 测试与多实例开发用独立的 userData；必须在单实例锁之前设置，锁按 userData 区分。
const userDataOverride = process.env.COKO_USER_DATA_DIR
if (userDataOverride !== undefined && userDataOverride !== '') {
  app.setPath('userData', resolve(userDataOverride))
  app.setAppLogsPath(join(resolve(userDataOverride), 'logs'))
}

// E2E 后台模式：在单实例锁之前切换为 accessory，第二实例在退出前也不显示 Dock 图标、不激活。
const windowMode: MainWindowMode = { background: e2eBackgroundEnabled(process.env, { packaged: app.isPackaged, testBuild: TEST_BUILD }) }
if (windowMode.background && process.platform === 'darwin') app.setActivationPolicy('accessory')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  run()
}

function run(): void {
  const development = !app.isPackaged
  const log = getLogger(['main'])
  const logging = startDesktopLogging({ logPath: join(app.getPath('logs'), DESKTOP_LOG_FILE), appVersion: app.getVersion(), console: development })
  const appRoot = app.getAppPath()
  const preload = join(appRoot, 'dist', 'electron', 'preload.cjs')
  // 开发时允许用环境变量替换 sidecar 入口（测试用占位 sidecar）；安装包始终使用随包 sidecar。
  const sidecarEntry =
    development && process.env.COKO_SIDECAR_ENTRY
      ? resolve(process.env.COKO_SIDECAR_ENTRY)
      : development
        ? join(appRoot, 'dist', 'sidecar', 'index.mjs')
        : join(process.resourcesPath, 'sidecar', 'index.mjs')
  // 随包 ripgrep：开发时由 build 复制到 dist/ripgrep，打包后经 extraResource 位于 Resources/ripgrep。
  // COKO_RIPGREP_PATH 仅在未打包时生效（测试注入不可执行路径）。
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const ripgrepPath =
    development && process.env.COKO_RIPGREP_PATH
      ? resolve(process.env.COKO_RIPGREP_PATH)
      : development
        ? join(appRoot, 'dist', 'ripgrep', rgName)
        : join(process.resourcesPath, 'ripgrep', rgName)
  const devServerUrl = development ? process.env.COKO_RENDERER_DEV_URL : undefined
  const renderer: RendererSource = devServerUrl ? { kind: 'dev-server', url: devServerUrl } : { kind: 'directory', root: join(appRoot, 'dist', 'renderer') }

  let mainWindow: BrowserWindow | undefined
  let quitApproved = false
  let readyToExit = false

  // 原生对话框文案来自 @coko/i18n 的 main.* 字典；getLocale 只在 app ready 之后调用。
  const t = () => createTranslator(resolveLocale(app.getLocale()))
  const wsBaseUrl = (port: number) => `ws://127.0.0.1:${port}`

  const showMessageBox = (options: MessageBoxOptions) => {
    const owner = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
    return owner === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)
  }

  /** 诊断入口：在系统文件管理器中打开日志文件夹（desktop.jsonl 与 sidecar.jsonl 所在目录）。 */
  const openLogsFolder = async (): Promise<boolean> => {
    const error = await shell.openPath(app.getPath('logs'))
    if (error !== '') log.warn('open logs folder failed', { error })
    return error === ''
  }

  const showSidecarError = async (kind: 'startup' | 'crashed', failure: BootFailure): Promise<void> => {
    const text = t()
    const { response } = await showMessageBox({
      type: 'error',
      title: text('main.dialogTitle'),
      message: text(kind === 'startup' ? 'main.startupFailedMessage' : 'main.crashedMessage'),
      // 先给一句可理解的说明，技术信息在后。
      detail: `${text(kind === 'startup' ? 'main.startupFailedDetail' : 'main.crashedDetail')}\n\n${text('main.technicalDetail', { detail: `${failure.message} (${failure.code})` })}`,
      buttons: [text('main.quit'), text('main.openLogs'), text('main.close')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (response === 0) app.quit()
    else if (response === 1) await openLogsFolder()
  }

  /** sidecar 的 stderr 尾部脱敏后写入 desktop.jsonl（打包后用户看不到 console）。 */
  const logDiagnostic = (diagnostic: string) => {
    if (diagnostic === '') return
    const stderrTail = redactText(diagnostic)
    log.error('sidecar diagnostic', { stderrTail })
    if (development) console.error('[coko] sidecar diagnostic:\n' + stderrTail)
  }

  const supervisor = new SidecarSupervisor({
    create: () =>
      new SidecarProcess({
        execPath: process.execPath,
        entry: sidecarEntry,
        args: sidecarArgs(
          ['--data-dir', join(app.getPath('userData'), 'data'), '--log-dir', app.getPath('logs'), '--ripgrep', ripgrepPath, '--app-version', app.getVersion()],
          {
            packaged: !development,
          },
        ),
        // 打包的发布构建不把测试钩子变量（COKO_SANDBOX_EXEC、COKO_TEST_*、COKO_FAUX_SCRIPT）交给 Sidecar。
        env: sidecarEnvironment(process.env, { packaged: !development, testBuild: TEST_BUILD }),
        onStdout: (chunk) => process.stdout.write(chunk),
      }),
    exchange: exchangeLaunchToken,
  })
  // 开发时（electron-forge start）Sidecar 重建后计划重启它；首次启动失败时只能重启 Electron。
  const sidecarReloadFile = development ? process.env.COKO_SIDECAR_RELOAD_FILE : undefined
  if (sidecarReloadFile !== undefined && sidecarReloadFile !== '') {
    const reloadWatcher = watchSidecarReload(sidecarReloadFile, () => {
      const state = supervisor.state
      if (state.phase === 'failed' && state.reason === 'startup') {
        console.warn('[coko] sidecar rebuilt, but its first start failed; restart Electron from the Forge terminal')
        return
      }
      log.info('sidecar rebuilt, reloading')
      void supervisor.reload()
    })
    app.once('will-quit', () => reloadWatcher.close())
  }
  supervisor.onUnexpectedExit((info) => {
    log.error('sidecar exited unexpectedly', { code: info.code, signal: info.signal })
    logDiagnostic(info.diagnostic)
  })

  const startup: Promise<BootResult> = (async (): Promise<BootResult> => {
    try {
      await logging
      log.info('app starting', {
        packaged: !development,
        testBuild: TEST_BUILD,
        background: windowMode.background,
        electron: process.versions.electron,
        platform: process.platform,
        ripgrep: ripgrepPath,
      })
      // 发布构建不读测试钩子（main 不把它们交给 Sidecar，后台模式与测试更新源同样关闭）；只记名字。
      const ignored = ignoredTestHooks(process.env, { packaged: !development, testBuild: TEST_BUILD })
      if (ignored.length > 0) log.warn('test hooks ignored in a packaged build', { variables: ignored })
      const state = await supervisor.start()
      await app.whenReady()
      if (state.phase !== 'ready') {
        const failure: BootFailure = state.phase === 'failed' ? state.error : { code: 'sidecar-stopped', message: 'Sidecar was stopped during start' }
        log.error('sidecar failed to start', { code: failure.code, message: failure.message })
        if (state.phase === 'failed') logDiagnostic(state.diagnostic)
        return { ok: false, error: failure }
      }
      // 只记录端口；启动令牌只交给令牌交换。
      log.info('sidecar ready', { port: state.port, pid: supervisor.pid ?? null })
      return { ok: true, info: { wsBaseUrl: wsBaseUrl(state.port), platform: process.platform, locale: app.getLocale() } }
    } catch (error) {
      const failure: BootFailure = { code: 'sidecar-auth', message: (error as Error).message }
      log.error('sidecar failed to start', { code: failure.code, message: failure.message })
      await supervisor.stop()
      return { ok: false, error: failure }
    }
  })()

  /** boot 之后的状态变化通知 renderer；连续重启失败时弹出错误对话框。 */
  const notify = (event: SidecarStateEvent) => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.sidecarState, event)
  }
  void startup.then(() =>
    supervisor.onState((state) => {
      if (quitApproved) return
      if (state.phase === 'restarting') {
        log.warn('sidecar restarting', { attempt: state.attempt })
        notify({ phase: 'restarting', attempt: state.attempt })
      } else if (state.phase === 'ready') {
        log.info('sidecar restarted', { port: state.port, pid: supervisor.pid ?? null })
        notify({ phase: 'ready', wsBaseUrl: wsBaseUrl(state.port) })
      } else if (state.phase === 'failed') {
        log.error('sidecar restart failed', { code: state.error.code, message: state.error.message })
        logDiagnostic(state.diagnostic)
        notify({ phase: 'failed', error: state.error })
        void showSidecarError('crashed', state.error)
      }
    }),
  )

  // 只接受主窗口主框架、coko-app://app 文档发出的 IPC。
  const assertMainFrame = (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): BrowserWindow => {
    const window = mainWindow
    const frame = event.senderFrame
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents || frame === null || frame !== window.webContents.mainFrame) {
      throw new Error('Rejected IPC from an unowned frame')
    }
    const url = new URL(frame.url)
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) throw new Error('Rejected IPC from an unowned document')
    return window
  }

  // 重启之后 renderer 重新加载时，boot 给出当前的端口或终态失败。
  ipcMain.handle(IPC.boot, async (event): Promise<BootResult> => {
    assertMainFrame(event)
    const result = await startup
    if (!result.ok) return result
    const state = supervisor.state
    if (state.phase === 'ready') return { ok: true, info: { ...result.info, wsBaseUrl: wsBaseUrl(state.port) } }
    if (state.phase === 'failed') return { ok: false, error: state.error }
    return result
  })

  ipcMain.handle(IPC.openLogs, async (event) => {
    assertMainFrame(event)
    return openLogsFolder()
  })

  // 自动更新：状态推给主窗口；检查与安装只接受主窗口的请求。安装经与普通退出相同的确认，收尾之后 quitAndInstall。
  const updates = createUpdateCoordinator({
    packaged: !development,
    feedUrl: resolveUpdateFeed(process.env, { testBuild: TEST_BUILD, buildFeed: UPDATE_FEED }),
    updater: autoUpdater,
    confirmQuit: () => quitCoordinator.decide(),
    prepareQuit: () => prepareQuit(),
  })
  // 日志就绪后启用（或记 auto update disabled { reason }）；定时检查从此时起算。
  void logging.then(() => updates.start()).catch(() => undefined)
  updates.subscribe((status) => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.updateStatus, status)
  })
  ipcMain.handle(IPC.getUpdateStatus, (event) => {
    assertMainFrame(event)
    return updates.status
  })
  ipcMain.handle(IPC.checkForUpdates, async (event) => {
    assertMainFrame(event)
    await updates.checkForUpdates()
  })
  ipcMain.handle(IPC.installUpdate, async (event) => {
    assertMainFrame(event)
    await updates.installUpdate()
  })

  // renderer 日志：fire-and-forget；只收主窗口主框架的消息，校验后由 main 标记来源写入 desktop.jsonl。
  ipcMain.on(IPC.log, (event, raw: unknown) => {
    try {
      assertMainFrame(event)
    } catch {
      return
    }
    const record = parseRendererLog(raw)
    if (record) writeRendererLog(record)
  })

  let picking: Promise<string | null> | undefined
  let pickingFiles: Promise<string[]> | undefined
  const pickedImages = new Set<string>()
  ipcMain.handle(IPC.readPickedImage, async (event, path: unknown) => {
    assertMainFrame(event)
    if (typeof path !== 'string' || !pickedImages.has(path)) throw new Error('Choose the image first')
    const handle = await open(path, 'r')
    try {
      if ((await handle.stat()).size > IMAGE_ATTACHMENT_MAX_BYTES) throw new Error('Image exceeds the 4.5 MB limit')
      const buffer = Buffer.alloc(IMAGE_ATTACHMENT_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > IMAGE_ATTACHMENT_MAX_BYTES) throw new Error('Image exceeds the 4.5 MB limit')
      const mimeType = (
        { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>
      )[extname(path).toLowerCase()]
      if (!mimeType) throw new Error('Unsupported image format')
      return { name: basename(path), mimeType, data: buffer.subarray(0, bytesRead).toString('base64') }
    } finally {
      await handle.close()
    }
  })
  ipcMain.handle(IPC.pickFiles, async (event) => {
    const window = assertMainFrame(event)
    pickingFiles ??= dialog
      .showOpenDialog(window, { properties: ['openFile', 'multiSelections'] })
      .then(({ canceled, filePaths }) => {
        if (canceled) return []
        for (const path of filePaths) pickedImages.add(path)
        return filePaths
      })
      .finally(() => {
        pickingFiles = undefined
      })
    return pickingFiles
  })
  ipcMain.handle(IPC.openDirectory, async (event, path: unknown) => {
    assertMainFrame(event)
    return openDirectory(path, shell)
  })
  ipcMain.handle(IPC.pickDirectory, async (event) => {
    const window = assertMainFrame(event)
    picking ??= dialog
      .showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      .then(({ canceled, filePaths }) => (canceled ? null : (filePaths[0] ?? null)))
      .finally(() => {
        picking = undefined
      })
    return picking
  })

  // ADR 0004、0007、0010：Credential 与 Secret 只在 main 用 safeStorage 加解密；Provider 与其 Key 经一条控制消息一次存入 Sidecar。
  const encryption = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext: string) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext: Uint8Array) => safeStorage.decryptString(Buffer.from(ciphertext)),
  }
  const channel: SidecarControlChannel = {
    isReady: () => supervisor.isReady,
    send: (message) => supervisor.send(message),
    onMessage: (listener) => supervisor.onControlMessage(listener),
    onUnavailable: (listener) => supervisor.onUnavailable(listener),
  }
  // Sidecar 的 notify 控制消息：窗口不在前台时显示桌面通知（main/notifications.ts；测试构建只记日志）。
  const notifier = createNotifier({
    focused: () => mainWindow !== undefined && !mainWindow.isDestroyed() && mainWindow.isFocused() && mainWindow.isVisible(),
    testBuild: TEST_BUILD,
    show: ({ title, body }) => {
      if (!Notification.isSupported()) return undefined
      const notification = new Notification({ title, body })
      notification.show()
      return { onClick: (listener) => void notification.on('click', listener), onClose: (listener) => void notification.on('close', listener) }
    },
    openSession: (sessionId) => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.webContents.send(IPC.openSession, sessionId)
    },
  })
  channel.onMessage((message) => {
    if (message.type !== 'notify') return
    notifier.notify(message)
  })
  const credentials = createCredentialBridge({ encryption, channel })
  ipcMain.handle(IPC.saveProvider, async (event, input: unknown) => {
    assertMainFrame(event)
    return credentials.saveProvider(input)
  })
  // 获取可用模型：表单中的 Key 只用于这一次请求（ADR 0010）。
  const providerModels = createProviderModelsBridge({ channel })
  ipcMain.handle(IPC.fetchProviderModels, async (event, input: unknown) => {
    assertMainFrame(event)
    return providerModels.fetch(input)
  })
  // fire-and-forget，与日志相同：来自其他框架的消息直接忽略。
  ipcMain.on(IPC.cancelProviderModels, (event, requestKey: unknown) => {
    try {
      assertMainFrame(event)
    } catch {
      return
    }
    providerModels.cancel(requestKey)
  })
  const secrets = createSecretBridge({ encryption, channel })
  ipcMain.handle(IPC.setSecret, async (event, name: unknown, value: unknown) => {
    assertMainFrame(event)
    return secrets.set(name, value)
  })

  const quitCoordinator = new QuitCoordinator(() => ({
    inspect: supervisor.isReady ? () => supervisor.inspectQuit() : undefined,
    confirm: async ({ activeRuns }) => {
      const text = t()
      const { response } = await showMessageBox({
        type: 'warning',
        message: text('main.confirmQuitMessage'),
        detail:
          activeRuns === 'unknown'
            ? text('main.confirmQuitUnknown')
            : activeRuns === 1
              ? text('main.confirmQuitOne')
              : text('main.confirmQuitMany', { count: activeRuns }),
        buttons: [text('main.quit'), text('main.cancel')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      return response === 0
    },
  }))

  /** 退出前的收尾；之后的 before-quit（app.quit 或 quitAndInstall 触发）直接放行。 */
  const prepareQuit = async (): Promise<void> => {
    quitApproved = true
    updates.dispose()
    for (const window of BrowserWindow.getAllWindows()) window.hide()
    await supervisor.stop().catch((error: unknown) => console.error('[coko] sidecar stop failed', error))
    log.info('app quitting', { sidecar: supervisor.state.phase })
    await logging.then((handle) => handle.dispose()).catch(() => undefined)
    readyToExit = true
  }

  const finishQuit = async (): Promise<void> => {
    await prepareQuit()
    app.quit()
  }

  app.on('before-quit', (event) => {
    if (readyToExit) return
    event.preventDefault()
    if (quitApproved) return
    void quitCoordinator.decide().then((approved) => {
      if (approved) return finishQuit()
    })
  })

  app.on('second-instance', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) return
    revealMainWindow(mainWindow, windowMode)
  })

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  void app.whenReady().then(() => {
    // 开发模式没有应用包的 icns，Dock 使用品牌图标；打包版本由 packagerConfig.icon 生成。
    if (development && process.platform === 'darwin') app.dock?.setIcon(join(appRoot, '..', '..', 'brand', 'rukie-app-icon.png'))
    const handler = createAppProtocolHandler({ renderer, endpoint: () => supervisor.endpoint })
    protocol.handle(APP_SCHEME, handler)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
      callback(
        decideWebSocketHeaders({
          mainWebContentsId: mainWindow?.isDestroyed() === false ? mainWindow.webContents.id : undefined,
          webContentsId: details.webContentsId,
          url: details.url,
          requestHeaders: details.requestHeaders,
          endpoint: supervisor.endpoint,
        }),
      )
    })

    const open = () => {
      mainWindow = createMainWindow(preload, windowMode)
      mainWindow.on('closed', () => {
        mainWindow = undefined
      })
    }
    open()
    app.on('activate', () => {
      if (mainWindow === undefined && !quitApproved) open()
    })

    void startup.then((result) => {
      if (!result.ok && !quitApproved) return showSidecarError('startup', result.error)
    })
  })
}

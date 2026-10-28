import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol, session, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { IPC, type BootFailure, type BootResult } from '../shared/bridge.ts'
import { APP_HOST, APP_SCHEME, createAppProtocolHandler, type RendererSource, type SidecarEndpoint } from './app-protocol.ts'
import { messagesFor } from './messages.ts'
import { QuitCoordinator } from './quit-coordinator.ts'
import { exchangeLaunchToken } from './sidecar-auth.ts'
import { SidecarProcess, SidecarStartError } from './sidecar-process.ts'
import { decideWebSocketHeaders } from './websocket-headers.ts'
import { createMainWindow, hardenWebContents } from './window.ts'

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  run()
}

function run(): void {
  const development = !app.isPackaged
  const appRoot = app.getAppPath()
  const preload = join(appRoot, 'dist', 'electron', 'preload.cjs')
  // 开发时允许用环境变量替换 sidecar 入口（测试用占位 sidecar）；安装包始终使用随包 sidecar。
  const sidecarEntry =
    development && process.env.COKO_SIDECAR_ENTRY
      ? resolve(process.env.COKO_SIDECAR_ENTRY)
      : development
        ? join(appRoot, 'dist', 'sidecar', 'index.mjs')
        : join(process.resourcesPath, 'sidecar', 'index.mjs')
  const devServerUrl = development ? process.env.COKO_RENDERER_DEV_URL : undefined
  const renderer: RendererSource = devServerUrl ? { kind: 'dev-server', url: devServerUrl } : { kind: 'directory', root: join(appRoot, 'dist', 'renderer') }

  let mainWindow: BrowserWindow | undefined
  let endpoint: SidecarEndpoint | undefined
  let quitApproved = false
  let readyToExit = false

  const messages = () => messagesFor(app.getLocale())

  const showMessageBox = (options: MessageBoxOptions) => {
    const owner = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
    return owner === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)
  }

  const showSidecarError = async (message: string, failure: BootFailure): Promise<void> => {
    const text = messages()
    const { response } = await showMessageBox({
      type: 'error',
      title: text.startupFailedTitle,
      message,
      detail: `${failure.message} (${failure.code})`,
      buttons: [text.quit, text.close],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) app.quit()
  }

  const sidecar = new SidecarProcess({
    execPath: process.execPath,
    entry: sidecarEntry,
    args: ['--data-dir', join(app.getPath('userData'), 'data'), '--log-dir', app.getPath('logs')],
    env: process.env,
    onStdout: (chunk) => process.stdout.write(chunk),
  })
  sidecar.onUnexpectedExit((info) => {
    endpoint = undefined
    if (quitApproved) return
    void showSidecarError(messages().crashedMessage, { code: 'sidecar-exited', message: `code ${String(info.code)}, signal ${String(info.signal)}` })
  })

  const startup: Promise<BootResult> = (async (): Promise<BootResult> => {
    try {
      const ready = await sidecar.start()
      const origin = `http://127.0.0.1:${ready.port}`
      endpoint = { origin, cookie: await exchangeLaunchToken(origin, ready.token) }
      // getLocale 需在 ready 之后调用。
      await app.whenReady()
      return { ok: true, info: { wsBaseUrl: `ws://127.0.0.1:${ready.port}`, platform: process.platform, locale: app.getLocale() } }
    } catch (error) {
      const failure: BootFailure =
        error instanceof SidecarStartError ? { code: error.code, message: error.message } : { code: 'sidecar-auth', message: (error as Error).message }
      if (error instanceof SidecarStartError && error.diagnostic !== '') console.error('[coko] sidecar diagnostic:\n' + error.diagnostic)
      await sidecar.stop().catch(() => undefined)
      return { ok: false, error: failure }
    }
  })()

  // 只接受主窗口主框架、coko-app://app 文档发出的 IPC。
  const assertMainFrame = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = mainWindow
    const frame = event.senderFrame
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents || frame === null || frame !== window.webContents.mainFrame) {
      throw new Error('Rejected IPC from an unowned frame')
    }
    const url = new URL(frame.url)
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) throw new Error('Rejected IPC from an unowned document')
    return window
  }

  ipcMain.handle(IPC.boot, async (event) => {
    assertMainFrame(event)
    return startup
  })

  let picking: Promise<string | null> | undefined
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

  const quitCoordinator = new QuitCoordinator(() => ({
    inspect: sidecar.isReady ? () => sidecar.inspectQuit() : undefined,
    confirm: async ({ activeRuns }) => {
      const text = messages()
      const { response } = await showMessageBox({
        type: 'warning',
        message: text.confirmQuitMessage,
        detail: text.confirmQuitDetail(activeRuns),
        buttons: [text.quit, text.cancel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      return response === 0
    },
  }))

  const finishQuit = async (): Promise<void> => {
    quitApproved = true
    for (const window of BrowserWindow.getAllWindows()) window.hide()
    endpoint = undefined
    await sidecar.stop().catch((error: unknown) => console.error('[coko] sidecar stop failed', error))
    readyToExit = true
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
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  void app.whenReady().then(() => {
    const handler = createAppProtocolHandler({ renderer, endpoint: () => endpoint })
    protocol.handle(APP_SCHEME, handler)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
      callback(
        decideWebSocketHeaders({
          mainWebContentsId: mainWindow?.isDestroyed() === false ? mainWindow.webContents.id : undefined,
          webContentsId: details.webContentsId,
          url: details.url,
          requestHeaders: details.requestHeaders,
          endpoint,
        }),
      )
    })

    const open = () => {
      mainWindow = createMainWindow(preload)
      mainWindow.on('closed', () => {
        mainWindow = undefined
      })
    }
    open()
    app.on('activate', () => {
      if (mainWindow === undefined && !quitApproved) open()
    })

    void startup.then((result) => {
      if (!result.ok && !quitApproved) return showSidecarError(messages().startupFailedMessage, result.error)
    })
  })
}

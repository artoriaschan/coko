import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { APP_ORIGIN } from './app-protocol.ts'

export interface MainWindowMode {
  /** E2E 后台模式（e2e-background.ts）：不激活、不聚焦，窗口透明且不接收鼠标。 */
  background: boolean
}

/** 主窗口参数：macOS 隐藏标题栏、红绿灯位置与侧栏材质，几何沿用信息架构决定。 */
export function mainWindowOptions(preload: string, mode: MainWindowMode = { background: false }): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show: false,
    title: 'Coko',
    ...(process.platform === 'darwin'
      ? {
          // 使用 hidden 而非 hiddenInset：不保留覆盖在内容之上的原生标题栏条带，
          // 左上角自绘的控制按钮才能收到鼠标事件；拖拽区由 data-window-drag 显式提供。
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 16, y: 18 },
          vibrancy: 'sidebar' as const,
          // 失焦时保持材质稳定。
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      // 后台模式的窗口总在其他窗口之下，关闭节流使 rAF 与计时器按前台节奏运行。
      ...(mode.background ? { backgroundThrottling: false } : {}),
    },
    ...(mode.background ? { skipTaskbar: true } : {}),
  }
}

/** 只允许停留在 coko-app://app；外部 http(s) 链接交给系统浏览器，其余拒绝。 */
export function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN + '/')) event.preventDefault()
  })
}

/**
 * 显示主窗口（首次 ready-to-show 与第二实例启动时）。后台模式下 showInactive 不激活应用，透明度 0 且忽略鼠标，
 * 窗口仍在屏幕上合成，渲染、rAF 与计时器照常运行；Playwright 经 CDP 注入输入，不受 setIgnoreMouseEvents 影响。
 */
export function revealMainWindow(window: BrowserWindow, mode: MainWindowMode): void {
  if (mode.background) {
    window.setOpacity(0)
    window.setIgnoreMouseEvents(true)
    window.showInactive()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function createMainWindow(preload: string, mode: MainWindowMode = { background: false }): BrowserWindow {
  const window = new BrowserWindow(mainWindowOptions(preload, mode))
  window.once('ready-to-show', () => (mode.background ? revealMainWindow(window, mode) : window.show()))
  void window.loadURL(`${APP_ORIGIN}/`)
  return window
}

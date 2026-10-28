import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { APP_ORIGIN } from './app-protocol.ts'

/** 主窗口参数：macOS 隐藏标题栏、红绿灯位置与侧栏材质，几何沿用信息架构决定。 */
export function mainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show: false,
    title: 'Coko',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
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
    },
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

export function createMainWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow(mainWindowOptions(preload))
  window.once('ready-to-show', () => window.show())
  void window.loadURL(`${APP_ORIGIN}/`)
  return window
}

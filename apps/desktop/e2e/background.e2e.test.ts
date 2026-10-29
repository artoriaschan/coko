// E2E 后台模式（harness 默认设置 COKO_E2E_BACKGROUND=1）：窗口在真实 Electron 中渲染、可交互，但应用不激活、不显示
// Dock 图标、窗口透明。全量运行期间的前台应用采样见 e2e/foreground-watch.ts。
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 未设置 COKO_E2E_VISIBLE 时才断言后台行为；本地调试显示窗口时跳过。 */
const background = process.env.COKO_E2E_VISIBLE !== '1'

/** lsappinfo 不需要辅助功能权限：读取进程的应用类型（accessory 为 UIElement，不在 Dock 中）。 */
function applicationType(pid: number): string | undefined {
  const out = execFileSync('lsappinfo', ['info', '-only', 'applicationtype', String(pid)], { encoding: 'utf8' })
  return /"ApplicationType"="([^"]+)"/.exec(out)?.[1]
}

describe.skipIf(!background)('E2E 后台模式', () => {
  it('主窗口以不激活方式显示：透明、不聚焦、不在任务栏，renderer 照常渲染', async () => {
    const app = await launchApp()
    apps.push(app)
    await waitConnected(app.window)
    const info = await app.app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        visible: window.isVisible(),
        focused: window.isFocused(),
        opacity: window.getOpacity(),
        dock: process.platform === 'darwin' ? electronApp.dock!.isVisible() : null,
        pid: process.pid,
      }
    })
    const darwin = process.platform === 'darwin'
    expect({ ...info, type: darwin ? applicationType(info.pid) : null }).toMatchObject({
      visible: true,
      focused: false,
      opacity: 0,
      dock: darwin ? false : null,
      type: darwin ? 'UIElement' : null,
    })

    // 窗口在其他应用之下也不节流：1 秒内 rAF 接近帧率，50ms 计时器接近 20 次（节流时分别降到 0 与约 1 次）。
    const timing = await app.window.evaluate(
      () =>
        new Promise<{ frames: number; ticks: number; visibility: string }>((resolve) => {
          let frames = 0
          let ticks = 0
          const loop = () => {
            frames++
            requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
          const timer = setInterval(() => ticks++, 50)
          setTimeout(() => {
            clearInterval(timer)
            resolve({ frames, ticks, visibility: document.visibilityState })
          }, 1000)
        }),
    )
    expect(timing.visibility).toBe('visible')
    expect(timing.frames).toBeGreaterThan(20)
    expect(timing.ticks).toBeGreaterThan(10)
  })
})

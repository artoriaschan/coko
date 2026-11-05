import { commands } from 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    setReducedMotion(reduced: boolean): Promise<void>
    setBrowserScale(scale: number): Promise<number>
  }
}

/** 修改真实 Chromium 媒体偏好；调用方必须在用例结束时恢复。 */
export const setReducedMotion = (reduced: boolean) => commands.setReducedMotion(reduced)

/** 修改 Chromium 的真实页面缩放；调用方必须恢复为 1。 */
export const setBrowserScale = (scale: number) => commands.setBrowserScale(scale)

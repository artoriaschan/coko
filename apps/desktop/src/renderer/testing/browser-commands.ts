import { commands } from 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    setReducedMotion(reduced: boolean): Promise<void>
  }
}

/** 修改真实 Chromium 媒体偏好；调用方必须在用例结束时恢复。 */
export const setReducedMotion = (reduced: boolean) => commands.setReducedMotion(reduced)

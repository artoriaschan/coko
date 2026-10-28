/// <reference types="vite/client" />
import type { CokoBridge } from '../shared/bridge.ts'

declare global {
  interface Window {
    /** preload 暴露的受控 API；只在 coko-app://app 主窗口中存在。 */
    readonly coko?: CokoBridge
  }
}

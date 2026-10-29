import type { BuildKind } from './sidecar-env.ts'

/**
 * E2E 后台模式：桌面 E2E harness 与产物 smoke 默认设置 COKO_E2E_BACKGROUND=1，应用在真实 Electron 中渲染与交互，但不激活、
 * 不显示 Dock 图标、窗口透明且不接收鼠标（见 window.ts 的 revealMainWindow）。本地调试时设置 COKO_E2E_VISIBLE=1 恢复正常显示。
 */
export const E2E_BACKGROUND_ENV = 'COKO_E2E_BACKGROUND'
export const E2E_VISIBLE_ENV = 'COKO_E2E_VISIBLE'

/** 只在未打包或测试构建中生效；打包的发布构建与其他测试钩子一样忽略该开关。 */
export function e2eBackgroundEnabled(env: NodeJS.ProcessEnv, kind: BuildKind): boolean {
  if (kind.packaged && !kind.testBuild) return false
  return env[E2E_BACKGROUND_ENV] === '1' && env[E2E_VISIBLE_ENV] !== '1'
}

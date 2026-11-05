/** 三栏几何，数值沿用信息架构决定（DSH AppFrame）。 */
export const SIDEBAR_MIN_WIDTH = 264
export const SIDEBAR_MAX_WIDTH = 420
export const SIDEBAR_DEFAULT_WIDTH = 280
/** 收起时侧栏整列隐藏，控制按钮移到主内容左上角。 */
export const SIDEBAR_COLLAPSED_WIDTH = 0
/** 收起后主内容顶部的控制条宽度（展开、后退、前进、新对话）。 */
export const COLLAPSED_CONTROLS_WIDTH = 216
/** 帧宽低于该值时侧栏自动收起。 */
export const AUTO_COLLAPSE_BELOW = 1024
export const CENTER_MIN_WIDTH = 400
export const RIGHT_MIN_WIDTH = 300
export const RIGHT_DEFAULT_RATIO = 0.45
export const RIGHT_MAX_RATIO = 0.7
/** 低于此帧宽时右栏自动全屏；不改变用户保存的普通/全屏偏好。 */
export const RIGHT_AUTO_FULLSCREEN_BELOW = 768

export interface FrameLayoutInput {
  frameWidth: number
  sidebarWidth: number
  sidebarCollapsed: boolean
  rightOpen: boolean
  rightFullscreen?: boolean
  /** 用户拖动后记住的右栏宽度；未设置时为帧宽的 45%。 */
  rightWidth?: number | undefined
}

export interface FrameLayout {
  /** 窄窗口：侧栏不占列宽，展开时以抽屉覆盖中栏。 */
  narrow: boolean
  sidebar: 'expanded' | 'hidden'
  /** 第一列的实际宽度。 */
  sidebarColumn: number
  right: 'closed' | 'column' | 'fullscreen'
  /** 普通形态的底层列宽；全屏时保留，窄窗口自动全屏为 0。 */
  rightColumn: number
}

export const clampSidebarWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))

/** 右栏不能挤占中栏的最小阅读宽度，也不改变左侧栏。 */
export const rightPanelMaxWidth = (frameWidth: number, sidebarColumn: number) =>
  Math.min(frameWidth * RIGHT_MAX_RATIO, frameWidth - sidebarColumn - CENTER_MIN_WIDTH)
export const clampRightPanelWidth = (width: number, frameWidth: number, sidebarColumn: number) =>
  Math.round(Math.max(RIGHT_MIN_WIDTH, Math.min(width, rightPanelMaxWidth(frameWidth, sidebarColumn))))

/**
 * 右栏先缩小，再整栏收起，左侧栏不让位。全屏使用相同的底层列宽，窄窗口不分配右栏列。
 */
export function computeFrameLayout(input: FrameLayoutInput): FrameLayout {
  const { frameWidth } = input
  const narrow = frameWidth < AUTO_COLLAPSE_BELOW
  const sidebar: FrameLayout['sidebar'] = narrow || input.sidebarCollapsed ? 'hidden' : 'expanded'
  const sidebarColumn = sidebar === 'hidden' ? SIDEBAR_COLLAPSED_WIDTH : clampSidebarWidth(input.sidebarWidth)

  if (!input.rightOpen) return { narrow, sidebar, sidebarColumn, right: 'closed', rightColumn: 0 }

  const ideal = input.rightWidth ?? frameWidth * RIGHT_DEFAULT_RATIO
  const preferred = Math.round(Math.min(frameWidth * RIGHT_MAX_RATIO, Math.max(RIGHT_MIN_WIDTH, ideal)))
  const fit = (side: number) => Math.min(preferred, frameWidth - side - CENTER_MIN_WIDTH)

  const rightColumn = fit(sidebarColumn)
  if (input.rightFullscreen || frameWidth < RIGHT_AUTO_FULLSCREEN_BELOW) {
    return {
      narrow,
      sidebar,
      sidebarColumn,
      right: 'fullscreen',
      rightColumn: frameWidth < RIGHT_AUTO_FULLSCREEN_BELOW || rightColumn < RIGHT_MIN_WIDTH ? 0 : rightColumn,
    }
  }
  if (rightColumn >= RIGHT_MIN_WIDTH) return { narrow, sidebar, sidebarColumn, right: 'column', rightColumn }
  return { narrow, sidebar, sidebarColumn, right: 'closed', rightColumn: 0 }
}

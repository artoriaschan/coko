/** 三栏几何，数值沿用信息架构决定（DSH AppFrame）。 */
export const SIDEBAR_MIN_WIDTH = 264
export const SIDEBAR_MAX_WIDTH = 420
export const SIDEBAR_DEFAULT_WIDTH = 280
export const RAIL_WIDTH = 56
/** 帧宽低于该值时侧栏自动收起为 rail。 */
export const AUTO_COLLAPSE_BELOW = 1024
export const CENTER_MIN_WIDTH = 400
export const RIGHT_MIN_WIDTH = 300
export const RIGHT_DEFAULT_RATIO = 0.45
export const RIGHT_MAX_RATIO = 0.7

export interface FrameLayoutInput {
  frameWidth: number
  sidebarWidth: number
  sidebarCollapsed: boolean
  rightOpen: boolean
  /** 用户拖动后记住的右栏宽度；未设置时为帧宽的 45%。 */
  rightWidth?: number
}

export interface FrameLayout {
  /** 窄窗口：侧栏只以 rail 出现，展开时以抽屉覆盖中栏。 */
  narrow: boolean
  sidebar: 'expanded' | 'rail'
  /** 第一列的实际宽度。 */
  sidebarColumn: number
  right: 'closed' | 'column' | 'overlay'
  rightColumn: number
}

export const clampSidebarWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))

/**
 * 计算三栏布局。空间不足时依次：右栏缩到最小宽度 → 侧栏收为 rail → 右栏改为覆盖中栏。
 * 中栏不低于 CENTER_MIN_WIDTH 只在有右栏时作为让位规则；帧本身窄于该值时中栏取剩余宽度。
 */
export function computeFrameLayout(input: FrameLayoutInput): FrameLayout {
  const { frameWidth } = input
  const narrow = frameWidth < AUTO_COLLAPSE_BELOW
  let sidebar: FrameLayout['sidebar'] = narrow || input.sidebarCollapsed ? 'rail' : 'expanded'
  let sidebarColumn = sidebar === 'rail' ? RAIL_WIDTH : clampSidebarWidth(input.sidebarWidth)

  if (!input.rightOpen) return { narrow, sidebar, sidebarColumn, right: 'closed', rightColumn: 0 }

  const ideal = input.rightWidth ?? frameWidth * RIGHT_DEFAULT_RATIO
  const preferred = Math.round(Math.min(frameWidth * RIGHT_MAX_RATIO, Math.max(RIGHT_MIN_WIDTH, ideal)))
  const fit = (side: number) => Math.min(preferred, frameWidth - side - CENTER_MIN_WIDTH)

  let rightColumn = fit(sidebarColumn)
  if (rightColumn < RIGHT_MIN_WIDTH && sidebar === 'expanded') {
    sidebar = 'rail'
    sidebarColumn = RAIL_WIDTH
    rightColumn = fit(sidebarColumn)
  }
  if (rightColumn >= RIGHT_MIN_WIDTH) return { narrow, sidebar, sidebarColumn, right: 'column', rightColumn }
  return { narrow, sidebar, sidebarColumn, right: 'overlay', rightColumn: Math.min(preferred, frameWidth - sidebarColumn) }
}

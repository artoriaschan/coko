import { clampSidebarWidth, RIGHT_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH } from '@coko/ui'

export const FRAME_WIDTHS_KEY = 'coko.app-frame.v1'

export interface FrameWidths {
  sidebarWidth: number
  rightWidth?: number
}

/** 只保存用户调整后的像素宽度；窗口适配和面板开合不改写偏好。 */
export function readFrameWidths(): FrameWidths {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FRAME_WIDTHS_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      return {
        sidebarWidth:
          'sidebarWidth' in value && typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)
            ? clampSidebarWidth(value.sidebarWidth)
            : SIDEBAR_DEFAULT_WIDTH,
        ...('rightWidth' in value && typeof value.rightWidth === 'number' && Number.isFinite(value.rightWidth) && value.rightWidth >= RIGHT_MIN_WIDTH
          ? { rightWidth: Math.round(value.rightWidth) }
          : {}),
      }
    }
  } catch {
    // 损坏记录或禁用存储时使用默认大小。
  }
  return { sidebarWidth: SIDEBAR_DEFAULT_WIDTH }
}

export function saveFrameWidths(widths: FrameWidths): void {
  try {
    localStorage.setItem(FRAME_WIDTHS_KEY, JSON.stringify(widths))
  } catch {
    // 存储不可用时，当前窗口仍保留内存中的选择。
  }
}

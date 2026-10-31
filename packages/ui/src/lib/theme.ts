export type Theme = 'light' | 'dark'

/** 切换期间根元素上的属性：theme.css 在其下关闭全部 transition。 */
const SWITCHING = 'data-theme-switching'

let pending: number | undefined

/**
 * 切换明暗主题（document 根元素的 dark 类）。切换的这一帧关闭 transition 并立即重算样式，使颜色直接落到新主题的 token，
 * 不经 transition-colors 在两套 token 之间插值（插值中途的 primary 呈灰色）；下一帧恢复，hover 等状态照常过渡。
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (root.classList.contains('dark') === (theme === 'dark')) return
  root.setAttribute(SWITCHING, '')
  root.classList.toggle('dark', theme === 'dark')
  // 在关闭过渡的状态下重算一次样式：之后恢复过渡时，起点已是新主题的颜色。
  void getComputedStyle(root).color
  if (pending !== undefined) cancelAnimationFrame(pending)
  pending = requestAnimationFrame(() => {
    pending = undefined
    root.removeAttribute(SWITCHING)
  })
}

import { createStore } from 'zustand/vanilla'

/** 页面种类就是 tab 身份；开始页也遵守单例规则。 */
export type RightPanelTabId = 'plan' | 'jobs' | 'agents' | 'schedules' | 'team' | 'trace'
export type RightPanelPageKind = RightPanelTabId | 'start'
export interface RightPanelLayout {
  tabs: readonly RightPanelPageKind[]
  active: RightPanelPageKind | null
  expanded: boolean
}
const INITIAL_LAYOUT: RightPanelLayout = { tabs: [], active: null, expanded: false }

/** 仅持有界面布局；与 React、页面正文及 Session 数据无关。 */
export const rightPanelLayoutStore = createStore<{ sessions: Record<string, RightPanelLayout>; attention: { sessionId: string; revision: number } | null }>()(
  () => ({ sessions: {}, attention: null }),
)
export const getRightPanelLayout = (sessionId: string | null): RightPanelLayout =>
  sessionId === null ? INITIAL_LAYOUT : (rightPanelLayoutStore.getState().sessions[sessionId] ?? INITIAL_LAYOUT)

function update(sessionId: string, layout: RightPanelLayout) {
  rightPanelLayoutStore.setState(({ sessions }) => ({ sessions: { ...sessions, [sessionId]: layout } }))
}

export function openPage(sessionId: string | null, kind: RightPanelPageKind) {
  if (sessionId === null) return false
  const layout = getRightPanelLayout(sessionId)
  const attention = rightPanelLayoutStore.getState().attention
  rightPanelLayoutStore.setState({ attention: layout.expanded && layout.active === kind ? { sessionId, revision: (attention?.revision ?? 0) + 1 } : null })
  let tabs = layout.tabs
  if (!tabs.includes(kind)) {
    const start = tabs.indexOf('start')
    tabs = start < 0 ? [...tabs, kind] : tabs.map((tab, index) => (index === start ? kind : tab))
  }
  update(sessionId, { ...layout, tabs, active: kind, expanded: true })
  return true
}

export function setRightPanelExpanded(sessionId: string | null, expanded: boolean) {
  if (sessionId === null) return
  const layout = getRightPanelLayout(sessionId)
  if (expanded && layout.tabs.length === 0) return void openPage(sessionId, 'start')
  update(sessionId, { ...layout, expanded })
}

export function selectPage(sessionId: string, kind: RightPanelPageKind) {
  const layout = getRightPanelLayout(sessionId)
  if (layout.tabs.includes(kind)) update(sessionId, { ...layout, active: kind })
}

export function closePage(sessionId: string, kind: RightPanelPageKind) {
  const layout = getRightPanelLayout(sessionId)
  if (layout.tabs.length === 1 && kind === 'start') return
  const index = layout.tabs.indexOf(kind)
  if (index < 0) return
  const tabs = layout.tabs.filter((tab) => tab !== kind)
  const active = layout.active === kind ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : layout.active
  update(sessionId, { ...layout, tabs, active, expanded: tabs.length > 0 && layout.expanded })
}

/** 只移动本 Session 的页面，活动项保持不变。 */
export function movePage(sessionId: string, kind: RightPanelPageKind, index: number) {
  const layout = getRightPanelLayout(sessionId)
  const from = layout.tabs.indexOf(kind)
  if (from < 0) return
  const tabs = [...layout.tabs]
  tabs.splice(from, 1)
  tabs.splice(Math.max(0, Math.min(tabs.length, index)), 0, kind)
  update(sessionId, { ...layout, tabs })
}

/** 批量关闭限定在当前 Session；选择被关闭时落到仍存在的相邻项。 */
export function closeOtherPages(sessionId: string, kind: RightPanelPageKind) {
  const layout = getRightPanelLayout(sessionId)
  if (!layout.tabs.includes(kind)) return
  update(sessionId, { ...layout, tabs: [kind], active: kind })
}

export function closePagesToRight(sessionId: string, kind: RightPanelPageKind) {
  const layout = getRightPanelLayout(sessionId)
  const index = layout.tabs.indexOf(kind)
  if (index < 0) return
  const tabs = layout.tabs.slice(0, index + 1)
  update(sessionId, { ...layout, tabs, active: layout.active && tabs.includes(layout.active) ? layout.active : kind })
}

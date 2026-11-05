import { createStore } from 'zustand/vanilla'
import { createRendererLog } from '../../app/renderer-log.ts'
import { INITIAL_RIGHT_PANEL_LAYOUT, parseRightPanelLayout, RIGHT_PANEL_LAYOUT_PREFIX, RIGHT_PANEL_PAGE_KINDS } from './layout-persistence.ts'

/** 页面种类就是 tab 身份；开始页也遵守单例规则。 */
export type RightPanelTabId = 'plan' | 'jobs' | 'agents' | 'schedules' | 'team' | 'trace' | 'diagnostics'
export type RightPanelPageKind = RightPanelTabId | 'start'
export interface RightPanelLayout {
  tabs: readonly RightPanelPageKind[]
  active: RightPanelPageKind | null
  expanded: boolean
  mode: 'normal' | 'fullscreen'
}
const INITIAL_LAYOUT = INITIAL_RIGHT_PANEL_LAYOUT

/** 仅持有界面布局；与 React、页面正文及 Session 数据无关。 */
export const rightPanelLayoutStore = createStore<{ sessions: Record<string, RightPanelLayout>; attention: { sessionId: string; revision: number } | null }>()(
  () => ({ sessions: {}, attention: null }),
)
// 恢复只缓存读回值，不在 React 的 getSnapshot 中发布状态；下一次动作才采用到新的不可变快照。
// 缓存依附 sessions 快照，测试或宿主重置快照后不会沿用旧的读回值。
const restored = new WeakMap<Record<string, RightPanelLayout>, Map<string, RightPanelLayout>>()
let availablePages = RIGHT_PANEL_PAGE_KINDS
let storageFailureReported = false

export function getRightPanelLayout(sessionId: string | null): RightPanelLayout {
  if (sessionId === null) return INITIAL_LAYOUT
  const { sessions } = rightPanelLayoutStore.getState()
  if (sessions[sessionId]) return sessions[sessionId]
  let cache = restored.get(sessions)
  if (!cache) restored.set(sessions, (cache = new Map()))
  const current = cache.get(sessionId)
  if (current) return current
  let layout = INITIAL_LAYOUT
  if (typeof window !== 'undefined') {
    const key = RIGHT_PANEL_LAYOUT_PREFIX + sessionId
    try {
      const storage = window.localStorage
      const raw = storage.getItem(key)
      if (raw !== null) {
        const parsed = parseRightPanelLayout(JSON.parse(raw), availablePages)
        if (parsed) layout = parsed
        else storage.removeItem(key)
      }
    } catch {
      // 损坏记录只清除本 Session；禁用存储时仍可使用内存布局。
      try {
        window.localStorage.removeItem(key)
      } catch {
        /* 存储不可用。 */
      }
    }
  }
  cache.set(sessionId, layout)
  return layout
}

function adoptedLayouts() {
  const { sessions } = rightPanelLayoutStore.getState()
  return { ...Object.fromEntries(restored.get(sessions) ?? []), ...sessions }
}

/** 可用条件变化只作用于已采用的内存布局；未打开 Session 的键留待读回过滤。 */
export function setAvailableRightPanelPages(kinds: readonly RightPanelPageKind[]) {
  const next = [...new Set<RightPanelPageKind>(['start', ...kinds])]
  if (next.length === availablePages.length && next.every((kind) => availablePages.includes(kind))) return
  availablePages = next
  const sessions = Object.fromEntries(
    Object.entries(adoptedLayouts()).map(([id, layout]) => [id, parseRightPanelLayout(layout, availablePages) ?? INITIAL_LAYOUT]),
  )
  rightPanelLayoutStore.setState({ sessions, attention: null })
}

/** 永久删除按协议返回的身份清理；归档不调用，也不从当前列表猜测子 Session。 */
export function forgetRightPanelLayouts(sessionIds: readonly string[]) {
  const deleted = new Set(sessionIds)
  const { attention } = rightPanelLayoutStore.getState()
  const next = {
    sessions: Object.fromEntries(Object.entries(adoptedLayouts()).filter(([id]) => !deleted.has(id))),
    attention: attention && deleted.has(attention.sessionId) ? null : attention,
  }
  try {
    if (typeof window !== 'undefined') {
      const storage = window.localStorage
      for (const key of Object.keys(storage)) {
        const id = /^coko\.right-panel\.v\d+\.(.+)$/.exec(key)?.[1]
        if (id !== undefined && deleted.has(id)) storage.removeItem(key)
      }
    }
  } catch {
    reportStorageFailure()
  }
  // 先移除存储，再通知订阅者，避免它们把刚删除的 Session 从旧键重新读入缓存。
  rightPanelLayoutStore.setState(next)
}

function reportStorageFailure() {
  if (storageFailureReported) return
  storageFailureReported = true
  createRendererLog(typeof window === 'undefined' ? undefined : window.coko).send({
    level: 'warning',
    category: ['right-panel'],
    message: 'layout persistence failed',
  })
}

function update(sessionId: string, layout: RightPanelLayout) {
  rightPanelLayoutStore.setState({ sessions: { ...adoptedLayouts(), [sessionId]: layout } })
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(RIGHT_PANEL_LAYOUT_PREFIX + sessionId, JSON.stringify(layout))
  } catch {
    reportStorageFailure()
  }
}

export function openPage(sessionId: string | null, kind: RightPanelPageKind) {
  if (sessionId === null || !availablePages.includes(kind)) return false
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

/** 只保存用户选择；窄窗口的自动全屏不写入布局。 */
export function setRightPanelMode(sessionId: string | null, mode: RightPanelLayout['mode']) {
  if (sessionId !== null) update(sessionId, { ...getRightPanelLayout(sessionId), mode })
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

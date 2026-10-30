import type * as React from 'react'
import type { RightPanelTabId } from '../right-panel/tabs.ts'

/** 会话标题栏的操作 id：后台任务按钮（running 数徽标）与 Session 费用。 */
export type HeaderActionId = 'jobs' | 'cost'

export interface HeaderActionProps {
  sessionId: string
  /** 打开右栏并切到某个 tab（例如后台任务按钮打开 Jobs tab）。 */
  openTab: (tab: RightPanelTabId) => void
}

export interface HeaderActionDefinition {
  id: HeaderActionId
  Component: React.ComponentType<HeaderActionProps>
  /** false：功能尚未交付，不挂载。交付该操作的票只把自己的一行改为 true，并把 Component 换成自己的组件。 */
  available: boolean
}

/** 未交付操作的占位：available 为 false 时不会挂载。 */
function Unavailable() {
  return null
}

export const HEADER_ACTIONS: readonly HeaderActionDefinition[] = [
  { id: 'jobs', Component: Unavailable, available: false },
  { id: 'cost', Component: Unavailable, available: false },
]

export const visibleHeaderActions = (actions: readonly HeaderActionDefinition[] = HEADER_ACTIONS) => actions.filter((action) => action.available)

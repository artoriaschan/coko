import type * as React from 'react'
import type { RightPanelTabId } from '../right-panel/tabs.ts'
import { HandoffButton } from './handoff-dialog.tsx'
import { JobsButton } from './jobs-button.tsx'
import { SessionCost } from './session-cost.tsx'

/** 会话标题栏的操作 id：后台任务按钮（running 数徽标）、Session 费用，以及 M5 的子代理、定时任务与交接。 */
export type HeaderActionId = 'jobs' | 'cost' | 'agents' | 'schedules' | 'handoff'

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

/** 未交付操作的占位：available 为 false，不会挂载。 */
function Unavailable() {
  return null
}

export const HEADER_ACTIONS: readonly HeaderActionDefinition[] = [
  { id: 'jobs', Component: JobsButton, available: true },
  { id: 'cost', Component: SessionCost, available: true },
  { id: 'agents', Component: Unavailable, available: false },
  { id: 'schedules', Component: Unavailable, available: false },
  { id: 'handoff', Component: HandoffButton, available: true },
]

export const visibleHeaderActions = (actions: readonly HeaderActionDefinition[] = HEADER_ACTIONS) => actions.filter((action) => action.available)

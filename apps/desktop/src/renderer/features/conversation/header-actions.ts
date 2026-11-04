import * as React from 'react'
import type { RightPanelTabId } from '../right-panel/tabs.ts'
import { AgentsButton } from './agents-button.tsx'
import { JobsButton } from './jobs-button.tsx'
import { SchedulesButton } from './schedules-button.tsx'
import { TeamButton } from './team-button.tsx'

/** 会话标题栏的操作 id：后台任务按钮（running 数徽标），子代理、定时任务与团队。 */
export type HeaderActionId = 'jobs' | 'agents' | 'schedules' | 'team'

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

export const HEADER_ACTIONS: readonly HeaderActionDefinition[] = [
  { id: 'jobs', Component: JobsButton, available: true },
  { id: 'agents', Component: AgentsButton, available: true },
  { id: 'schedules', Component: SchedulesButton, available: true },
  { id: 'team', Component: TeamButton, available: true },
]

export const visibleHeaderActions = (actions: readonly HeaderActionDefinition[] = HEADER_ACTIONS) => actions.filter((action) => action.available)

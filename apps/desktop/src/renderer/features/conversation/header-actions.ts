import * as React from 'react'
import type { RightPanelTabId } from '../right-panel/tabs.ts'
import { AgentsButton } from './agents-button.tsx'
import { HandoffButton, HandoffMenuItem } from './handoff-dialog.tsx'
import { JobsButton } from './jobs-button.tsx'
import { SchedulesButton } from './schedules-button.tsx'
import { TeamButton } from './team-button.tsx'

/** 会话标题栏的操作 id：后台任务按钮（running 数徽标），M5 的子代理、定时任务与交接，以及 M6 的团队。 */
export type HeaderActionId = 'jobs' | 'agents' | 'schedules' | 'handoff' | 'team'

export interface HeaderActionProps {
  sessionId: string
  /** 打开右栏并切到某个 tab（例如后台任务按钮打开 Jobs tab）。 */
  openTab: (tab: RightPanelTabId) => void
}

export interface HeaderActionDefinition {
  id: HeaderActionId
  Component: React.ComponentType<HeaderActionProps>
  /**
   * 窄主区（主列窄于 560 px）时的呈现：标题栏"更多操作"菜单中的一项（DropdownMenuItem）。此时 Component 仍挂载但隐藏，它持有的对话框
   * 照常工作，菜单项只请求它打开。省略时该操作在任何宽度下都留在标题栏（状态类操作，例如带 running 数的后台任务）。
   */
  MenuItem?: React.ComponentType<HeaderActionProps>
  /** false：功能尚未交付，不挂载。交付该操作的票只把自己的一行改为 true，并把 Component 换成自己的组件。 */
  available: boolean
}

/**
 * "更多操作"菜单项执行动作的方式：动作在菜单关闭、焦点回到菜单按钮之后执行。菜单项打开对话框时用它，对话框打开时记下的是菜单按钮，
 * 关闭后焦点回到那里（菜单项已卸载）；否则菜单关闭时会把焦点从刚打开的对话框中拉走。菜单之外（测试）直接执行。
 */
export const HeaderMenuActionContext = React.createContext<(action: () => void) => void>((action) => action())

export const HEADER_ACTIONS: readonly HeaderActionDefinition[] = [
  { id: 'jobs', Component: JobsButton, available: true },
  { id: 'agents', Component: AgentsButton, available: true },
  { id: 'schedules', Component: SchedulesButton, available: true },
  { id: 'handoff', Component: HandoffButton, MenuItem: HandoffMenuItem, available: true },
  { id: 'team', Component: TeamButton, available: true },
]

export const visibleHeaderActions = (actions: readonly HeaderActionDefinition[] = HEADER_ACTIONS) => actions.filter((action) => action.available)

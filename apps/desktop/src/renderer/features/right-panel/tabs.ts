import type { MessageKey } from '@coko/i18n'
import type * as React from 'react'
import { ActivityIcon, BracesIcon, BotIcon, CalendarClockIcon, ListTodoIcon, NetworkIcon, ScrollTextIcon, type LucideIcon } from 'lucide-react'
import type { RightPanelTabId } from './layout-store.ts'
export type { RightPanelTabId } from './layout-store.ts'
import { AgentsTab } from './agents-tab.tsx'
import { JobsTab } from './jobs-tab.tsx'
import { PlanTab } from './plan-tab.tsx'
import { SchedulesTab } from './schedules-tab.tsx'
import { TeamTab } from './team-tab.tsx'
import { SessionDiagnostics } from '../session-diagnostics/session-diagnostics.tsx'
import { TraceTab } from './trace-tab.tsx'

export interface RightPanelTabProps {
  /** 当前会话；没有会话（草稿或未选择）时为 null。 */
  sessionId: string | null
}

export interface RightPanelTabDefinition {
  id: RightPanelTabId
  icon: LucideIcon
  label: MessageKey
  Component: React.ComponentType<RightPanelTabProps>
  /** false：功能尚未交付，不显示。交付该 tab 的票只把自己的一行改为 true，并把 Component 换成自己的组件。 */
  available: boolean
}

export const RIGHT_PANEL_TABS: readonly RightPanelTabDefinition[] = [
  { id: 'plan', icon: ListTodoIcon, label: 'plan.tab', Component: PlanTab, available: true },
  { id: 'jobs', icon: ActivityIcon, label: 'jobs.tab', Component: JobsTab, available: true },
  { id: 'agents', icon: BotIcon, label: 'agents.tab', Component: AgentsTab, available: true },
  { id: 'schedules', icon: CalendarClockIcon, label: 'schedules.tab', Component: SchedulesTab, available: true },
  { id: 'team', icon: NetworkIcon, label: 'teams.tab', Component: TeamTab, available: true },
  { id: 'trace', icon: ScrollTextIcon, label: 'trace.tab', Component: TraceTab, available: true },
  { id: 'diagnostics', icon: BracesIcon, label: 'diagnostics.title', Component: SessionDiagnostics, available: true },
]

export const visibleRightPanelTabs = (tabs: readonly RightPanelTabDefinition[] = RIGHT_PANEL_TABS, sessionDiagnostics = false) =>
  tabs.filter((tab) => tab.available && (tab.id !== 'diagnostics' || sessionDiagnostics))

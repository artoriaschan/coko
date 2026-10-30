import type { MessageKey } from '@coko/i18n'
import type * as React from 'react'
import { createStore } from 'zustand/vanilla'
import { PlanTab } from './plan-tab.tsx'

/** 右栏的 tab id，按 RIGHT_PANEL_TABS 的顺序显示。 */
export type RightPanelTabId = 'plan' | 'jobs'

export interface RightPanelTabProps {
  /** 当前会话；没有会话（草稿或未选择）时为 null。 */
  sessionId: string | null
}

export interface RightPanelTabDefinition {
  id: RightPanelTabId
  label: MessageKey
  Component: React.ComponentType<RightPanelTabProps>
  /** false：功能尚未交付，不显示。交付该 tab 的票只把自己的一行改为 true，并把 Component 换成自己的组件。 */
  available: boolean
}

/** 未交付 tab 的占位：available 为 false 时不会挂载。 */
function Unavailable() {
  return null
}

export const RIGHT_PANEL_TABS: readonly RightPanelTabDefinition[] = [
  { id: 'plan', label: 'plan.tab', Component: PlanTab, available: true },
  { id: 'jobs', label: 'jobs.tab', Component: Unavailable, available: false },
]

export const visibleRightPanelTabs = (tabs: readonly RightPanelTabDefinition[] = RIGHT_PANEL_TABS) => tabs.filter((tab) => tab.available)

/** 选中的 tab（renderer 内存，不入记录）：标题栏操作或新计划可切换它；选中项不可见时显示第一个可见 tab。 */
export const rightPanelTabStore = createStore<{ selected: RightPanelTabId | null }>()(() => ({ selected: null }))

export const selectRightPanelTab = (tab: RightPanelTabId) => rightPanelTabStore.setState({ selected: tab })

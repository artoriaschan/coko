import * as React from 'react'
import type { Theme } from './appearance-store.ts'
import { resolveSection } from '../features/settings/sections.ts'
import type { WorkbenchNavigation } from './workbench-navigation.ts'

export const WorkbenchNavigationContext = React.createContext<WorkbenchNavigation | null>(null)

export function useWorkbenchNavigation() {
  const navigation = React.useContext(WorkbenchNavigationContext)
  if (!navigation) throw new Error('useWorkbenchNavigation must be used in the workbench')
  const state = React.useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  return { ...state, ...navigation }
}

/** 插件和定时任务复用同一设置分区组件；外层只提供内容区布局。 */
export function WorkbenchPage({ section, theme }: { section: 'plugins' | 'schedules'; theme: Theme }) {
  const Current = resolveSection(section).Component
  return (
    <div data-workbench-page={section} className="flex min-h-0 flex-1 flex-col bg-background">
      <div data-window-drag className="h-(--frame-top-clearance) shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-8">
        <div className="mx-auto w-full max-w-[800px]">
          <Current theme={theme} />
        </div>
      </div>
    </div>
  )
}

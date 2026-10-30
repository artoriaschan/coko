import * as React from 'react'
import { useStore } from 'zustand'
import type { SettingsActions, SettingsState, SettingsStore } from '../stores/settings-store.ts'
import type { Preferences } from './preferences.ts'
import type { SettingsPageStore } from './settings-page-store.ts'

interface SettingsContextValue {
  store: SettingsStore
  page: SettingsPageStore
  preferences: Preferences
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children, ...value }: SettingsContextValue & { children: React.ReactNode }) {
  const memo = React.useMemo(() => value, [value.store, value.page, value.preferences])
  return <SettingsContext.Provider value={memo}>{children}</SettingsContext.Provider>
}

function useSettingsContext(): SettingsContextValue {
  const value = React.useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>')
  return value
}

/** 订阅设置 store 的一个切片；selector 返回的引用应来自 store 自身。 */
export function useSettings<T>(selector: (state: SettingsState & SettingsActions) => T): T {
  return useStore(useSettingsContext().store, selector)
}

export function useSettingsActions(): SettingsActions {
  return useSettingsContext().store.getState()
}

/** 整页设置的显示状态与操作。 */
export function useSettingsPage() {
  const { page } = useSettingsContext()
  const state = React.useSyncExternalStore(page.subscribe, page.getSnapshot)
  return { ...state, open: page.open, back: page.back, toggle: page.toggle, setSection: page.setSection, setLeaveGuard: page.setLeaveGuard }
}

export function usePreferences(): Preferences {
  return useSettingsContext().preferences
}

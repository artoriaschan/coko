import * as React from 'react'
import { useStore } from 'zustand'
import type { SettingsActions, SettingsState, SettingsStore } from '../stores/settings-store.ts'
import type { Preferences } from './preferences.ts'
import type { SettingsDialogStore } from './settings-dialog-store.ts'

interface SettingsContextValue {
  store: SettingsStore
  dialog: SettingsDialogStore
  preferences: Preferences
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children, ...value }: SettingsContextValue & { children: React.ReactNode }) {
  const memo = React.useMemo(() => value, [value.store, value.dialog, value.preferences])
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

export function useSettingsDialog() {
  const { dialog } = useSettingsContext()
  const state = React.useSyncExternalStore(dialog.subscribe, dialog.getSnapshot)
  return { ...state, show: dialog.show, setSection: dialog.setSection, close: dialog.close, setLeaveGuard: dialog.setLeaveGuard }
}

export function usePreferences(): Preferences {
  return useSettingsContext().preferences
}

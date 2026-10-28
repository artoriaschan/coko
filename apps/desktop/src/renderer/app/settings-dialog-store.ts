export type SettingsSection = 'general' | 'models' | 'permissions' | 'about'

export interface SettingsDialogState {
  open: boolean
  section: SettingsSection
}

/** 设置弹窗的开关与分区（vanilla store）：Toast 的"去设置"等 React 之外的入口也能打开它。 */
export function createSettingsDialogStore() {
  let state: SettingsDialogState = { open: false, section: 'general' }
  const listeners = new Set<() => void>()
  const set = (next: SettingsDialogState) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    show: (section: SettingsSection = state.section) => set({ open: true, section }),
    setSection: (section: SettingsSection) => set({ ...state, section }),
    close: () => set({ ...state, open: false }),
  }
}

export type SettingsDialogStore = ReturnType<typeof createSettingsDialogStore>

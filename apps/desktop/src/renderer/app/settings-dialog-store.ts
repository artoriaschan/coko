import type { SettingsSectionId } from '../features/settings/sections.ts'

/** 分区 id 来自分区注册表（features/settings/sections.ts）。 */
export type SettingsSection = SettingsSectionId

export interface SettingsDialogState {
  open: boolean
  section: SettingsSection
}

/** 离开当前分区（切换分区或关闭弹窗）前的确认；返回 false 时留在原处。 */
export type SettingsLeaveGuard = () => Promise<boolean>

/** 设置弹窗的开关与分区（vanilla store）：Toast 的"去设置"等 React 之外的入口也能打开它。 */
export function createSettingsDialogStore() {
  let state: SettingsDialogState = { open: false, section: 'general' }
  let guard: SettingsLeaveGuard | null = null
  /** 确认进行中时，后续的离开请求不再重复询问。 */
  let pending = false
  const listeners = new Set<() => void>()
  const set = (next: SettingsDialogState) => {
    state = next
    for (const listener of listeners) listener()
  }
  /** 打开中的分区有未保存修改时先经守卫确认；确认后以确认时的状态为基准应用变化。 */
  const leave = (change: (current: SettingsDialogState) => SettingsDialogState) => {
    const next = change(state)
    const leaving = state.open && (!next.open || next.section !== state.section)
    if (!leaving || !guard) return set(next)
    if (pending) return
    pending = true
    void guard()
      .then((ok) => {
        if (ok) set(change(state))
      })
      .finally(() => {
        pending = false
      })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    show: (section?: SettingsSection) => leave((current) => ({ open: true, section: section ?? current.section })),
    setSection: (section: SettingsSection) => leave((current) => ({ ...current, section })),
    close: () => leave((current) => ({ ...current, open: false })),
    /** 分区登记离开守卫；返回撤销函数。同一时间只有一个守卫（当前分区的）。 */
    setLeaveGuard(next: SettingsLeaveGuard) {
      guard = next
      return () => {
        if (guard === next) guard = null
      }
    },
  }
}

export type SettingsDialogStore = ReturnType<typeof createSettingsDialogStore>

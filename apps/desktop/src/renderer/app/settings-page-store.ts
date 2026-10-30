import type { SettingsSectionId } from '../features/settings/sections.ts'

/** 分区 id 来自分区注册表（features/settings/sections.ts）。 */
export type SettingsSection = SettingsSectionId

export interface SettingsPageState {
  /** 整页设置是否显示；不显示时是应用（会话侧栏与聊天区）。 */
  visible: boolean
  section: SettingsSection
}

/** 离开当前分区（切换分区或返回应用）前的确认；返回 false 时留在原处。 */
export type SettingsLeaveGuard = () => Promise<boolean>

/** 整页设置的显示与分区（vanilla store）：Toast 的"去设置"等 React 之外的入口也能打开它。 */
export function createSettingsPageStore() {
  let state: SettingsPageState = { visible: false, section: 'general' }
  let guard: SettingsLeaveGuard | null = null
  /** 确认进行中时，后续的离开请求不再重复询问。 */
  let pending = false
  const listeners = new Set<() => void>()
  const set = (next: SettingsPageState) => {
    state = next
    for (const listener of listeners) listener()
  }
  /** 显示中的分区有未保存修改时先经守卫确认；确认后以确认时的状态为基准应用变化。 */
  const leave = (change: (current: SettingsPageState) => SettingsPageState) => {
    const next = change(state)
    const leaving = state.visible && (!next.visible || next.section !== state.section)
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
  const open = (section?: SettingsSection) => leave((current) => ({ visible: true, section: section ?? current.section }))
  const back = () => leave((current) => ({ ...current, visible: false }))
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 打开整页设置；给出分区时定位到它。 */
    open,
    /** 返回应用。 */
    back,
    /** ⌘, ：未打开时打开，已打开时返回应用。 */
    toggle: () => (state.visible ? back() : open()),
    setSection: (section: SettingsSection) => leave((current) => ({ ...current, section })),
    /** 分区登记离开守卫；返回撤销函数。同一时间只有一个守卫（当前分区的）。 */
    setLeaveGuard(next: SettingsLeaveGuard) {
      guard = next
      return () => {
        if (guard === next) guard = null
      }
    },
  }
}

export type SettingsPageStore = ReturnType<typeof createSettingsPageStore>

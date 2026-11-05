import { locales, type Locale } from '@coko/i18n'
import { RIGHT_PANEL_PAGE_KINDS } from '../features/right-panel/layout-persistence.ts'
import { setAvailableRightPanelPages } from '../features/right-panel/layout-store.ts'
import type { ApiError } from '../client/api.ts'
import type { SettingsStore } from '../stores/settings-store.ts'
import type { AppearanceStore, Theme } from './appearance-store.ts'

/** 主题与界面语言在 SettingsRepository 中的键（经 Sidecar 协议持久化）。 */
export const THEME_SETTING = 'theme'
export const LOCALE_SETTING = 'locale'

const THEMES: readonly Theme[] = ['light', 'dark']

export interface PreferencesOptions {
  appearance: AppearanceStore
  settings: SettingsStore
  /** 另一处已改写同一设置：用户的选择保留在界面上，retry 以当前选择重新保存。 */
  onConflict: (retry: () => void) => void
  onFailure: (error: ApiError, retry: () => void) => void
}

export interface Preferences {
  setTheme(theme: Theme): Promise<void>
  setLocale(locale: Locale): Promise<void>
}

/**
 * 界面偏好：按开发者选择同步右栏页面的可用条件；主题与语言以 appearance store 为唯一来源。
 * 设置首次加载后把已保存的外观值应用到它一次
 * （用户在加载前已做的选择不被覆盖）；之后用户的切换立即生效并在后台保存。
 */
export function createPreferences({ appearance, settings, onConflict, onFailure }: PreferencesOptions): Preferences {
  const touched = new Set<string>()
  let applied = false

  const applyLoaded = () => {
    const state = settings.getState()
    // 装配在 Bootstrap 之前；恢复布局时诊断页的可用条件已经确定。
    setAvailableRightPanelPages([...RIGHT_PANEL_PAGE_KINDS, ...(state.developer.sessionDiagnostics ? ['diagnostics' as const] : [])])
    if (applied || state.status !== 'ready') return
    applied = true
    const theme = state.values[THEME_SETTING]?.value
    const locale = state.values[LOCALE_SETTING]?.value
    if (!touched.has(THEME_SETTING) && THEMES.includes(theme as Theme)) appearance.setTheme(theme as Theme)
    if (!touched.has(LOCALE_SETTING) && locales.includes(locale as Locale)) appearance.setLocale(locale as Locale)
  }
  settings.subscribe(applyLoaded)
  applyLoaded()

  const current = (key: string) => (key === THEME_SETTING ? appearance.getSnapshot().theme : appearance.getSnapshot().locale)

  const persist = async (key: string): Promise<void> => {
    const result = await settings.getState().saveSetting(key, current(key))
    const retry = () => void persist(key)
    if (result.status === 'conflict') onConflict(retry)
    else if (result.status === 'failed') onFailure(result.error, retry)
  }

  return {
    async setTheme(theme) {
      touched.add(THEME_SETTING)
      appearance.setTheme(theme)
      await persist(THEME_SETTING)
    },
    async setLocale(locale) {
      touched.add(LOCALE_SETTING)
      appearance.setLocale(locale)
      await persist(LOCALE_SETTING)
    },
  }
}

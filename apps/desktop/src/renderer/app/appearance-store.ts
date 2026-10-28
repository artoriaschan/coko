import { resolveLocale, type Locale } from '@coko/i18n'

export type Theme = 'light' | 'dark'

export interface Appearance {
  theme: Theme
  locale: Locale
}

/** 外观与语言的 vanilla store（无 React 依赖），由 App 经 useSyncExternalStore 订阅。持久化由设置票接入。 */
export function createAppearanceStore(initial: Appearance) {
  let state = initial
  const listeners = new Set<() => void>()
  const set = (next: Partial<Appearance>) => {
    state = { ...state, ...next }
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
    setTheme: (theme: Theme) => set({ theme }),
    setLocale: (locale: Locale) => set({ locale }),
  }
}

export type AppearanceStore = ReturnType<typeof createAppearanceStore>

export function defaultAppearance(): Appearance {
  return {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    locale: resolveLocale(navigator.language),
  }
}

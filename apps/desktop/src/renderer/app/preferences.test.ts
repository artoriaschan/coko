import { describe, expect, it, vi } from 'vitest'
import { fakeSettingsBackend } from '../testing/fake-settings.ts'
import { createSettingsStore } from '../stores/settings-store.ts'
import { createAppearanceStore } from './appearance-store.ts'
import { createPreferences } from './preferences.ts'

async function setup() {
  const backend = fakeSettingsBackend()
  const appearance = createAppearanceStore({ theme: 'light', locale: 'zh' })
  const settings = createSettingsStore({ api: backend.api })
  const onConflict = vi.fn<(retry: () => void) => void>()
  const onFailure = vi.fn<(error: unknown, retry: () => void) => void>()
  const preferences = createPreferences({ appearance, settings, onConflict, onFailure })
  return { backend, appearance, settings, preferences, onConflict, onFailure }
}

describe('主题与语言偏好', () => {
  it('设置加载后应用已保存的主题与语言；无效值忽略', async () => {
    const { backend, appearance, settings } = await setup()
    backend.externalWrite('theme', 'dark')
    backend.externalWrite('locale', 'klingon')
    await settings.getState().load()
    expect(appearance.getSnapshot()).toEqual({ theme: 'dark', locale: 'zh' })
  })

  it('切换后立即生效并写入设置', async () => {
    const { backend, appearance, settings, preferences } = await setup()
    await settings.getState().load()
    await preferences.setTheme('dark')
    await preferences.setLocale('en')
    expect(appearance.getSnapshot()).toEqual({ theme: 'dark', locale: 'en' })
    expect(backend.settings.get('theme')?.value).toBe('dark')
    expect(backend.settings.get('locale')?.value).toBe('en')
  })

  it('revision 冲突时保留用户选择并提示；重试写入当前选择', async () => {
    const { backend, appearance, settings, preferences, onConflict } = await setup()
    await settings.getState().load()
    backend.externalWrite('theme', 'light')
    await preferences.setTheme('dark')
    expect(appearance.getSnapshot().theme).toBe('dark')
    expect(backend.settings.get('theme')?.value).toBe('light')
    expect(onConflict).toHaveBeenCalledTimes(1)

    // 之后的设置刷新不得覆盖用户已做的选择。
    await settings.getState().load()
    expect(appearance.getSnapshot().theme).toBe('dark')

    const retry = onConflict.mock.calls[0]![0]
    retry()
    await vi.waitFor(() => expect(backend.settings.get('theme')).toMatchObject({ value: 'dark', revision: 2 }))
  })
})

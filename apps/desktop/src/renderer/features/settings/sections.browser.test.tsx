// 设置分区注册表：未交付（available: false）的占位分区不出现在导航中，也不能经 show / setSection 打开。全部分区已交付。
import '../../styles.css'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsDialogStore } from '../../app/settings-dialog-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { resolveSection, SETTINGS_SECTIONS, visibleSections } from './sections.ts'

it('占位分区不显示，打开它时回到通用分区', () => {
  const sections = SETTINGS_SECTIONS.map((s) => (s.id === 'mcp' ? { ...s, available: false } : s))
  expect(visibleSections(sections).map((s) => s.id)).not.toContain('mcp')
  expect(resolveSection('mcp', sections).id).toBe('general')
})

it('全部分区已交付：导航含 Skills & Commands，show(skills) 打开该分区', async () => {
  expect(SETTINGS_SECTIONS.filter((s) => !s.available)).toEqual([])
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const { chat, settings } = createFixtureChat()
  const settingsDialog = createSettingsDialogStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsDialog={settingsDialog}
        pickDirectory={async () => null}
      />
    </div>,
  )
  settingsDialog.show('skills')
  const dialog = page.getByRole('dialog')
  await expect.element(dialog.getByRole('heading', { name: 'Skills & Commands' })).toBeVisible()
  const nav = dialog.getByRole('navigation')
  const ids = [...nav.element().querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section'))
  expect(ids).toEqual(visibleSections().map((s) => s.id))
  expect(ids).toEqual(['general', 'models', 'permissions', 'skills', 'mcp', 'memory', 'about'])
  expect(nav.element().querySelector('[data-section="skills"]')?.getAttribute('aria-current')).toBe('page')
})

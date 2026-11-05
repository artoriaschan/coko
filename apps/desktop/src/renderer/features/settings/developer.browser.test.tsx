import '../../styles.css'
import type { Locale } from '@coko/i18n'
import { toast } from '@coko/ui'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ApiError } from '../../client/api.ts'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createSettingsStore } from '../../stores/settings-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

async function openApp(initial?: unknown, options: { locale?: Locale; theme?: 'light' | 'dark'; width?: number; failedLoad?: boolean } = {}) {
  await page.viewport(options.width ?? 1280, 800)
  const fixture = createFixtureChat()
  if (options.failedLoad) {
    const request = vi.spyOn(fixture.api, 'listSettings').mockRejectedValue(new ApiError('network', 'offline', 0))
    onTestFinished(() => request.mockRestore())
    fixture.settings = createSettingsStore({ api: fixture.api })
  }
  if (initial !== undefined) fixture.backend.externalWrite('developer', initial)
  await fixture.settings.getState().load()
  const appearance = createAppearanceStore({ locale: options.locale ?? 'en', theme: options.theme ?? 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const settingsPage = createSettingsPageStore()
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.element(page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true })).toBeVisible()
  return { ...fixture, settingsPage }
}

const panel = () => page.getByRole('region', { name: 'Sidebar', exact: true })
const toggle = () => settingsRegion().getByRole('switch', { name: 'Session diagnostics', exact: true })

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast remains')
  })
})

it('developer switch defaults off, saves globally and exposes a readonly diagnostics shell without opening it', async () => {
  const fixture = await openApp()
  fixture.settingsPage.open('general')
  await expect.element(settingsRegion().getByRole('group', { name: 'Developer', exact: true })).toBeVisible()
  await expect.element(toggle()).not.toBeChecked()
  await toggle().click()
  await expect.element(toggle()).toBeChecked()
  await expect.poll(async () => (await fixture.api.listSettings()).find((item) => item.key === 'developer')?.value).toEqual({ sessionDiagnostics: true })
  fixture.settingsPage.back()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.element(panel().getByRole('tab', { name: 'Start', exact: true })).toHaveAttribute('aria-selected', 'true')
  await panel().getByRole('button', { name: 'Session diagnostics', exact: true }).click()
  await expect.element(panel().getByRole('heading', { name: 'Session diagnostics', exact: true })).toBeVisible()
  await expect.element(panel().getByRole('button', { name: 'Display format', exact: true })).toBeVisible()
  await expect.element(panel().getByRole('table', { name: 'Session diagnostics', exact: true })).toBeVisible()
  expect(panel().element().querySelector('input,textarea,[contenteditable]')).toBeNull()
})

it('disabling closes diagnostics in all adopted Sessions and filters future restores without rewriting their layout keys', async () => {
  const pending = JSON.stringify({ tabs: ['diagnostics', 'plan'], active: 'diagnostics', expanded: true, mode: 'normal' })
  localStorage.setItem('coko.right-panel.v1.s-8', pending)
  const fixture = await openApp({ sessionDiagnostics: true })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await panel().getByRole('button', { name: 'Session diagnostics', exact: true }).click()
  await page.getByRole('button', { name: 'SQLite 迁移与租约', exact: true }).click()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await panel().getByRole('button', { name: 'Session diagnostics', exact: true }).click()
  const first = localStorage.getItem('coko.right-panel.v1.s-1')
  const second = localStorage.getItem('coko.right-panel.v1.s-3')
  fixture.settingsPage.open('general')
  await expect.element(toggle()).toBeChecked()
  await toggle().click()
  await expect.element(toggle()).not.toBeChecked()
  fixture.settingsPage.back()
  await expect.element(panel()).not.toBeInTheDocument()
  await page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBe(first)
  expect(localStorage.getItem('coko.right-panel.v1.s-3')).toBe(second)
  await page.getByRole('button', { name: 'Read agent-core event flow', exact: true }).click()
  await expect.element(panel().getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.element(panel().getByRole('tab', { name: 'Session diagnostics', exact: true })).not.toBeInTheDocument()
  expect(localStorage.getItem('coko.right-panel.v1.s-8')).toBe(pending)
  await panel().getByRole('button', { name: 'New tab', exact: true }).click()
  await expect.element(panel().getByRole('button', { name: 'Session diagnostics', exact: true })).not.toBeInTheDocument()
})

it('restores an enabled diagnostics tab before showing content and display format is a readonly menu', async () => {
  localStorage.setItem('coko.right-panel.v1.s-1', JSON.stringify({ tabs: ['plan', 'diagnostics'], active: 'diagnostics', expanded: true, mode: 'normal' }))
  await openApp({ sessionDiagnostics: true })
  await expect.element(panel().getByRole('tab', { name: 'Session diagnostics', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.element(panel().getByRole('tab', { name: 'Start', exact: true })).not.toBeInTheDocument()
  await panel().getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(panel().getByRole('button', { name: 'Display format', exact: true })).toHaveTextContent('Conversation groups')
})

it.each([null, {}, { sessionDiagnostics: 'yes' }])('invalid persisted developer value %j falls back to off and filters saved diagnostics', async (value) => {
  localStorage.setItem('coko.right-panel.v1.s-1', JSON.stringify({ tabs: ['diagnostics'], active: 'diagnostics', expanded: true, mode: 'normal' }))
  const fixture = await openApp(value)
  await expect.element(panel()).not.toBeInTheDocument()
  fixture.settingsPage.open('general')
  await expect.element(toggle()).not.toBeChecked()
})

it.each(['conflict', 'failure'] as const)('retains the current developer selection after save %s and shows a Toast', async (result) => {
  const fixture = await openApp()
  fixture.settingsPage.open('general')
  if (result === 'conflict') fixture.backend.externalWrite('developer', { sessionDiagnostics: false })
  else {
    const request = vi.spyOn(fixture.api, 'putSetting').mockRejectedValueOnce(new ApiError('network', 'offline', 0))
    onTestFinished(() => request.mockRestore())
  }
  await toggle().click()
  await expect.element(toggle()).toBeChecked()
  const message =
    result === 'conflict'
      ? 'Settings changed elsewhere. Your selection is kept; save it again.'
      : 'Could not save developer settings. Your selection is kept; try again.'
  await expect.element(page.getByText(message, { exact: true })).toBeVisible()
  fixture.settingsPage.back()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.element(panel().getByRole('button', { name: 'Session diagnostics', exact: true })).toBeVisible()
  fixture.settingsPage.open('general')
  await expect.element(toggle()).toBeChecked()
})

it('settings load failure treats diagnostics as unavailable without rewriting its saved layout', async () => {
  const saved = JSON.stringify({ tabs: ['diagnostics'], active: 'diagnostics', expanded: true, mode: 'normal' })
  localStorage.setItem('coko.right-panel.v1.s-1', saved)
  await openApp(undefined, { failedLoad: true })
  await expect.element(panel()).not.toBeInTheDocument()
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBe(saved)
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.element(panel().getByRole('button', { name: 'Session diagnostics', exact: true })).not.toBeInTheDocument()
})

it.each([
  { locale: 'zh' as const, theme: 'dark' as const, title: '开发者', label: '会话数据诊断' },
  { locale: 'en' as const, theme: 'light' as const, title: 'Developer', label: 'Session diagnostics' },
])('390px $locale/$theme developer card keeps text and switch reachable', async (options) => {
  const fixture = await openApp(undefined, { ...options, width: 390 })
  fixture.settingsPage.open('general')
  const group = settingsRegion().getByRole('group', { name: options.title, exact: true })
  const control = group.getByRole('switch', { name: options.label, exact: true })
  await expect.element(control).toBeVisible()
  await control.click()
  await expect.element(control).toBeChecked()
  const box = group.element().getBoundingClientRect()
  const switchBox = control.element().getBoundingClientRect()
  expect(switchBox.left).toBeGreaterThanOrEqual(box.left)
  expect(switchBox.right).toBeLessThanOrEqual(box.right)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})

import '../styles.css'
import { expect, it, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from './app.tsx'
import { FRAME_WIDTHS_KEY } from './frame-widths.ts'
import { createAppearanceStore } from './appearance-store.ts'
import { createConnectionStore } from './connection-store.ts'
import { createPreferences } from './preferences.ts'
import { createSettingsPageStore } from './settings-page-store.ts'
import { createFixtureChat } from '../testing/fixture-chat.ts'
import { setReducedMotion } from '../testing/browser-commands.ts'

async function renderApp() {
  const fixture = createFixtureChat()
  const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  return { ...fixture, screen }
}

const width = (side: 'sidebar' | 'right') => Math.round(document.querySelector(`[data-slot="app-frame-${side}"]`)!.getBoundingClientRect().width)
const widths = () => JSON.parse(localStorage.getItem(FRAME_WIDTHS_KEY) ?? 'null')

it('reduced motion skips sidebar spatial transitions and preserves saved widths', async () => {
  await setReducedMotion(true)
  onTestFinished(() => setReducedMotion(false))
  await page.viewport(1440, 900)
  const saved = JSON.stringify({ sidebarWidth: 340, rightWidth: 600 })
  localStorage.setItem(FRAME_WIDTHS_KEY, saved)
  await renderApp()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => width('right')).toBe(600)
  expect(document.querySelector('[data-right-transitioning]')).toBeNull()
  expect(document.querySelector('[data-slot="app-frame-right-column"]')!.getAnimations()).toHaveLength(0)
  await page.getByRole('region', { name: 'Sidebar', exact: true }).getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="app-frame-right"]')!.hasAttribute('hidden')).toBe(true)
  expect(localStorage.getItem(FRAME_WIDTHS_KEY)).toBe(saved)
})

it('saves both dragged widths and restores them after a new App mount and Session switch', async () => {
  await page.viewport(1440, 900)
  const first = await renderApp()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const left = page.getByRole('separator', { name: 'Resize sidebar', exact: true })
  // Playwright 的真实鼠标从分隔条中心拖到中心右侧 60px。
  await left.dropTo(left, { sourcePosition: { x: 4, y: 200 }, targetPosition: { x: 64, y: 200 }, force: true })
  await expect.poll(() => width('sidebar')).toBe(340)
  await expect.poll(() => widths()?.sidebarWidth).toBe(340)
  await expect.poll(() => width('right')).toBe(648)
  const right = page.getByRole('separator', { name: 'Resize sidebar panel', exact: true })
  await right.dropTo(right, { sourcePosition: { x: 4, y: 200 }, targetPosition: { x: 84, y: 200 }, force: true })
  await expect.poll(() => width('right')).toBe(568)
  await expect.poll(widths).toEqual({ sidebarWidth: 340, rightWidth: 568 })
  await first.screen.unmount()

  await renderApp()
  await expect.poll(() => width('sidebar')).toBe(340)
  await expect.poll(() => width('right')).toBe(568)
  await page.getByRole('button', { name: 'SQLite 迁移与租约', exact: true }).click()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => width('right')).toBe(568)
  expect(widths()).toEqual({ sidebarWidth: 340, rightWidth: 568 })
})

it('keeps saved widths through window fitting, automatic fullscreen and panel closing', async () => {
  await page.viewport(1440, 900)
  const saved = JSON.stringify({ sidebarWidth: 340, rightWidth: 600 })
  localStorage.setItem(FRAME_WIDTHS_KEY, saved)
  await renderApp()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => width('right')).toBe(600)
  await page.viewport(1100, 900)
  await expect.poll(() => width('right')).toBe(360)
  await page.viewport(700, 900)
  await expect.poll(() => width('right')).toBe(700)
  await page.viewport(1440, 900)
  await expect.poll(() => width('sidebar')).toBe(340)
  await expect.poll(() => width('right')).toBe(600)
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  await expect.poll(() => width('right')).toBe(1440)
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await expect.poll(() => width('right')).toBe(600)
  await page.getByRole('region', { name: 'Sidebar', exact: true }).getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => width('right')).toBe(600)
  expect(localStorage.getItem(FRAME_WIDTHS_KEY)).toBe(saved)
  await page.screenshot({ path: '../../../../../.vitest/app-frame-restored.png' })
})

it.each(['{broken', JSON.stringify({ sidebarWidth: 'bad', rightWidth: -20 }), 'null'])('ignores corrupt saved sizes: %s', async (saved) => {
  await page.viewport(1440, 900)
  localStorage.setItem(FRAME_WIDTHS_KEY, saved)
  await renderApp()
  await expect.poll(() => width('sidebar')).toBe(280)
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => width('right')).toBe(648)
})

it('keeps resized panels usable when browser storage is full', async () => {
  await page.viewport(1440, 900)
  await renderApp()
  let index = 0
  for (let size = 262_144; size >= 1; size /= 16) {
    while (true) {
      try {
        localStorage.setItem(`frame-quota-${index++}`, 'x'.repeat(size))
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
        break
      }
    }
  }
  page.getByRole('separator', { name: 'Resize sidebar', exact: true }).element().focus()
  await userEvent.keyboard('{End}')
  await expect.poll(() => width('sidebar')).toBe(420)
  expect(localStorage.getItem(FRAME_WIDTHS_KEY)).toBeNull()
})

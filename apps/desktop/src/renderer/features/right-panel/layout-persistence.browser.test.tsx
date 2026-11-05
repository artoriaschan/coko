import '../../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

async function renderApp() {
  const fixture = createFixtureChat()
  const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const settingsPage = createSettingsPageStore()
  const screen = await render(
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
  return { ...fixture, screen, settingsPage }
}

it('restores the saved page order, selection and manual fullscreen before showing Session content', async () => {
  await page.viewport(1280, 800)
  localStorage.setItem('coko.right-panel.v1.s-1', JSON.stringify({ tabs: ['trace', 'plan'], active: 'plan', expanded: true, mode: 'fullscreen' }))
  await renderApp()
  const panel = page.getByRole('region', { name: 'Sidebar', exact: true })
  await expect.element(panel.getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect([...panel.element().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Trace', 'Plan'])
  await expect.element(panel.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible()
  expect(panel.element().getBoundingClientRect().width).toBe(1280)
  await expect.element(panel.getByRole('tab', { name: 'Start', exact: true })).not.toBeInTheDocument()
})

it('preserves layout on archive and removes only permanently deleted Session and descendant keys', async () => {
  await page.viewport(1280, 800)
  const saved = JSON.stringify({ tabs: ['plan'], active: 'plan', expanded: false, mode: 'normal' })
  for (const id of ['s-1', 'child', 's-3']) localStorage.setItem(`coko.right-panel.v1.${id}`, saved)
  localStorage.setItem('coko.right-panel.v2.s-1', 'future layout')
  const fixture = await renderApp()
  const deleteSession = fixture.api.deleteSession
  fixture.api.deleteSession = async (id) => {
    await deleteSession(id)
    // 外部协议返回本次真正删除的全部身份，renderer 不从自己的已加载列表猜测子 Session。
    return { sessionIds: [id, 'child'] }
  }
  await page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive conversation', exact: true }).click()
  await expect.element(page.getByRole('status').filter({ hasText: 'Restore this conversation to continue.' })).toBeVisible()
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBe(saved)
  expect(localStorage.getItem('coko.right-panel.v1.child')).toBe(saved)
  fixture.settingsPage.open('archived')
  await settingsRegion().getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(settingsRegion().getByText('No archived conversations.')).toBeVisible()
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBeNull()
  expect(localStorage.getItem('coko.right-panel.v1.child')).toBeNull()
  expect(localStorage.getItem('coko.right-panel.v2.s-1')).toBeNull()
  expect(localStorage.getItem('coko.right-panel.v1.s-3')).toBe(saved)
})

it('saves page changes and manual fullscreen in this Session key while keeping other Sessions untouched', async () => {
  await page.viewport(1280, 800)
  const other = JSON.stringify({ tabs: ['team'], active: 'team', expanded: false, mode: 'normal' })
  localStorage.setItem('coko.right-panel.v1.s-3', other)
  await renderApp()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Sidebar', exact: true })
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Trace', exact: true }).click()
  await panel.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  expect(JSON.parse(localStorage.getItem('coko.right-panel.v1.s-1')!)).toEqual({ tabs: ['plan', 'trace'], active: 'trace', expanded: true, mode: 'fullscreen' })
  expect(localStorage.getItem('coko.right-panel.v1.s-3')).toBe(other)
  await panel.getByRole('button', { name: 'Close Plan', exact: true }).click()
  expect(JSON.parse(localStorage.getItem('coko.right-panel.v1.s-1')!)).toEqual({ tabs: ['trace'], active: 'trace', expanded: true, mode: 'fullscreen' })
})

it('clears only a corrupt Session record and restores other Sessions without rewriting filtered records', async () => {
  await page.viewport(1280, 800)
  localStorage.setItem('coko.right-panel.v1.s-1', '{invalid')
  const other = JSON.stringify({ tabs: ['future', 'team'], active: 'future', expanded: true, mode: 'normal' })
  localStorage.setItem('coko.right-panel.v1.s-3', other)
  await renderApp()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBeNull()
  await page.getByRole('button', { name: 'SQLite 迁移与租约', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Sidebar', exact: true })
  await expect.element(panel.getByRole('tab', { name: 'Team', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(localStorage.getItem('coko.right-panel.v1.s-3')).toBe(other)
  await page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true }).click()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.element(panel.getByRole('tab', { name: 'Start', exact: true })).toBeVisible()
  expect(localStorage.getItem('coko.right-panel.v1.s-3')).toBe(other)
})

it('keeps automatic narrow fullscreen out of the saved manual mode and saves fit failure as collapsed', async () => {
  await page.viewport(700, 800)
  await renderApp()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Sidebar', exact: true })
  await expect.element(panel.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible()
  expect(JSON.parse(localStorage.getItem('coko.right-panel.v1.s-1')!)).toMatchObject({ mode: 'normal', expanded: true })
  await panel.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  expect(JSON.parse(localStorage.getItem('coko.right-panel.v1.s-1')!)).toMatchObject({ mode: 'normal', expanded: false })
  await page.viewport(1024, 800)
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).element().focus()
  await userEvent.keyboard('{End}')
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  expect(JSON.parse(localStorage.getItem('coko.right-panel.v1.s-1')!)).toMatchObject({ expanded: false })
})

it('keeps the current layout usable when real browser storage is full', async () => {
  await page.viewport(1280, 800)
  await renderApp()
  // 用真实 localStorage 配额触发失败，不替换存储或布局模型。
  let index = 0
  for (let size = 262_144; size >= 1; size /= 16) {
    while (true) {
      try {
        localStorage.setItem(`quota-${index++}`, 'x'.repeat(size))
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
        break
      }
    }
  }
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Sidebar', exact: true })
  await expect.element(panel.getByRole('tab', { name: 'Start', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  await expect.element(panel.getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(localStorage.getItem('coko.right-panel.v1.s-1')).toBeNull()
})

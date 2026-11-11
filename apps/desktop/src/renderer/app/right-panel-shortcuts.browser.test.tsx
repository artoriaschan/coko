import '../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from './app.tsx'
import { createAppearanceStore } from './appearance-store.ts'
import { createConnectionStore } from './connection-store.ts'
import { createPreferences } from './preferences.ts'
import { createSettingsPageStore } from './settings-page-store.ts'
import { createFixtureChat } from '../testing/fixture-chat.ts'

async function renderApp(locale: 'en' | 'zh' = 'en') {
  await page.viewport(1440, 900)
  const appearance = createAppearanceStore({ theme: 'light', locale })
  const fixture = createFixtureChat()
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  return fixture
}

it.each([
  ['en', 'Fullscreen', 'Exit fullscreen', 'Plan', 'Close Plan'],
  ['zh', '全屏', '退出全屏', '计划', '关闭计划'],
] as const)('%s: fullscreen and tab-close tooltips contain only the action label', async (locale, fullscreen, exit, plan, close) => {
  await renderApp(locale)
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  const maximize = page.getByRole('button', { name: fullscreen, exact: true })
  await userEvent.hover(maximize)
  await expect.element(page.getByRole('tooltip', { name: fullscreen, exact: true })).toBeVisible()
  await expect.element(maximize).toHaveAttribute('aria-keyshortcuts', 'Meta+Alt+Enter Control+Alt+Enter')
  await maximize.click()
  const restore = page.getByRole('button', { name: exit, exact: true })
  await userEvent.hover(restore)
  await expect.element(page.getByRole('tooltip', { name: exit, exact: true })).toBeVisible()
  await restore.click()
  await page
    .getByRole('region', { name: locale === 'en' ? 'Sidebar' : '侧边栏', exact: true })
    .getByRole('button', { name: plan, exact: true })
    .click()
  const closeTab = page.getByRole('button', { name: close, exact: true })
  await userEvent.hover(closeTab)
  await expect.element(page.getByRole('tooltip', { name: close, exact: true })).toBeVisible()
  await expect.element(closeTab).toHaveAttribute('aria-keyshortcuts', 'Meta+W Control+W')
})

it('sidebar shortcuts open, focus, fullscreen and collapse the current Session panel', async () => {
  await renderApp()
  await userEvent.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}')
  const panel = page.getByRole('tabpanel', { name: 'Start', exact: true })
  await expect.element(panel).toBeVisible()
  await expect.element(panel).toHaveFocus()
  await expect.element(page.getByRole('tab', { name: 'Start', exact: true })).toBeVisible()
  await userEvent.keyboard('{Control>}{Alt>}{Enter}{/Alt}{/Control}')
  const section = panel.element().closest('[data-slot="app-frame-right"]')!
  const bounds = section.getBoundingClientRect()
  expect([bounds.left, bounds.top, bounds.width, bounds.height]).toEqual([0, 0, 1440, 900])
  await expect
    .element(page.getByRole('button', { name: 'Exit fullscreen', exact: true }))
    .toHaveAttribute('aria-keyshortcuts', 'Meta+Alt+Enter Control+Alt+Enter')
  await userEvent.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}')
  await expect.poll(() => section.getClientRects().length).toBe(0)
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toHaveFocus()
})

it('sidebar shortcuts ignore active composition, drafts and non-Session pages', async () => {
  const fixture = await renderApp()
  const editor = page.getByRole('textbox', { name: 'Give Coko a task' }).element()
  editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  expect(document.querySelector('[data-slot="app-frame-right"]')!.getClientRects()).toHaveLength(0)
  editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  await expect.element(page.getByRole('tabpanel', { name: 'Start', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  await expect.poll(() => document.querySelector('[data-slot="app-frame-right"]')!.getClientRects().length).toBe(0)
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  expect(fixture.chat.getState().activeSessionId).toBeNull()
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  expect(document.querySelector('[data-slot="app-frame-right"]')!.getClientRects()).toHaveLength(0)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  expect(document.querySelector('[data-slot="app-frame-right"]')!.getClientRects()).toHaveLength(0)
})

it('foreground menus and dialogs keep sidebar shortcuts from changing their background', async () => {
  await renderApp()
  await userEvent.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}')
  const section = document.querySelector('[data-slot="app-frame-right"]')!
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect.element(page.getByRole('menu')).toBeVisible()
  await userEvent.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}')
  expect(section.getClientRects().length).toBe(1)
  await expect.element(page.getByRole('menu')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Permission mode: Ask for approval', exact: true }).click()
  await page.elementLocator(document.querySelector('[role="menuitemradio"][data-mode="full-access"]')!).click()
  const dialog = page.getByRole('alertdialog')
  await expect.element(dialog).toBeVisible()
  await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}')
  expect(section.getClientRects().length).toBe(1)
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  const editor = page.getByRole('textbox', { name: 'Give Coko a task' }).element() as HTMLElement
  editor.focus()
  await userEvent.keyboard('{Meta>}{Alt>}{Enter}{/Alt}{/Meta}')
  expect(section.getBoundingClientRect().left).toBeGreaterThan(0)
})

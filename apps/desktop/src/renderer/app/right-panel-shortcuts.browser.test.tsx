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

async function renderApp() {
  await page.viewport(1440, 900)
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
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

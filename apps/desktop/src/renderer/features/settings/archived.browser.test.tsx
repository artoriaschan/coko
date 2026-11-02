import '../../styles.css'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'
import { ApiError } from '../../client/api.ts'

async function setup(locale: 'en' | 'zh' = 'en') {
  localStorage.clear()
  await page.viewport(1200, 900)
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title: 'Archive me', pinnedAt: 10 }] })
  await fixture.chat.getState().load()
  fixture.api.listModels = async () => ({
    models: [{ providerId: 'faux', providerName: 'Faux', modelId: 'faux-1', name: 'Faux', thinkingLevels: ['off'], input: ['text', 'image'] }],
    defaultModel: null,
  })
  await fixture.settings.getState().load()
  const appearance = createAppearanceStore({ locale, theme: 'light' })
  const settingsPage = createSettingsPageStore()
  await render(
    <App
      store={appearance}
      connection={createConnectionStore()}
      chat={fixture.chat}
      settings={fixture.settings}
      preferences={createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })}
      settingsPage={settingsPage}
      pickDirectory={async () => null}
    />,
  )
  return { ...fixture, settingsPage }
}

it('archive keeps the current editor draft mounted, settings opens it read-only, restore returns it to its original project unpinned', async () => {
  const fixture = await setup()
  const editor = page.getByRole('textbox', { name: 'Give Coko a task' }).element()
  await userEvent.type(editor, 'retained draft')
  const paste = new DataTransfer()
  paste.items.add(
    new File(
      [Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))],
      'pixel.png',
      { type: 'image/png' },
    ),
  )
  editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: paste }))
  await expect.element(page.getByRole('img', { name: 'pixel.png' })).toBeVisible()
  const image = page.getByRole('img', { name: 'pixel.png' }).element()
  await page.getByRole('button', { name: 'Archive me', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive conversation', exact: true }).click()
  await expect.element(page.getByRole('status').filter({ hasText: 'Restore this conversation to continue.' })).toBeVisible()
  expect(fixture.chat.lists.getState().sessions).toEqual([])
  expect(document.querySelector('[contenteditable=true]')).toBe(editor)
  expect(editor.textContent).toContain('retained draft')
  expect(image.isConnected).toBe(true)
  expect(editor.closest('[hidden]')).not.toBeNull()
  fixture.chat.getState().startDraft()
  fixture.settingsPage.open('archived')
  const section = settingsRegion()
  await expect.element(section.getByRole('heading', { name: 'Archived conversations', exact: true })).toBeVisible()
  await expect.element(section.getByText('Archive me', { exact: true })).toBeVisible()
  await expect.element(section.getByText('coko', { exact: true })).toBeVisible()
  expect(section.element().querySelector('time')?.getAttribute('dateTime')).toBeTruthy()
  await section.getByRole('button', { name: 'Open conversation' }).click()
  await expect.element(page.getByRole('heading', { name: 'Archive me', exact: true })).toBeVisible()
  await expect.element(page.getByRole('status').filter({ hasText: 'Restore this conversation to continue.' })).toBeVisible()
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
  fixture.settingsPage.open('archived')
  await settingsRegion().getByRole('button', { name: 'Restore', exact: true }).click()
  await expect.element(settingsRegion().getByText('No archived conversations.')).toBeVisible()
  fixture.settingsPage.back()
  await expect.element(page.getByRole('textbox', { name: 'Give Coko a task' })).toBeVisible()
  await expect.element(page.getByRole('img', { name: 'pixel.png' })).toBeVisible()
  expect(fixture.chat.lists.getState().sessions[0]).toMatchObject({ id: 's-1', projectId: 'project-w-coko', pinnedAt: null, archivedAt: null })
  await expect.element(page.getByRole('button', { name: 'Archive me', exact: true })).toBeVisible()
})

it('archive refusal explains the busy class in Chinese and retains the session', async () => {
  const fixture = await setup('zh')
  fixture.api.archiveSession = async () => {
    throw new ApiError('session-busy', 'busy', 409, { reasons: ['run', 'agent', 'job', 'schedule'], sessions: [{ id: 's-1', title: 'Archive me' }] })
  }
  await page.getByRole('button', { name: 'Archive me', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  await expect.element(page.getByText(/有进行中的工作，无法归档/)).toBeVisible()
  expect(fixture.chat.lists.getState().sessions[0]!.archivedAt).toBeNull()
})

it('archive settings retries load, keeps failed restores, and reuses delete confirmation', async () => {
  const fixture = await setup()
  await fixture.chat.getState().archiveSession('s-1')
  const original = fixture.api.listArchivedSessions
  fixture.api.listArchivedSessions = vi.fn<typeof original>().mockRejectedValueOnce(new Error('offline')).mockImplementation(original)
  fixture.settingsPage.open('archived')
  await expect.element(settingsRegion().getByRole('alert')).toHaveTextContent('Could not load archived conversations.')
  await settingsRegion().getByRole('button', { name: 'Try again' }).click()
  await expect.element(settingsRegion().getByText('Archive me', { exact: true })).toBeVisible()
  fixture.api.restoreSession = async () => {
    throw new Error('offline')
  }
  await settingsRegion().getByRole('button', { name: 'Restore', exact: true }).click()
  await expect.element(settingsRegion().getByRole('alert')).toHaveTextContent('Could not restore the conversation. Try again.')
  await settingsRegion().getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(settingsRegion().getByText('No archived conversations.')).toBeVisible()
})

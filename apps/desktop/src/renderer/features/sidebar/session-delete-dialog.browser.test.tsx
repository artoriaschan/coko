import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SessionDeleteDialog } from './session-delete-dialog.tsx'

it('shows retained files before deletion and copies their full path', async () => {
  const fixture = createFixtureChat()
  fixture.api.deletePreview = async () => ({ retainedDirectories: ['/Documents/Coko/2026-11-05/chat-123456789012'] })
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <SessionDeleteDialog sessionId={fixtureSessions[0]!.id} open onOpenChange={() => {}} />
      </ChatStoreProvider>
    </I18nProvider>,
  )
  await expect.element(page.getByText('Files will be kept in this folder:')).toBeVisible()
  await expect.element(page.getByText('/Documents/Coko/2026-11-05/chat-123456789012')).toBeVisible()
  await userEvent.click(page.getByRole('button', { name: 'Copy path' }))
  expect(clipboard).toHaveBeenCalledWith('/Documents/Coko/2026-11-05/chat-123456789012')
  await expect.element(page.getByRole('button', { name: 'Copied' })).toBeVisible()
})

it.each(['light', 'dark'])('%s failed previews can retry and long retained paths stay usable in a narrow window', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await page.viewport(390, 400)
    const fixture = createFixtureChat()
    let failed = true
    const path = '/Documents/Coko/2026-11-05/' + '很长的会话目录'.repeat(15)
    fixture.api.deletePreview = async () => {
      if (failed) throw new Error('offline')
      return { retainedDirectories: [path] }
    }
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard unavailable'))
    await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={fixture.chat}>
          <SessionDeleteDialog sessionId={fixtureSessions[0]!.id} open onOpenChange={() => {}} />
        </ChatStoreProvider>
      </I18nProvider>,
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not check which folders will be kept')
    await expect.element(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    failed = false
    await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }))
    await expect.element(page.getByText(path)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Copy path' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not copy the path')
    await expect.element(page.getByRole('button', { name: 'Copy path' })).toBeVisible()
    const dialog = page.getByRole('alertdialog')
    expect(dialog.element().getBoundingClientRect().width).toBe(358)
    expect(dialog.element().getBoundingClientRect().height).toBeLessThanOrEqual(368)
    await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.screenshot({ path: `../../../../../../.vitest/sdr11-delete-${theme}.png` })
  } finally {
    document.documentElement.className = original
  }
})

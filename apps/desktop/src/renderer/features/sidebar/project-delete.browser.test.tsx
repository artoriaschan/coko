import '../../styles.css'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'
import { ApiError } from '../../client/api.ts'

it('CW-72/73/86/87: cancellation restores focus; deletion retains current content and clears only project organization and invalid draft selection', async () => {
  await page.viewport(1100, 800)
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title: 'Keep me', pinnedAt: 2 }] })
  await fixture.chat.getState().load()
  fixture.chat.getState().openSession('s-1')
  const project = fixture.chat.lists.getState().projects[0]!
  fixture.chat.newChat.getState().selectProject(project.id)
  fixture.chat.newChat.getState().configure({ imageRefs: ['attachment-1'] })
  fixture.chat.lists.getState().upsertProject({ ...project, pinnedAt: 5 })
  const remove = vi.fn<typeof fixture.api.deleteProject>(fixture.api.deleteProject)
  fixture.api.deleteProject = remove
  const view = await render(
    <I18nProvider locale="zh">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => {}} />
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  async function open() {
    await page.getByRole('button', { name: '更多项目操作' }).first().click()
    await page.getByRole('menuitem', { name: '删除项目', exact: true }).click()
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    const dialog = page.getByRole('alertdialog', { name: '删除项目？' })
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => document.activeElement === dialog.getByRole('button', { name: '取消', exact: true }).element()).toBe(true)
    return dialog
  }
  for (const close of ['cancel', 'close', 'escape']) {
    const dialog = await open()
    await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(480)
    const rect = dialog.element().getBoundingClientRect()
    expect(rect.height).toBe(208)
    expect(getComputedStyle(dialog.element()).borderRadius).toBe('28px')
    await expect
      .element(dialog.getByText('项目会从列表中移除，正在运行的对话会被停止。对话记录会保留，移到「对话」下；项目文件夹里的文件不会被删除。'))
      .toBeVisible()
    if (close === 'escape') await userEvent.keyboard('{Escape}')
    else await dialog.getByRole('button', { name: close === 'cancel' ? '取消' : '关闭', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement === page.getByRole('button', { name: '更多项目操作' }).first().element()).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  }
  const entries = fixture.chat.getState().conversations['s-1']!.entries
  const dialog = await open()
  await page.screenshot({ element: dialog.element(), path: '../../../../../../.vitest/cw15-delete-project.png' })
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(remove).toHaveBeenCalledOnce()
  expect(fixture.chat.lists.getState().projects.some((item) => item.id === project.id)).toBe(false)
  expect(fixture.chat.lists.getState().sessions[0]).toMatchObject({ id: 's-1', projectId: null, pinnedAt: 2 })
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
  expect(fixture.chat.getState().conversations['s-1']!.entries).toBe(entries)
  expect(fixture.chat.newChat.getState()).toMatchObject({ projectId: null, imageRefs: ['attachment-1'] })
  expect(document.querySelector('[data-category="pinned"] [data-session-id="s-1"]')).not.toBeNull()
  await view.unmount()
})

it.each(['light', 'dark'])(
  '%s: pending confirmation survives project reorder, prevents duplicates, reports stop failure and retries the original target at390px',
  async (theme) => {
    const original = document.documentElement.className
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      await page.viewport(1100, 800)
      const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title: 'Retained title' }] })
      await fixture.chat.getState().load()
      const target = fixture.chat.lists.getState().projects[0]!
      const remove = fixture.api.deleteProject
      const calls: string[] = []
      let reject!: (error: Error) => void
      fixture.api.deleteProject = async (id) => {
        calls.push(id)
        await new Promise<void>((_resolve, fail) => {
          reject = fail
        })
        return { sessionIds: ['s-1'] }
      }
      const view = await render(
        <I18nProvider locale="en">
          <ChatStoreProvider store={fixture.chat}>
            <TooltipProvider>
              <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => {}} />
            </TooltipProvider>
          </ChatStoreProvider>
        </I18nProvider>,
      )
      await page.getByRole('button', { name: 'More project actions' }).first().click()
      await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Delete project?' })
      await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(480)
      await page.screenshot({ element: dialog.element(), path: `../../../../../../.vitest/cw15-project-${theme}.png` })
      const confirm = dialog.getByRole('button', { name: 'Delete', exact: true })
      await confirm.click()
      await expect.element(confirm).toBeDisabled()
      await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
      fixture.chat.lists.getState().upsertProject({ ...target, pinnedAt: 99 })
      fixture.chat.lists.getState().patchSession('s-1', { title: 'Generated while pending', pinnedAt: 12 })
      await userEvent.keyboard('{Enter}{Escape}')
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect.element(dialog).toBeVisible()
      expect(calls).toEqual([target.id])
      reject(new ApiError('session-busy', 'stop timed out', 409, { reason: 'stop-failed' }))
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Some conversations could not stop, so the project was kept. Stopped runs will not restart automatically. Try again.')
      expect(fixture.chat.lists.getState().projects.some((project) => project.id === target.id)).toBe(true)
      await page.viewport(390, 500)
      await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(358)
      expect(dialog.element().getBoundingClientRect().left).toBe(16)
      await expect.element(confirm).toBeVisible()
      await page.screenshot({ element: dialog.element(), path: `../../../../../../.vitest/cw15-project-${theme}-error-390.png` })
      fixture.api.deleteProject = remove
      await confirm.click()
      await expect.element(dialog).not.toBeInTheDocument()
      expect(fixture.chat.lists.getState().sessions[0]).toMatchObject({ title: 'Generated while pending', pinnedAt: 12, projectId: null })
      expect(fixture.chat.lists.getState().projects.some((project) => project.id === target.id)).toBe(false)
      await view.unmount()
    } finally {
      document.documentElement.className = original
    }
  },
)

import '../../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider, Toaster } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

it('CW-13/14/21/22：项目详情完整路径、2px顶对齐、更多先关闭详情、重命名与混合置顶树恢复', async () => {
  await page.viewport(1100, 800)
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, title: 'Pinned member', pinnedAt: 20 },
      { ...fixtureSessions[1]!, title: 'Tree member', running: false },
    ],
  })
  await fixture.chat.getState().load()
  const project = fixture.chat.lists.getState().projects[0]!
  fixture.chat.lists.getState().upsertProject({
    ...project,
    folders: [...project.folders, { path: '/very/long/source/path/that/remains/fully/readable/for/the/project/shared/resources', primary: false }],
  })
  let destination = ''
  await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 280 }}>
            <SidebarLists
              search={null}
              onAddWorkspace={() => {}}
              onNewSession={(id) => {
                destination = id ?? ''
              }}
              onSelect={() => {}}
            />
          </div>
          <Toaster containerAriaLabel="Notifications" />
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  const row = page.getByRole('button', { name: 'coko', exact: true })
  await userEvent.hover(row)
  const details = page.getByRole('region', { name: 'Project details' })
  await expect.element(details).toBeVisible()
  const anchor = row.element().getBoundingClientRect()
  const rect = details.element().getBoundingClientRect()
  expect(details.element().className).toContain('w-80')
  expect(rect.width).toBeLessThanOrEqual(320)
  expect(rect.width).toBeGreaterThanOrEqual(300)
  expect(rect.left - anchor.right).toBe(2)
  expect(rect.top - anchor.top).toBe(0)
  const title = details.element().querySelector<HTMLElement>('[data-user-content]')!
  expect(getComputedStyle(title).fontSize).toBe('13px')
  expect(getComputedStyle(title).fontWeight).toBe('500')
  await userEvent.hover(details)
  await expect.element(details).toBeVisible()
  await expect.element(details.getByText('/very/long/source/path/that/remains/fully/readable/for/the/project/shared/resources')).toBeVisible()
  await expect.element(details.getByText('Conversations: 2')).toBeVisible()
  await page.screenshot({ element: details.element(), path: '../../../../../../.vitest/cw14-project-details.png' })
  await userEvent.hover(row)
  await page.getByRole('button', { name: 'More project actions' }).first().click()
  await expect.element(details).not.toBeInTheDocument()
  const menu = page.getByRole('menu', { name: 'Project actions' })
  await expect.element(menu).toBeVisible()
  await expect.poll(() => menu.element().getBoundingClientRect().left - anchor.right).toBe(2)
  await expect.poll(() => menu.element().getBoundingClientRect().top - anchor.top).toBe(0)
  await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const name = page.getByRole('textbox', { name: 'Project name' })
  expect(name.element().getAttribute('maxlength')).toBe('50')
  await name.fill('Renamed project')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Renamed project', exact: true })).toBeVisible()
  await userEvent.hover(page.getByRole('button', { name: 'Renamed project', exact: true }))
  await page.getByRole('button', { name: 'Pin project', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-category="pinned"] [data-project-id]')?.getAttribute('data-project-id')).toBe(project.id)
  expect(document.querySelectorAll('[data-session-id="s-1"]')).toHaveLength(1)
  expect(document.querySelector('[data-category="pinned"] [data-project-id] [data-session-id="s-2"]')).not.toBeNull()
  await userEvent.hover(page.getByRole('button', { name: 'Renamed project', exact: true }))
  await page.getByRole('button', { name: 'Unpin project', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-category="projects"] [data-project-id]')?.getAttribute('data-project-id')).toBe(project.id)
  await userEvent.hover(page.getByRole('button', { name: 'Renamed project', exact: true }))
  await page.getByRole('button', { name: 'New session in Renamed project' }).click()
  expect(destination).toBe(project.primaryWorkspaceId)
  await userEvent.keyboard('{Escape}')
})

it.each(['light', 'dark'] as const)('%s：项目置顶失败保留原位，折叠状态在置顶/取消后保留，长名可读且归档不计数', async (theme) => {
  const { applyTheme } = await import('@coko/ui')
  applyTheme(theme)
  await page.viewport(1100, 800)
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, title: 'Archived member', archivedAt: 10 },
      { ...fixtureSessions[1]!, title: 'Remaining member', running: false },
    ],
  })
  await fixture.chat.getState().load()
  const project = fixture.chat.lists.getState().projects[0]!
  await fixture.chat.lists.getState().renameProject(project.id, 'A long project name with its full readable contents')
  const view = await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 280 }}>
            <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => {}} />
          </div>
          <Toaster containerAriaLabel="Notifications" />
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  const row = page.getByRole('button', { name: 'A long project name with its full readable contents', exact: true })
  await row.click()
  await expect.element(row).toHaveAttribute('aria-expanded', 'false')
  await userEvent.hover(row)
  await expect.element(page.getByRole('region', { name: 'Project details' }).getByText('Conversations: 1')).toBeVisible()
  // 悬停时长项目名自动横向滚动。
  const rowTitle = row.element().querySelector<HTMLElement>('[data-scrollable-title]')!
  await expect.poll(() => Number(rowTitle.dataset.offset), { timeout: 5_000 }).toBeGreaterThan(0)
  // 长项目名与源文件夹地址都不省略，在卡片宽度内折行。
  const card = page.getByRole('region', { name: 'Project details' }).element()
  const longTitle = card.querySelector<HTMLElement>('[data-user-content]')!
  expect(longTitle.scrollWidth).toBeLessThanOrEqual(longTitle.clientWidth + 1)
  expect(longTitle.getBoundingClientRect().height).toBeGreaterThan(20)
  for (const item of card.querySelectorAll<HTMLElement>('li[data-user-content]')) {
    expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1)
  }
  await expect.poll(() => document.querySelectorAll('[aria-label="Project details"]').length).toBe(1)
  await page.screenshot({
    element: page.getByRole('region', { name: 'Project details' }).element(),
    path: `../../../../../../.vitest/cw14-project-${theme}.png`,
  })
  const original = fixture.api.setProjectPinned
  fixture.api.setProjectPinned = async () => {
    throw new Error('unavailable')
  }
  await page.getByRole('button', { name: 'Pin project', exact: true }).click()
  await expect.element(page.getByText('Could not update pin status. Try again.')).toBeVisible()
  expect(document.querySelector('[data-category="projects"] [data-project-id]')?.getAttribute('data-project-id')).toBe(project.id)
  fixture.api.setProjectPinned = original
  await userEvent.hover(row)
  await page.getByRole('button', { name: 'More project actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-category="pinned"] [data-project-id]')?.getAttribute('data-project-id')).toBe(project.id)
  await expect
    .element(page.getByRole('button', { name: 'A long project name with its full readable contents', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  await userEvent.hover(page.getByRole('button', { name: 'A long project name with its full readable contents', exact: true }))
  await page.getByRole('button', { name: 'More project actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Unpin project', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-category="projects"] [data-project-id]')?.getAttribute('data-project-id')).toBe(project.id)
  await expect
    .element(page.getByRole('button', { name: 'A long project name with its full readable contents', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  await view.unmount()
  applyTheme('light')
})

it('clicking more again closes the project menu instead of leaving it open', async () => {
  await page.viewport(1100, 800)
  const fixture = createFixtureChat({ sessions: [fixtureSessions[0]!] })
  await fixture.chat.getState().load()
  await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 280 }}>
            <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => {}} />
          </div>
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  const row = page.getByRole('button', { name: 'coko', exact: true })
  const details = page.getByRole('region', { name: 'Project details' })
  await userEvent.hover(row)
  await expect.element(details).toBeVisible()
  const more = page.getByRole('button', { name: 'More project actions' }).first()
  await userEvent.click(more)
  await expect.element(details).not.toBeInTheDocument()
  const menu = page.getByRole('menu', { name: 'Project actions' })
  await expect.element(menu).toBeVisible()
  await userEvent.click(more)
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(details).not.toBeInTheDocument()
})

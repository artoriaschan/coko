import '../../styles.css'
import { expect, it, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

it.each(['light', 'dark'])('%s：项目内会话按最后记录时间排列，整行圆弧 H32，展开与空状态，没有运行标记或分支', async (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  onTestFinished(() => document.documentElement.classList.remove('dark'))
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, id: 'standalone', title: 'Standalone', projectId: null },
      {
        ...fixtureSessions[0]!,
        id: 'a',
        title: 'Earlier running',
        updatedAt: 10,
        running: true,
        worktree: { id: 'wt', name: 'wt', branch: 'coko/secret', status: 'active' },
      },
      { ...fixtureSessions[0]!, id: 'b', title: 'Recent idle', updatedAt: 20 },
    ],
  })
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
  await expect.element(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible()
  await expect.element(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-session-id]')]
  expect(rows().map((row) => row.dataset.sessionId)).toEqual(['standalone', 'b', 'a'])
  const row = rows().find((row) => row.dataset.sessionId === 'b')!
  expect(row.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(row).borderRadius).toBe('8px')
  expect(getComputedStyle(row).getPropertyValue('corner-shape')).toBe('superellipse(1)')
  expect(row.getBoundingClientRect().x).toBe(rows()[0]!.getBoundingClientRect().x)
  expect(row.getBoundingClientRect().width).toBe(rows()[0]!.getBoundingClientRect().width)
  expect(rows()[2]!.getBoundingClientRect().top - row.getBoundingClientRect().bottom).toBe(2)
  expect(document.body.textContent).not.toContain('coko/secret')
  expect(document.querySelector('[data-session-id] [data-activity], [data-session-id] [role="img"]')).toBeNull()
  expect(document.querySelector('[data-action="workspace-menu"]')).toBeNull()
  await userEvent.click(page.getByRole('button', { name: 'coko', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Recent idle', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('No conversations', { exact: true })).toBeVisible()
})

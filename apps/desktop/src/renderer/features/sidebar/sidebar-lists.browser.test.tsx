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
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'coko', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Recent idle', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('No conversations', { exact: true })).toBeVisible()
})

it('lists page independently in steps of five and collapse back to five', async () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    ...fixtureSessions[0]!,
    id: `solo-${index}`,
    title: `Solo ${index}`,
    projectId: null,
    updatedAt: 100 - index,
  }))
  const fixture = createFixtureChat({ sessions })
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
  const section = page.getByRole('region', { name: 'Conversations', exact: true })
  await expect.element(section.getByRole('button', { name: 'Solo 4', exact: true })).toBeVisible()
  await expect.element(section.getByRole('button', { name: 'Solo 5', exact: true })).not.toBeInTheDocument()
  await userEvent.click(section.getByRole('button', { name: 'Expand', exact: true }))
  await expect.element(section.getByRole('button', { name: 'Solo 9', exact: true })).toBeVisible()
  await expect.element(section.getByRole('button', { name: 'Solo 10', exact: true })).not.toBeInTheDocument()
  await userEvent.click(section.getByRole('button', { name: 'Expand', exact: true }))
  await expect.element(section.getByRole('button', { name: 'Solo 11', exact: true })).toBeVisible()
  await expect.element(section.getByRole('button', { name: 'Expand', exact: true })).not.toBeInTheDocument()
  await userEvent.click(section.getByRole('button', { name: 'Collapse', exact: true }))
  await expect.element(section.getByRole('button', { name: 'Solo 5', exact: true })).not.toBeInTheDocument()
})

it('category header shares text alignment, reveals actions on focus, and collapse preserves paging', async () => {
  const fixture = createFixtureChat({
    sessions: Array.from({ length: 8 }, (_, index) => ({
      ...fixtureSessions[0]!,
      id: `header-${index}`,
      title: `Header ${index}`,
      projectId: null,
      updatedAt: 100 - index,
    })),
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
  const toggle = page.getByRole('button', { name: 'Collapse Conversations category', exact: true })
  await expect.element(toggle).toBeVisible()
  const header = toggle.element() as HTMLElement
  const row = document.querySelector<HTMLElement>('[data-session-id="header-0"] span[data-user-content]')!
  const label = header.querySelector<HTMLElement>('[data-category-label]')!
  expect(label.getBoundingClientRect().left).toBe(row.getBoundingClientRect().left)
  expect(getComputedStyle(label).fontSize).toBe('13px')
  expect(getComputedStyle(row).fontSize).toBe('13px')
  expect(getComputedStyle(label).lineHeight).toBe('20px')
  const actions = document.querySelector<HTMLElement>('[data-category="conversations"] [data-category-actions]')!
  document.querySelector<HTMLElement>('nav')!.focus()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  expect(getComputedStyle(actions).opacity).toBe('0')
  header.focus()
  expect(getComputedStyle(actions).opacity).toBe('1')
  for (const control of document.querySelectorAll<HTMLElement>('[data-category-actions] button')) {
    expect(control.getBoundingClientRect().height).toBe(24)
    expect(control.querySelector('svg')!.getBoundingClientRect().width).toBe(14)
  }
  await userEvent.click(page.getByRole('region', { name: 'Conversations', exact: true }).getByRole('button', { name: 'Expand', exact: true }))
  await userEvent.click(toggle)
  await expect.element(page.getByRole('button', { name: 'Header 0', exact: true })).not.toBeInTheDocument()
  const collapsed = page.getByRole('button', { name: 'Expand Conversations category', exact: true })
  expect(getComputedStyle(collapsed.element().querySelector('[data-category-arrow]')!).opacity).toBe('1')
  await userEvent.click(collapsed)
  await expect.element(page.getByRole('button', { name: 'Header 7', exact: true })).toBeVisible()
})

it('project sort is a closing radio menu and expand-all only changes unpinned projects', async () => {
  const fixture = createFixtureChat()
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({
    projects: [
      { id: 'new', name: 'Newest', primaryWorkspaceId: 'w-coko', folders: [], pinnedAt: null, createdAt: 20, lastUsedAt: 20, sessionCount: 0 },
      { id: 'used', name: 'Recently used', primaryWorkspaceId: 'w-pi', folders: [], pinnedAt: null, createdAt: 10, lastUsedAt: 30, sessionCount: 0 },
    ],
  })
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
  const projects = page.getByRole('region', { name: 'Projects', exact: true })
  expect([...document.querySelectorAll<HTMLElement>('[data-project-id]')].map((p) => p.dataset.projectId)).toEqual(['used', 'new'])
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Sort projects', exact: true }))
  await expect.element(page.getByRole('menuitemradio', { name: 'By recent use', exact: true })).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(page.getByRole('menuitemradio', { name: 'By creation time', exact: true }))
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect([...document.querySelectorAll<HTMLElement>('[data-project-id]')].map((p) => p.dataset.projectId)).toEqual(['new', 'used'])
  await expect.element(projects.getByRole('button', { name: 'Newest', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Collapse all projects', exact: true }))
  await expect.element(projects.getByRole('button', { name: 'Newest', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect.element(projects.getByRole('button', { name: 'Recently used', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(page.getByRole('button', { name: 'Expand all projects', exact: true }))
  await expect.element(projects.getByRole('button', { name: 'Newest', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(projects.getByRole('button', { name: 'Newest', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Collapse all projects', exact: true })).toBeInTheDocument()
})

it('drag handle reorders only categories and restart restores display state but resets page sizes and menus', async () => {
  const sessions = [
    ...Array.from({ length: 7 }, (_, i) => ({ ...fixtureSessions[0]!, id: `persist-${i}`, title: `Persist ${i}`, projectId: null, updatedAt: 100 - i })),
    ...fixtureSessions,
  ]
  const fixture = createFixtureChat({ sessions })
  await fixture.chat.getState().load()
  const mount = (chat: typeof fixture.chat) =>
    render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <TooltipProvider>
            <div style={{ width: 280 }}>
              <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={(id) => chat.getState().openSession(id)} />
            </div>
          </TooltipProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
  const first = await mount(fixture.chat)
  const conversations = page.getByRole('region', { name: 'Conversations', exact: true })
  await userEvent.click(conversations.getByRole('button', { name: 'Expand', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Persist 2', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'coko', exact: true }))
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Sort projects', exact: true }))
  await userEvent.click(page.getByRole('menuitemradio', { name: 'By creation time', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Collapse Projects category', exact: true }))
  await userEvent.hover(page.getByRole('heading', { name: 'Conversations', exact: true }))
  await userEvent.dragAndDrop(
    page.getByRole('button', { name: 'Drag Conversations category', exact: true }),
    page.getByRole('heading', { name: 'Projects', exact: true }),
  )
  expect([...document.querySelectorAll<HTMLElement>('[data-category]')].map((n) => n.dataset.category)).toEqual(['projects', 'conversations'])
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await first.unmount()
  const restarted = createFixtureChat({ sessions })
  await restarted.chat.getState().load()
  await mount(restarted.chat)
  expect([...document.querySelectorAll<HTMLElement>('[data-category]')].map((n) => n.dataset.category)).toEqual(['projects', 'conversations'])
  await expect.element(page.getByRole('button', { name: 'Expand Projects category', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect.element(page.getByRole('button', { name: 'Persist 2', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect.element(page.getByRole('button', { name: 'Persist 5', exact: true })).not.toBeInTheDocument()
  await userEvent.click(page.getByRole('button', { name: 'Expand Projects category', exact: true }))
  await expect.element(page.getByRole('button', { name: 'coko', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Sort projects', exact: true }))
  await expect.element(page.getByRole('menuitemradio', { name: 'By creation time', exact: true })).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
})

it('projects and each project conversation list page independently; pinned project expansion is untouched', async () => {
  const sessions = [
    ...Array.from({ length: 8 }, (_, i) => ({ ...fixtureSessions[0]!, id: `inner-${i}`, title: `Inner ${i}`, projectId: 'p0', updatedAt: 100 - i })),
    ...Array.from({ length: 7 }, (_, i) => ({ ...fixtureSessions[0]!, id: `outer-${i}`, title: `Outer ${i}`, projectId: null, updatedAt: 100 - i })),
  ]
  const fixture = createFixtureChat({ sessions })
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({
    projects: Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `Project ${i}`,
      primaryWorkspaceId: `w${i}`,
      folders: [],
      pinnedAt: i === 6 ? 1 : null,
      createdAt: 100 - i,
      lastUsedAt: 100 - i,
      sessionCount: i === 0 ? 8 : 0,
    })),
    expandedProjects: { p6: true },
  })
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
  await expect.element(page.getByRole('button', { name: 'Project 5', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Inner 5', exact: true })).not.toBeInTheDocument()
  const projects = page.getByRole('region', { name: 'Projects', exact: true })
  const project = page.getByRole('button', { name: 'Project 0', exact: true }).element().closest('[data-project-id]')!
  const innerExpand = [...project.querySelectorAll('button')].find((button) => button.textContent === 'Expand')!
  await userEvent.click(innerExpand)
  await expect.element(page.getByRole('button', { name: 'Inner 7', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Outer 5', exact: true })).not.toBeInTheDocument()
  const projectExpand = [...projects.element().querySelectorAll('button')].filter((button) => button.textContent === 'Expand').at(-1)!
  await userEvent.click(projectExpand)
  await expect.element(page.getByRole('button', { name: 'Project 5', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Inner 7', exact: true })).toBeVisible()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Collapse all projects', exact: true }))
  expect(fixture.chat.lists.getState().expandedProjects.p6).toBe(true)
})

it('recent project order follows newly appended session entries', async () => {
  const fixture = createFixtureChat()
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
  expect([...document.querySelectorAll<HTMLElement>('[data-project-id]')].map((p) => p.dataset.projectId)).toEqual(['project-w-coko', 'project-w-pi'])
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-8',
    entry: {
      sessionId: 's-8',
      seq: 1,
      kind: 'message',
      payloadVersion: 1,
      payload: { role: 'user', content: 'new activity', timestamp: 1000 },
      runId: 'r-new',
      createdAt: 1000,
    },
  })
  await expect
    .poll(() => [...document.querySelectorAll<HTMLElement>('[data-project-id]')].map((p) => p.dataset.projectId))
    .toEqual(['project-w-pi', 'project-w-coko'])
})

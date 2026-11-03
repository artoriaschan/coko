import '../../styles.css'
import { expect, it, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function firePointer(target: EventTarget, type: string, point: { x: number; y: number }, init: PointerEventInit = {}) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
      ...init,
    }),
  )
}

/** dnd-kit 的 PointerSensor 走 pointer 事件；Playwright 的 dragAndDrop 只发 HTML5 拖放事件。 */
function startCategoryDrag(source: Element, target: Element) {
  const from = centerOf(source)
  const to = centerOf(target)
  firePointer(source, 'pointerdown', from, { button: 0, buttons: 1 })
  firePointer(document, 'pointermove', { x: from.x + 8, y: from.y + 8 }, { buttons: 1 })
  firePointer(document, 'pointermove', to, { buttons: 1 })
  return { point: to, end: () => firePointer(document, 'pointerup', to, { button: 0, buttons: 0 }) }
}

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
  expect(getComputedStyle(row).userSelect).toBe('none')
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

it('会话列表始终预留滚动条槽位，内容溢出前后内容宽度不变', async () => {
  const fixture = createFixtureChat({
    sessions: Array.from({ length: 12 }, (_, index) => ({
      ...fixtureSessions[0]!,
      id: `gutter-${index}`,
      title: `Gutter ${index}`,
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
  const nav = document.querySelector<HTMLElement>('nav')!
  expect(nav.hasAttribute('data-scroll-stable')).toBe(true)
  expect(getComputedStyle(nav).scrollbarGutter).toBe('stable')
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

it.each(['light', 'dark'])('%s：拖拽分类时显示卡片浮层和蓝色插入指示线', async (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  onTestFinished(() => document.documentElement.classList.remove('dark'))
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
  expect(document.querySelector('[data-category-drop-indicator]')).toBeNull()
  const projectsSection = document.querySelector<HTMLElement>('[data-category="projects"]')!
  const drag = startCategoryDrag(
    page.getByRole('button', { name: 'Drag Conversations category', exact: true }).element(),
    projectsSection.querySelector('[data-category-header]')!,
  )
  try {
    await expect.poll(() => document.querySelector('[data-category-drag-card]') !== null).toBe(true)
    const card = document.querySelector<HTMLElement>('[data-category-drag-card]')!
    expect(card.textContent).toContain('Conversations')
    expect(card.getBoundingClientRect().height).toBe(32)
    expect(getComputedStyle(card).borderRadius).toBe('12px')
    expect(card.getBoundingClientRect().width).toBeLessThan(projectsSection.getBoundingClientRect().width)
    expect(card.getBoundingClientRect().width).toBeGreaterThanOrEqual(80)
    expect(card.querySelector('svg')).not.toBeNull()
    // 浮层跟随指针：横向与纵向都以抓取点为中心移动，而不是锁在侧栏左边缘。
    const cardBox = card.getBoundingClientRect()
    expect(Math.abs(cardBox.left - (drag.point.x - 16))).toBeLessThanOrEqual(2)
    expect(Math.abs(cardBox.top + cardBox.height / 2 - drag.point.y)).toBeLessThanOrEqual(2)
    const indicator = projectsSection.querySelector<HTMLElement>('[data-category-drop-indicator]')
    expect(indicator).not.toBeNull()
    expect(indicator!.getBoundingClientRect().height).toBe(2)
    expect(indicator!.querySelector('.rounded-round')).not.toBeNull()
    const dot = indicator!.firstElementChild!.getBoundingClientRect()
    expect(dot.width).toBe(8)
    expect(dot.height).toBe(8)
    const [red = 0, green = 0, blue = 0] = getComputedStyle(indicator!).backgroundColor.match(/\d+/g)!.map(Number)
    expect(blue).toBeGreaterThan(red)
    expect(blue).toBeGreaterThan(green)
    expect(Math.abs(indicator!.getBoundingClientRect().bottom - projectsSection.getBoundingClientRect().top)).toBeLessThanOrEqual(4)
  } finally {
    drag.end()
  }
  await expect.poll(() => [...document.querySelectorAll<HTMLElement>('[data-category]')].map((n) => n.dataset.category)).toEqual(['projects', 'conversations'])
  await expect.poll(() => document.querySelector('[data-category-drag-card]') === null).toBe(true)
  await expect.poll(() => document.querySelector('[data-category-drop-indicator]') === null).toBe(true)
})

it('当对话分类位于项目分类下方时，可以向上拖动换到项目分类前面', async () => {
  const fixture = createFixtureChat()
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({ categoryOrder: ['projects', 'conversations'] })
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
  const projectsSection = document.querySelector<HTMLElement>('[data-category="projects"]')!
  const drag = startCategoryDrag(
    page.getByRole('button', { name: 'Drag Conversations category', exact: true }).element(),
    projectsSection.querySelector('[data-category-header]')!,
  )
  try {
    await expect.poll(() => projectsSection.querySelector('[data-category-drop-indicator]') !== null).toBe(true)
  } finally {
    drag.end()
  }
  await expect.poll(() => [...document.querySelectorAll<HTMLElement>('[data-category]')].map((n) => n.dataset.category)).toEqual(['conversations', 'projects'])
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
  const drag = startCategoryDrag(
    page.getByRole('button', { name: 'Drag Conversations category', exact: true }).element(),
    document.querySelector('[data-category="projects"] [data-category-header]')!,
  )
  try {
    await expect.poll(() => document.querySelector('[data-category-drag-card]') !== null).toBe(true)
  } finally {
    drag.end()
  }
  await expect.poll(() => [...document.querySelectorAll<HTMLElement>('[data-category]')].map((n) => n.dataset.category)).toEqual(['projects', 'conversations'])
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

it('空状态：无项目和对话时显示对应文案并左对齐', async () => {
  const fixture = createFixtureChat({ sessions: [] })
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({ projects: [], sessions: [] })
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
  await expect.element(page.getByText('No conversations', { exact: true })).toBeVisible()
  await expect.element(page.getByText('No projects', { exact: true })).toBeVisible()
  const textLeft = (element: HTMLElement) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getBoundingClientRect().left
  }
  const conversations = document.querySelector<HTMLElement>('[data-category="conversations"] [data-slot="sidebar-empty"]')!
  const projects = document.querySelector<HTMLElement>('[data-category="projects"] [data-slot="sidebar-empty"]')!
  expect(textLeft(conversations)).toBe(16)
  expect(textLeft(projects)).toBe(16)
  expect(conversations.getBoundingClientRect().height).toBe(32)
  expect(projects.getBoundingClientRect().height).toBe(32)
})

it('空状态：项目内无对话保留图标位并与项目名称对齐', async () => {
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, id: 'standalone', title: 'Standalone', projectId: null }] })
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({
    projects: [{ id: 'p0', name: 'Example project', primaryWorkspaceId: 'w-coko', folders: [], pinnedAt: null, createdAt: 1, lastUsedAt: 1, sessionCount: 0 }],
    sessions: [{ ...fixtureSessions[0]!, id: 'standalone', title: 'Standalone', projectId: null }],
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
  const projectName = document.querySelector<HTMLElement>('[data-project-row] .fading-title')!.getBoundingClientRect()
  const empty = document.querySelector<HTMLElement>('[data-project-id] [data-slot="sidebar-empty"]')!
  const range = document.createRange()
  range.selectNodeContents(empty)
  expect(range.getBoundingClientRect().left).toBe(projectName.left)
  expect(empty.getBoundingClientRect().height).toBe(32)
})

it('项目行右键打开项目操作菜单', async () => {
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, id: 'standalone', title: 'Standalone', projectId: null }] })
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({
    projects: [{ id: 'p0', name: 'Example project', primaryWorkspaceId: 'w-coko', folders: [], pinnedAt: null, createdAt: 1, lastUsedAt: 1, sessionCount: 0 }],
    sessions: [{ ...fixtureSessions[0]!, id: 'standalone', title: 'Standalone', projectId: null }],
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
  const row = document.querySelector<HTMLElement>('[data-project-row]')!
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 100 }))
  const menu = page.getByRole('menu', { name: 'Project actions' })
  await expect.element(menu).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
})

it('分类标题整行可切换，右侧操作按钮不触发切换', async () => {
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
  const section = document.querySelector<HTMLElement>('[data-category="projects"]')!
  const header = () => document.querySelector<HTMLElement>('[data-category="projects"] [data-category-header]')!
  const expanded = () => header().querySelector('[data-category-toggle]')!.getAttribute('aria-expanded')
  expect(expanded()).toBe('true')

  // 标题行的空白区域也可切换（事件目标是标题行本身，而不是名称按钮）。
  header().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await expect.poll(expanded).toBe('false')
  header().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await expect.poll(expanded).toBe('true')

  // 右侧操作按钮维持自身功能，不冒泡触发分类切换。
  const action = header().querySelector<HTMLElement>('[data-category-actions] button')!
  action.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(expanded()).toBe('true')
  expect(section).toBeTruthy()
})

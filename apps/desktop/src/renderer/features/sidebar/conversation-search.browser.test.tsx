import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import * as React from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Toaster, toast, TooltipProvider } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { WorkbenchNavigationContext } from '../../app/workbench.tsx'
import { createWorkbenchNavigation } from '../../app/workbench-navigation.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { ApiError } from '../../client/api.ts'
import { ConversationSearch } from './conversation-search.tsx'

async function setup(
  sessions = Array.from({ length: 16 }, (_, i) => ({
    ...fixtureSessions[0]!,
    id: `search-${i}`,
    title: `Example conversation ${i}`,
    updatedAt: 1000 - i,
    projectId: i % 2 ? null : 'project-w-coko',
    pinnedAt: i === 0 ? 20 : null,
  })),
  locale: 'en' | 'zh' = 'en',
) {
  await page.viewport(1000, 800)
  const fixture = createFixtureChat({ sessions })
  await fixture.chat.getState().load()
  const navigation = createWorkbenchNavigation(fixture.chat)
  function Harness() {
    const [open, setOpen] = React.useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Search trigger</button>
        <ConversationSearch open={open} onOpenChange={setOpen} />
      </>
    )
  }
  await render(
    <I18nProvider locale={locale}>
      <ChatStoreProvider store={fixture.chat}>
        <WorkbenchNavigationContext.Provider value={navigation}>
          <TooltipProvider>
            <Harness />
            <Toaster containerAriaLabel="Notifications" />
          </TooltipProvider>
        </WorkbenchNavigationContext.Provider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  await userEvent.click(page.getByRole('button', { name: 'Search trigger' }))
  return fixture
}

it('opens ten recent conversations then searches all titles, highlights, deduplicates and keeps only results scrolling', async () => {
  const fixture = await setup()
  const dialog = page.getByRole('dialog', { name: 'Search conversations' })
  const input = dialog.getByRole('combobox')
  await expect.element(input).toHaveFocus()
  await expect.element(dialog.getByRole('heading', { name: 'Recent conversations' })).toBeVisible()
  expect(dialog.element().querySelectorAll('[role=option]')).toHaveLength(10)
  await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(640)
  expect(dialog.element().getBoundingClientRect().height).toBe(432)
  expect(dialog.element().querySelector('[role=tab]')).toBeNull()
  const firstRow = dialog.getByRole('option').first().element()
  expect(firstRow.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(firstRow).borderRadius).toBe('8px')
  expect(getComputedStyle(firstRow).getPropertyValue('corner-shape')).toBe('superellipse(1)')
  await userEvent.fill(input, '  CONVERSATION  ')
  expect(dialog.element().querySelectorAll('[role=option]')).toHaveLength(16)
  expect(dialog.element().querySelector('mark')?.textContent).toBe('conversation')
  const results = dialog.getByRole('listbox').element()
  expect(results.scrollHeight).toBeGreaterThan(results.clientHeight)
  await page.screenshot({ path: '../../../../../../.vitest/cw22-search-results.png' })
  const inputTop = input.element().getBoundingClientRect().top
  results.scrollTop = results.scrollHeight
  expect(input.element().getBoundingClientRect().top).toBe(inputTop)
  fixture.chat.lists.setState({ sessions: [...fixture.chat.lists.getState().sessions, fixture.chat.lists.getState().sessions[0]!] })
  expect(dialog.element().querySelectorAll('[role=option]')).toHaveLength(16)
  await userEvent.fill(input, 'coko')
  await expect.element(dialog.getByText('No matching conversations')).toBeVisible()
  await expect.element(input).toHaveValue('coko')
  await userEvent.fill(input, '')
  expect(dialog.element().querySelectorAll('[role=option]')).toHaveLength(10)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Search trigger' })).toHaveFocus()
})

it('composition waits until commit and keyboard selection opens the same existing Session without changing its ownership', async () => {
  const sessions = [
    { ...fixtureSessions[0]!, id: 'one', title: '中文 destination', updatedAt: 200, projectId: null },
    { ...fixtureSessions[0]!, id: 'two', title: '中文 pinned project', updatedAt: 100, pinnedAt: 50 },
    { ...fixtureSessions[0]!, id: 'archived', title: '中文 archived', updatedAt: 300, archivedAt: 25 },
  ]
  const fixture = await setup(sessions)
  const original = fixture.chat.getState().activeSessionId
  const input = page.getByRole('combobox')
  input.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await input.fill('中文 pinned')
  expect(document.querySelectorAll('[data-search-session]')).toHaveLength(2)
  input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).toBeVisible()
  expect(fixture.chat.getState().activeSessionId).toBe(original)
  input.element().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文 pinned' }))
  await expect.element(page.getByRole('option', { name: '中文 pinned project' })).toBeVisible()
  expect(document.querySelectorAll('[data-search-session]')).toHaveLength(1)
  await input.fill('中文')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
  expect(fixture.chat.getState().activeSessionId).toBe('two')
  expect(fixture.chat.lists.getState().sessions.find((session) => session.id === 'two')).toEqual(sessions[1])
  expect(await fixture.api.listSessions()).toHaveLength(2)
  expect(await fixture.api.listArchivedSessions()).toHaveLength(1)
})

it('right-click targets the selected result, keeps the query behind delete cancellation and reuses rename and pin', async () => {
  const fixture = await setup()
  const input = page.getByRole('combobox')
  await input.fill('conversation 1')
  const row = page.getByRole('option', { name: 'Example conversation 1', exact: true })
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete conversation', exact: true }))
  const confirm = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await expect.element(confirm).toBeVisible()
  await expect.element(confirm.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  await expect.poll(() => getComputedStyle(confirm.element()).opacity).toBe('1')
  await page.screenshot({ path: '../../../../../../.vitest/cw22-search-delete.png' })
  await userEvent.click(confirm.getByRole('button', { name: 'Cancel', exact: true }))
  await expect.element(confirm).not.toBeInTheDocument()
  await expect.element(input).toHaveValue('conversation 1')
  await expect.element(row).toBeVisible()
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Pin conversation', exact: true }))
  expect(fixture.chat.lists.getState().sessions.find((session) => session.id === 'search-1')?.pinnedAt).not.toBeNull()
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Rename', exact: true }))
  const rename = page.getByRole('textbox', { name: 'Conversation title' })
  await rename.fill('Example conversation 1 renamed')
  rename.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  await expect.element(rename).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('option', { name: 'Example conversation 1 renamed' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

it.each(['light', 'dark'])('%s Chinese search uses shared geometry and survives narrow windows, empty lists and outside dismissal', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await setup([], 'zh')
    const dialog = page.getByRole('dialog', { name: '搜索对话' })
    await expect.element(dialog.getByText('暂无最近对话')).toBeVisible()
    await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(640)
    expect(getComputedStyle(dialog.element()).padding).toBe('12px')
    expect(getComputedStyle(dialog.element()).borderRadius).toBe('28px')
    const input = page.getByRole('combobox')
    expect(input.element().getBoundingClientRect().height).toBe(40)
    await input.fill('关键词')
    await expect.element(dialog.getByText('未找到匹配的对话')).toBeVisible()
    await expect.element(dialog.getByText('试试其他关键词')).toBeVisible()
    await page.screenshot({ path: `../../../../../../.vitest/cw22-search-${theme}.png` })
    await page.viewport(390, 300)
    await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(358)
    expect(dialog.element().getBoundingClientRect().height).toBeLessThanOrEqual(268)
    await userEvent.click(document.body, { position: { x: 2, y: 2 } })
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Search trigger' })).toHaveFocus()
    await userEvent.click(page.getByRole('button', { name: 'Search trigger' }))
    await expect.element(page.getByRole('combobox')).toHaveValue('')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  } finally {
    document.documentElement.className = original
  }
})

it('title-only search excludes message content and full long titles remain accessible with live project labels and relative time', async () => {
  const fullTitle = 'Example title ' + 'very long conversation '.repeat(15)
  const session = { ...fixtureSessions[0]!, title: fullTitle, updatedAt: Date.now() - 120000 }
  const fixture = await setup([session])
  const input = page.getByRole('combobox')
  const row = page.getByRole('option', { name: fullTitle, exact: true })
  await expect.element(row).toBeVisible()
  await expect.element(row.getByText('2m ago')).toBeVisible()
  const title = row.element().querySelector('[data-user-content]')!
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
  await expect.element(row.getByText('coko', { exact: true })).toBeVisible()
  fixture.chat.lists.getState().upsertProject({ ...fixture.chat.lists.getState().projects[0]!, name: 'Renamed project' })
  await expect.element(row.getByText('Renamed project')).toBeVisible()
  fixture.chat.lists.getState().patchSession(session.id, { projectId: null })
  await expect.element(row.getByText('Renamed project')).not.toBeInTheDocument()
  await input.fill('三栏')
  await expect.element(page.getByText('No matching conversations')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

it('pointer menus avoid viewport edges and delete stays bound to the original Session across list reordering', async () => {
  const fixture = await setup()
  await page.viewport(390, 300)
  const input = page.getByRole('combobox')
  await input.fill('conversation 1')
  const row = page.getByRole('option', { name: 'Example conversation 1', exact: true })
  const rect = row.element().getBoundingClientRect()
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right - 3, clientY: rect.top + 16, button: 2 })
  expect(row.element().dispatchEvent(event)).toBe(false)
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  await expect.element(menu).toBeVisible()
  await expect.poll(() => menu.element().getBoundingClientRect().right).toBeLessThanOrEqual(382)
  await expect.poll(() => menu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(8)
  expect(menu.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(292)
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete conversation', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await expect.element(dialog).toBeVisible()
  fixture.chat.lists.getState().patchSession('search-15', { updatedAt: Date.now() })
  await userEvent.click(dialog.getByRole('button', { name: 'Delete', exact: true }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).toBeVisible()
  await expect.element(input).toHaveValue('conversation 1')
  expect(fixture.chat.lists.getState().sessions.some((session) => session.id === 'search-1')).toBe(false)
  expect(fixture.chat.lists.getState().sessions.some((session) => session.id === 'search-15')).toBe(true)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

it.each([
  [0, 'Just now'],
  [60_000, '1m ago'],
  [59 * 60_000, '59m ago'],
  [60 * 60_000, '1h ago'],
  [86400000, '1d ago'],
  [7 * 86400000, '7d ago'],
  [7 * 86400000 + 60_000, '10/26/26'],
  [8 * 86400000, '10/25/26'],
])('highlights every title occurrence and formats age %i with the card seven-day boundary', async (age, expected) => {
  const now = Date.UTC(2026, 10, 2, 12)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    await setup([{ ...fixtureSessions[0]!, title: 'Example EXAMPLE example', updatedAt: now - age }])
    const input = page.getByRole('combobox')
    await input.fill('example')
    const row = page.getByRole('option', { name: 'Example EXAMPLE example' })
    expect([...row.element().querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Example', 'EXAMPLE', 'example'])
    await expect.element(row.getByText(expected)).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
  } finally {
    clock.mockRestore()
  }
})

it('the shared archive action removes its original result, excludes archives even if injected into normal data and keeps the query', async () => {
  const fixture = await setup()
  const input = page.getByRole('combobox')
  await input.fill('conversation 0')
  const row = page.getByRole('option', { name: 'Example conversation 0', exact: true })
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Archive conversation', exact: true }))
  await expect.element(page.getByText('No matching conversations')).toBeVisible()
  await expect.element(input).toHaveValue('conversation 0')
  const archived = fixture.chat.lists.getState().archivedSessions.find((session) => session.id === 'search-0')!
  expect(archived.archivedAt).not.toBeNull()
  expect(archived.pinnedAt).toBeNull()
  fixture.chat.lists.setState({ sessions: [...fixture.chat.lists.getState().sessions, archived] })
  await expect.element(row).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

it('failed archive retains the query and result and reports the shared busy reason', async () => {
  const fixture = await setup()
  fixture.api.archiveSession = async () => {
    throw new ApiError('session-busy', 'busy', 409, { reasons: ['run'], sessions: [{ id: 'search-0', title: 'Example conversation 0' }] })
  }
  const input = page.getByRole('combobox')
  await input.fill('conversation 0')
  const row = page.getByRole('option', { name: 'Example conversation 0', exact: true })
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Archive conversation', exact: true }))
  await expect.element(page.getByText('Cannot archive while work is ongoing: Run. Example conversation 0')).toBeVisible()
  await expect.element(input).toHaveValue('conversation 0')
  await expect.element(row).toBeVisible()
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

it('the focused combobox opens row-anchored actions by keyboard, keeps child layers, and operates all five shared actions', async () => {
  const fixture = await setup()
  const searchDialog = page.getByRole('dialog', { name: 'Search conversations' })
  await Promise.all(
    searchDialog
      .element()
      .getAnimations()
      .map((animation) => animation.finished),
  )
  const input = page.getByRole('combobox')
  await input.fill('conversation 1')
  input.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await userEvent.keyboard('{ContextMenu}')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  input.element().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('option', { name: 'Example conversation 10', exact: true })).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{ContextMenu}')
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  await expect.element(menu).toBeVisible()
  const selected = page.getByRole('option', { name: 'Example conversation 10', exact: true })
  const anchor = document.querySelector<HTMLElement>('[data-slot=dropdown-menu-trigger][aria-hidden=true]')!
  expect(anchor.style.left).toBe(`${selected.element().getBoundingClientRect().left}px`)
  expect(anchor.style.top).toBe(`${selected.element().getBoundingClientRect().bottom}px`)
  await userEvent.keyboard('{Escape}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  const open = async () => {
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    await expect.element(menu).toBeVisible()
    await userEvent.keyboard('{Home}')
    await expect.element(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveFocus()
  }
  const down = async (name: string) => {
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name, exact: true })).toHaveFocus()
  }
  await open()
  await down('Pin conversation')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fixture.chat.lists.getState().sessions.find((s) => s.id === 'search-1')?.pinnedAt).not.toBeNull()
  await expect.element(input).toHaveFocus()
  await open()
  await userEvent.keyboard('{Enter}')
  const rename = page.getByRole('textbox', { name: 'Conversation title' })
  await expect.element(rename).toHaveFocus()
  await rename.fill('Example conversation 1 keyboard')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveFocus()
  await open()
  const move = page.getByRole('menuitem', { name: 'Move to project', exact: true })
  await down('Unpin conversation')
  await down('Archive conversation')
  await down('Move to project')
  await userEvent.keyboard('{ArrowRight}')
  const child = page.getByRole('menu', { name: 'Move to project', exact: true })
  await expect.element(child).toBeVisible()
  const projectSearch = page.getByRole('textbox', { name: 'Search projects' })
  await expect.element(projectSearch).toHaveFocus()
  projectSearch.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await userEvent.keyboard('{ArrowDown}{Escape}')
  await expect.element(projectSearch).toHaveFocus()
  await expect.element(child).toBeVisible()
  projectSearch.element().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await userEvent.keyboard('{Escape}')
  await expect.element(child).not.toBeInTheDocument()
  await expect.element(menu).toBeVisible()
  await expect.element(move).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(child).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('menuitemradio', { name: 'coko', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fixture.chat.lists.getState().sessions.find((s) => s.id === 'search-1')?.projectId).toBe('project-w-coko')
  await expect.element(input).toHaveFocus()
  await open()
  await userEvent.keyboard('{End}')
  await expect.element(page.getByRole('menuitem', { name: 'Delete conversation', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const deleting = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await expect.element(deleting.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(deleting).not.toBeInTheDocument()
  await expect.element(input).toHaveFocus()
  await expect.element(input).toHaveValue('conversation 1')
  await open()
  await down('Unpin conversation')
  await down('Archive conversation')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fixture.chat.lists.getState().archivedSessions.some((s) => s.id === 'search-1')).toBe(true)
  await expect.element(input).toHaveFocus()
  await open()
  await userEvent.keyboard('{End}')
  await expect.element(page.getByRole('menuitem', { name: 'Delete conversation', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(deleting.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(deleting.getByRole('button', { name: 'Delete', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(deleting).not.toBeInTheDocument()
  expect(fixture.chat.lists.getState().sessions.some((s) => s.id === 'search-10')).toBe(false)
  await expect.element(input).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Search conversations' })).not.toBeInTheDocument()
})

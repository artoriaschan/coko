import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import { expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Toaster, TooltipProvider, toast } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

it('pinning moves one session without changing selection; unpin restores its project', async () => {
  const session = { ...fixtureSessions[0]!, title: 'Example conversation' }
  const fixture = createFixtureChat({ sessions: [session] })
  await fixture.chat.getState().load()
  await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 280 }}>
            <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={(id) => fixture.chat.getState().openSession(id)} />
          </div>
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  await expect.element(page.getByRole('heading', { name: 'Pinned', exact: true })).not.toBeInTheDocument()
  await userEvent.hover(page.getByRole('button', { name: session.title, exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Pin conversation', exact: true }))
  const pinned = page.getByRole('region', { name: 'Pinned', exact: true })
  await expect.element(pinned.getByRole('button', { name: session.title, exact: true })).toBeVisible()
  expect(document.querySelectorAll(`[data-session-id="${session.id}"]`)).toHaveLength(1)
  expect(fixture.chat.getState().activeSessionId).toBe(session.id)
  expect(fixture.chat.lists.getState().sessions[0]!.projectId).toBe(session.projectId)
  expect(document.querySelector('[data-category="pinned"] [data-category-actions]')).toBeNull()
  await userEvent.hover(pinned.getByRole('button', { name: session.title, exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Unpin conversation', exact: true }))
  await expect.element(page.getByRole('heading', { name: 'Pinned', exact: true })).not.toBeInTheDocument()
  expect(document.querySelector(`[data-project-id="${session.projectId}"] [data-session-id="${session.id}"]`)).not.toBeNull()
})

it.each(['light', 'dark'])('%s long titles scroll by keyboard, wheel and drag with directional fades and fixed controls', async (theme) => {
  await page.viewport(1000, 800)
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    let selected = 0
    const title = 'Example conversation with a very long title that remains fully readable through controlled horizontal scrolling'
    const fixture = createFixtureChat({
      sessions: [
        { ...fixtureSessions[0]!, title, projectId: null },
        { ...fixtureSessions[0]!, id: 'short', title: 'Short', projectId: null },
      ],
    })
    await fixture.chat.getState().load()
    await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={fixture.chat}>
          <TooltipProvider>
            <div style={{ width: 280 }}>
              <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => selected++} />
            </div>
          </TooltipProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
    const row = page.getByRole('button', { name: title, exact: true }).element() as HTMLButtonElement
    const text = row.querySelector<HTMLElement>('[data-scrollable-title]')
    expect(text).not.toBeNull()
    const scroll = text!
    await expect.poll(() => scroll.dataset.fade).toBe('right')
    expect(getComputedStyle(scroll).maskImage).not.toBe('none')
    const controls = row.parentElement!.querySelector<HTMLElement>('[data-session-actions]')!
    const fixed = controls.getBoundingClientRect().left
    row.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => scroll.dataset.fade).toBe('both')
    await userEvent.keyboard('{End}')
    await expect.poll(() => scroll.dataset.fade).toBe('left')
    await userEvent.keyboard('{Home}')
    scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true }))
    await expect.poll(() => scroll.scrollLeft).toBe(60)
    expect(controls.getBoundingClientRect().left).toBe(fixed)
    const pin = controls.querySelector<SVGSVGElement>('svg.lucide-pin')!
    expect(getComputedStyle(pin).width).toBe('14px')
    expect(getComputedStyle(pin).rotate).toBe('45deg')
    const pinBox = pin.getBoundingClientRect()
    const pinButton = pin.parentElement!.getBoundingClientRect()
    expect(pinBox.left + pinBox.width / 2).toBeCloseTo(pinButton.left + pinButton.width / 2)
    expect(pinBox.top + pinBox.height / 2).toBeCloseTo(pinButton.top + pinButton.height / 2)
    const box = scroll.getBoundingClientRect()
    const frame = window.frameElement?.getBoundingClientRect()
    const x = box.left + box.width / 2 + (frame?.left ?? 0)
    const y = box.top + box.height / 2 + (frame?.top ?? 0)
    const mouse = cdp()
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await mouse.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    try {
      await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y, button: 'left', buttons: 1 })
    } finally {
      await mouse.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 40, y, button: 'left', buttons: 0, clickCount: 1 })
    }
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(60)
    expect(selected).toBe(0)
    expect(fixture.chat.lists.getState().sessions.every((session) => session.pinnedAt === null)).toBe(true)
    expect(controls.getBoundingClientRect().left).toBe(fixed)
    const short = page.getByRole('button', { name: 'Short', exact: true }).element().querySelector<HTMLElement>('[data-scrollable-title]')!
    expect(short.dataset.fade).toBe('none')
    expect(getComputedStyle(short).maskImage).toBe('none')
    await userEvent.hover(page.getByRole('button', { name: title, exact: true }))
    const details = page.getByRole('region', { name: 'Conversation details', exact: true })
    await expect.element(details).toBeVisible()
    await expect.poll(() => details.element().getBoundingClientRect().width).toBe(336)
    await page.screenshot({ path: `../../../../../../.vitest/cw07-${theme}.png` })
    await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  } finally {
    document.documentElement.className = original
  }
})

it('conversation details are right of the entire row by2px, top aligned and retain project ownership after pinning', async () => {
  await page.viewport(1000, 800)
  const session = { ...fixtureSessions[0]!, title: 'Example complete title', pinnedAt: 20 }
  const fixture = createFixtureChat({ sessions: [session, { ...session, id: 'solo', title: 'Standalone example', pinnedAt: null, projectId: null }] })
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
  const row = page.getByRole('button', { name: session.title, exact: true })
  await userEvent.hover(row)
  const details = page.getByRole('region', { name: 'Conversation details', exact: true })
  await expect.element(details).toBeVisible()
  await expect.element(details.getByText('coko', { exact: true })).toBeVisible()
  const box = row.element().getBoundingClientRect()
  await expect.poll(() => details.element().getBoundingClientRect().left - box.right).toBe(2)
  expect(details.element().getBoundingClientRect().top).toBe(box.top)
  await userEvent.hover(details)
  await expect.element(details).toBeVisible()
  await userEvent.hover(page.getByRole('button', { name: 'Standalone example', exact: true }))
  await expect.element(details.getByText('Conversations', { exact: true })).toBeVisible()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await expect.element(details).not.toBeInTheDocument()
})

it('details remain readable inside a narrow, short viewport', async () => {
  await page.viewport(390, 300)
  const title = 'Example long conversation title '.repeat(6)
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title, projectId: null }] })
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
  await userEvent.hover(page.getByRole('button', { name: title.trim(), exact: true }))
  const details = page.getByRole('region', { name: 'Conversation details', exact: true })
  await expect.element(details).toBeVisible()
  const rect = details.element().getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(8)
  expect(rect.right).toBeLessThanOrEqual(382)
  expect(rect.bottom).toBeLessThanOrEqual(292)
  expect(details.element().textContent).toContain(title.trim())
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
})

it('all pinned sessions stay above reorderable categories in pin-time order despite new activity', async () => {
  await page.viewport(1000, 800)
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    ...fixtureSessions[0]!,
    id: `pinned-${index}`,
    title: `Pinned example ${index}`,
    pinnedAt: index + 1,
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
  const ids = () => [...document.querySelectorAll<HTMLElement>('[data-category="pinned"] [data-session-id]')].map((row) => row.dataset.sessionId)
  expect(ids()).toEqual(['pinned-7', 'pinned-6', 'pinned-5', 'pinned-4', 'pinned-3', 'pinned-2', 'pinned-1', 'pinned-0'])
  fixture.chat.lists.getState().patchSession('pinned-0', { updatedAt: 100_000 })
  fixture.chat.lists.getState().reorderCategories('projects')
  await expect
    .poll(() => [...document.querySelectorAll<HTMLElement>('[data-category]')].map((section) => section.dataset.category))
    .toEqual(['pinned', 'projects', 'conversations'])
  expect(ids()).toEqual(['pinned-7', 'pinned-6', 'pinned-5', 'pinned-4', 'pinned-3', 'pinned-2', 'pinned-1', 'pinned-0'])
  expect(document.querySelectorAll('[data-project-id] [data-session-id]')).toHaveLength(0)
  expect(page.getByRole('region', { name: 'Pinned', exact: true }).element().textContent).not.toContain('Expand')
})

it('keyboard focus keeps the card readable; Escape returns focus and more closes details immediately', async () => {
  await page.viewport(1000, 800)
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title: 'Focus example', updatedAt: Date.now() }] })
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
  const row = page.getByRole('button', { name: 'Focus example', exact: true })
  ;(row.element() as HTMLElement).focus()
  const details = page.getByRole('region', { name: 'Conversation details', exact: true })
  await expect.element(details.getByText('Just now', { exact: true })).toBeVisible()
  ;(details.element() as HTMLElement).focus()
  await expect.element(details).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()
  await userEvent.hover(row)
  await expect.element(details).toBeVisible()
  await userEvent.click(page.getByRole('button', { name: 'More conversation actions', exact: true }))
  await expect.element(details).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu', { name: 'Conversation actions' })).not.toBeInTheDocument()
})

it('failed pin preserves ownership and list location and reports a retryable error', async () => {
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, title: 'Retry example' }] })
  fixture.api.setSessionPinned = async () => {
    throw new Error('protocol failure')
  }
  await fixture.chat.getState().load()
  await render(
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
  await userEvent.hover(page.getByRole('button', { name: 'Retry example', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Pin conversation', exact: true }))
  await expect.element(page.getByText('Could not update pin status. Try again.', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-project-id] [data-session-id]')).not.toBeNull()
  expect(fixture.chat.lists.getState().sessions[0]!.pinnedAt).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Pin conversation', exact: true })).toBeEnabled()
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
})

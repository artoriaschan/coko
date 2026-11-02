import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Toaster, TooltipProvider, toast } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

async function setup(sessions = [{ ...fixtureSessions[0]!, title: 'Original title' }], locale: 'en' | 'zh' = 'en') {
  await page.viewport(1000, 800)
  const fixture = createFixtureChat({ sessions })
  await fixture.chat.getState().load()
  await render(
    <I18nProvider locale={locale}>
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 280 }}>
            <SidebarLists
              search={null}
              onAddWorkspace={() => {}}
              onNewSession={() => {}}
              onSelect={() => {
                throw new Error('Unexpected selection')
              }}
            />
          </div>
          <Toaster containerAriaLabel="Notifications" />
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  return fixture
}

it('more replaces details with the row menu2px right and top aligned; rename selects the title and Enter saves', async () => {
  await setup()
  const row = page.getByRole('button', { name: 'Original title', exact: true })
  await userEvent.hover(row)
  await expect.element(page.getByRole('region', { name: 'Conversation details' })).toBeVisible()
  await userEvent.click(page.getByRole('button', { name: 'More conversation actions' }))
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  await expect.element(menu).toBeVisible()
  await expect.element(page.getByRole('region', { name: 'Conversation details' })).not.toBeInTheDocument()
  const rect = row.element().getBoundingClientRect()
  await expect.poll(() => menu.element().getBoundingClientRect().left - rect.right).toBe(2)
  expect(menu.element().getBoundingClientRect().top).toBe(rect.top)
  expect([...menu.element().querySelectorAll('[role=menuitem]')].map((item) => item.textContent)).toEqual(['Rename', 'Pin conversation', 'Delete conversation'])
  await userEvent.click(page.getByRole('menuitem', { name: 'Rename', exact: true }))
  const input = page.getByRole('textbox', { name: 'Conversation title' })
  await expect.element(input).toHaveFocus()
  expect((input.element() as HTMLInputElement).selectionStart).toBe(0)
  expect((input.element() as HTMLInputElement).selectionEnd).toBe('Original title'.length)
  await userEvent.fill(input, '  Renamed title  ')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Renamed title', exact: true })).toBeVisible()
  await userEvent.hover(page.getByRole('button', { name: 'Renamed title', exact: true }))
  await expect.element(page.getByRole('region', { name: 'Conversation details' }).getByText('Renamed title', { exact: true })).toBeVisible()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
})

it.each(['light', 'dark'])('%s menus retain centered14px icon slots and identical text starts', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await setup([{ ...fixtureSessions[0]!, title: 'Original title', pinnedAt: 10 }])
    await userEvent.hover(page.getByRole('button', { name: 'Original title', exact: true }))
    await userEvent.click(page.getByRole('button', { name: 'More conversation actions' }))
    const menu = page.getByRole('menu', { name: 'Conversation actions' })
    await expect.element(page.getByRole('menuitem', { name: 'Unpin conversation', exact: true })).toBeVisible()
    const slots = [...menu.element().querySelectorAll<HTMLElement>('[data-session-menu-icon]')]
    expect(slots).toHaveLength(3)
    await expect.poll(() => slots[0]!.getBoundingClientRect().width).toBe(14)
    const boxes = slots.map((slot) => slot.getBoundingClientRect())
    expect(boxes[0]!.width).toBe(14)
    expect(boxes[1]!.width).toBe(14)
    expect(boxes[0]!.left).toBe(boxes[1]!.left)
    for (const slot of slots) {
      const svg = slot.querySelector('svg')!
      const icon = svg.getBoundingClientRect()
      const box = slot.getBoundingClientRect()
      expect(icon.left + icon.width / 2).toBeCloseTo(box.left + box.width / 2)
      expect(icon.top + icon.height / 2).toBeCloseTo(box.top + box.height / 2)
      expect(getComputedStyle(svg).width).toBe('14px')
    }
    expect(getComputedStyle(slots[1]!.querySelector('svg')!).rotate).toBe('45deg')
    const items = [...menu.element().querySelectorAll<HTMLElement>('[role=menuitem]')]
    const textStart = (item: HTMLElement) => {
      const range = document.createRange()
      range.selectNodeContents(item.lastChild!)
      return range.getBoundingClientRect().left
    }
    expect(textStart(items[0]!)).toBe(textStart(items[1]!))
    await page.screenshot({ path: `../../../../../../.vitest/cw08-menu-${theme}.png` })
    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
  } finally {
    document.documentElement.className = original
  }
})

it.each(['standalone', 'project', 'pinned'])('%s right clicks follow the pointer, suppress native menus and never select or pin', async (kind) => {
  const session = {
    ...fixtureSessions[0]!,
    title: 'Original title',
    projectId: kind === 'standalone' ? null : fixtureSessions[0]!.projectId,
    pinnedAt: kind === 'pinned' ? 20 : null,
  }
  const fixture = await setup([session])
  const row = page.getByRole('button', { name: 'Original title', exact: true })
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  for (const offset of [24, 132]) {
    const box = row.element().getBoundingClientRect()
    // Dispatch the browser context event to observe preventDefault as well as viewport geometry.
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + offset, clientY: box.top + 15, button: 2 })
    expect(row.element().dispatchEvent(event)).toBe(false)
    await expect.element(menu).toBeVisible()
    await expect.poll(() => menu.element().getBoundingClientRect().left).toBe(box.left + offset)
    expect(menu.element().getBoundingClientRect().top).toBe(box.top + 15)
    await expect.element(page.getByRole('region', { name: 'Conversation details' })).not.toBeInTheDocument()
    expect(fixture.chat.lists.getState().sessions[0]!.pinnedAt).toBe(session.pinnedAt)
    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
  }
})

it('pointer menus remain fully usable near the viewport edge and dismiss on outside click', async () => {
  await setup()
  await page.viewport(390, 300)
  const row = page.getByRole('button', { name: 'Original title', exact: true })
  // Position the source row at the lower right to produce a real edge interaction.
  const container = row.element().closest('nav')!.parentElement!
  container.style.position = 'fixed'
  container.style.right = '0'
  container.style.bottom = '0'
  const box = row.element().getBoundingClientRect()
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.right - 5, clientY: box.bottom - 5, button: 2 })
  row.element().dispatchEvent(event)
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  await expect.element(menu).toBeVisible()
  // A resize notification queued before the context click can arrive after opening.
  window.dispatchEvent(new Event('resize'))
  await expect.poll(() => menu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(8)
  await expect.poll(() => menu.element().getBoundingClientRect().right).toBeLessThanOrEqual(382)
  await expect.poll(() => menu.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(292)
  const rect = menu.element().getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(8)
  expect(rect.right).toBeLessThanOrEqual(382)
  expect(rect.top).toBeGreaterThanOrEqual(8)
  expect(rect.bottom).toBeLessThanOrEqual(292)
  await userEvent.click(document.body, { position: { x: 10, y: 10 } })
  await expect.element(menu).not.toBeInTheDocument()
})

it.each(['pointer', 'more'])('%s menus ignore late resize notifications, retain keyboard navigation and close on a new viewport size', async (anchor) => {
  await setup()
  const row = page.getByRole('button', { name: 'Original title', exact: true })
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  const open = async () => {
    if (anchor === 'pointer') {
      const box = row.element().getBoundingClientRect()
      row.element().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 24, clientY: box.top + 15, button: 2 }))
    } else {
      await userEvent.hover(row)
      await userEvent.click(page.getByRole('button', { name: 'More conversation actions' }))
    }
    await expect.element(menu).toBeVisible()
  }
  await open()
  window.dispatchEvent(new Event('resize'))
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()
  await open()
  await page.viewport(960, 740)
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()
})

async function rename() {
  await userEvent.hover(page.getByRole('button', { name: 'Original title', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'More conversation actions' }))
  await userEvent.click(page.getByRole('menuitem', { name: 'Rename', exact: true }))
  return page.getByRole('textbox', { name: 'Conversation title' })
}

it('blur saves, Escape cancels, blank titles restore the original and the input enforces200characters', async () => {
  const fixture = await setup()
  const input = await rename()
  expect((input.element() as HTMLInputElement).maxLength).toBe(200)
  await userEvent.fill(input, 'x'.repeat(201))
  await expect.element(input).toHaveValue('x'.repeat(200))
  await userEvent.fill(input, 'Cancelled title')
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('button', { name: 'Original title', exact: true })).toBeVisible()
  expect(fixture.chat.lists.getState().sessions[0]!.title).toBe('Original title')
  await rename()
  await userEvent.fill(input, '   ')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Original title', exact: true })).toBeVisible()
  expect(fixture.chat.lists.getState().sessions[0]!.title).toBe('Original title')
  await rename()
  await userEvent.fill(input, '  Saved on blur  ')
  await userEvent.click(page.getByRole('heading', { name: 'Projects', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Saved on blur', exact: true })).toBeVisible()
})

it('composition Enter keeps editing and pending saves cannot be submitted twice', async () => {
  const fixture = await setup()
  const originalRename = fixture.api.renameSession
  let resolve!: () => void
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  let requests = 0
  fixture.api.renameSession = async (id, title) => {
    requests++
    await ready
    return originalRename(id, title)
  }
  const input = await rename()
  await userEvent.fill(input, 'Composed title')
  input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  await expect.element(input).toHaveFocus()
  expect(requests).toBe(0)
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveAttribute('aria-busy', 'true')
  await userEvent.keyboard('{Enter}')
  await userEvent.click(page.getByRole('heading', { name: 'Projects', exact: true }))
  expect(requests).toBe(1)
  resolve()
  await expect.element(page.getByRole('button', { name: 'Composed title', exact: true })).toBeVisible()
})

it('failed saves retain the input and focus, show a Toast and allow retry', async () => {
  const fixture = await setup()
  const renameSession = fixture.api.renameSession
  fixture.api.renameSession = async () => {
    throw new Error('network failed')
  }
  const input = await rename()
  await userEvent.fill(input, 'Retry title')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Could not rename conversation. Try again.', { exact: true })).toBeVisible()
  await expect.element(input).toHaveValue('Retry title')
  await expect.element(input).toHaveFocus()
  expect(fixture.chat.lists.getState().sessions[0]!.title).toBe('Original title')
  fixture.api.renameSession = renameSession
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Retry title', exact: true })).toBeVisible()
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
})

it.each(['cancel', 'close', 'escape'])('delete confirmation protects %s and restores its row context', async (action) => {
  const fixture = await setup()
  await userEvent.hover(page.getByRole('button', { name: 'Original title', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'More conversation actions' }))
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete conversation', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus()
  await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(480)
  expect(dialog.element().getBoundingClientRect().height).toBe(184)
  expect(getComputedStyle(dialog.element()).borderRadius).toBe('28px')
  await expect.element(dialog.getByText('This will permanently delete this conversation and its subagent conversations. This cannot be undone.')).toBeVisible()
  if (action === 'escape') await userEvent.keyboard('{Escape}')
  else await userEvent.click(dialog.getByRole('button', { name: action === 'cancel' ? 'Cancel' : 'Close', exact: true }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Original title', exact: true })).toHaveFocus()
  expect(fixture.chat.lists.getState().sessions).toHaveLength(1)
})

it('pending delete stays bound to the selected identity, busy failure retains data and retry removes every list occurrence and returns to a draft', async () => {
  const target = { ...fixtureSessions[0]!, title: 'Original title', pinnedAt: 10 }
  const other = { ...fixtureSessions[0]!, id: 'other-session', title: 'Other title', pinnedAt: null }
  const fixture = await setup([target, other])
  const apiDelete = fixture.api.deleteSession
  const calls: string[] = []
  let reject!: (error: unknown) => void
  fixture.api.deleteSession = async (id) => {
    calls.push(id)
    await new Promise((_resolve, fail) => {
      reject = fail
    })
    return { sessionIds: [id] }
  }
  const row = page.getByRole('button', { name: 'Original title', exact: true }).first()
  await userEvent.click(row, { button: 'right' })
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete conversation', exact: true }))
  const dialog = page.getByRole('alertdialog', { name: 'Delete conversation?' })
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true })
  await userEvent.click(confirm)
  await expect.element(confirm).toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  expect(calls).toEqual([target.id])
  await expect.element(dialog).toBeVisible()
  expect(fixture.chat.lists.getState().sessions).toHaveLength(2)
  reject(new ApiError('session-busy', 'busy', 409, { reasons: ['run', 'agent', 'job'], sessions: [{ id: target.id, title: target.title }] }))
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('Finish the ongoing work in Original title before deleting this conversation: Run, subagent, background job.')
  expect(fixture.chat.lists.getState().sessions).toHaveLength(2)
  fixture.api.deleteSession = apiDelete
  await userEvent.click(confirm)
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fixture.chat.lists.getState().sessions.map((session) => session.id)).toEqual([other.id])
  expect(fixture.chat.getState().activeSessionId).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Original title', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Other title', exact: true })).toBeVisible()
})

it.each(['light', 'dark'])('%s Chinese delete confirmation matches desktop geometry and remains usable at390px', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await setup(undefined, 'zh')
    await userEvent.hover(page.getByRole('button', { name: 'Original title', exact: true }))
    await userEvent.click(page.getByRole('button', { name: '查看更多' }))
    await userEvent.click(page.getByRole('menuitem', { name: '删除对话', exact: true }))
    const dialog = page.getByRole('alertdialog', { name: '要删除对话吗？' })
    await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(480)
    expect(dialog.element().getBoundingClientRect().height).toBe(184)
    expect(getComputedStyle(dialog.element()).padding).toBe('24px')
    const title = dialog.getByRole('heading', { name: '要删除对话吗？' })
    expect(getComputedStyle(title.element()).fontSize).toBe('20px')
    expect(getComputedStyle(title.element()).lineHeight).toBe('28px')
    await expect.element(dialog.getByRole('button', { name: '取消', exact: true })).toHaveFocus()
    await expect.element(dialog.getByText('此操作将永久删除该对话及其子智能体对话，且无法撤销。')).toBeVisible()
    const confirm = dialog.getByRole('button', { name: '删除', exact: true })
    expect(confirm.element().getBoundingClientRect().height).toBe(36)
    expect(getComputedStyle(confirm.element()).borderRadius).toBe('12px')
    await page.screenshot({ path: `../../../../../../.vitest/cw09-delete-zh-${theme}.png` })
    await page.viewport(390, 400)
    await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(358)
    expect(dialog.element().getBoundingClientRect().left).toBe(16)
    expect(dialog.element().getBoundingClientRect().right).toBe(374)
    await expect.element(confirm).toBeVisible()
    await page.screenshot({ path: `../../../../../../.vitest/cw09-delete-zh-${theme}-390.png` })
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  } finally {
    document.documentElement.className = original
  }
})

it.each(['light', 'dark'])('%s generated title updates the visible row and already-open details card', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    const fixture = await setup()
    await userEvent.hover(page.getByRole('button', { name: 'Original title', exact: true }))
    const details = page.getByRole('region', { name: 'Conversation details' })
    await expect.element(details.getByText('Original title', { exact: true })).toBeVisible()
    fixture.sendServer({ type: 'session_title', sessionId: fixtureSessions[0]!.id, title: 'Generated intent' })
    await expect.element(page.getByRole('button', { name: 'Generated intent', exact: true })).toBeVisible()
    await expect.element(details.getByText('Generated intent', { exact: true })).toBeVisible()
    await expect.element(details.getByText('Original title', { exact: true })).not.toBeInTheDocument()
    await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  } finally {
    document.documentElement.className = original
  }
})

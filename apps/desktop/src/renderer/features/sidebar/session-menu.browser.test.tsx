import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Toaster, TooltipProvider, toast } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { SidebarLists } from './sidebar-lists.tsx'

async function setup(sessions = [{ ...fixtureSessions[0]!, title: 'Original title' }]) {
  await page.viewport(1000, 800)
  const fixture = createFixtureChat({ sessions })
  await fixture.chat.getState().load()
  await render(
    <I18nProvider locale="en">
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
  expect([...menu.element().querySelectorAll('[role=menuitem]')].map((item) => item.textContent)).toEqual(['Rename', 'Pin conversation'])
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
    expect(slots).toHaveLength(2)
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
  await expect.poll(() => menu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(8)
  await expect.poll(() => menu.element().getBoundingClientRect().right).toBeLessThanOrEqual(382)
  const rect = menu.element().getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(8)
  expect(rect.right).toBeLessThanOrEqual(382)
  expect(rect.top).toBeGreaterThanOrEqual(8)
  expect(rect.bottom).toBeLessThanOrEqual(292)
  await userEvent.click(document.body, { position: { x: 10, y: 10 } })
  await expect.element(menu).not.toBeInTheDocument()
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

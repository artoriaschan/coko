// 标题栏操作在窄主区的呈现（docs/tech-stack/ui.md 的"先重排，再截断"）：提供菜单呈现的操作在主列窄于 560 px 时收进"更多操作"菜单，
// 其余留在标题栏；没有可收起的操作实际渲染时不显示"更多操作"。交接经菜单打开的对话框只属于发出请求的会话。
import '../../styles.css'
import { DropdownMenuItem, TooltipProvider } from '@coko/ui'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createHandoffStore } from '../../stores/handoff-store.ts'
import { createWorktreesStore } from '../../stores/worktrees-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { HeaderActions } from './conversation-pane.tsx'
import { HandoffButton, HandoffMenuItem, HandoffStoresProvider } from './handoff-dialog.tsx'
import type { HeaderActionDefinition, HeaderActionProps } from './header-actions.ts'

const selected: string[] = []
const Status = () => <button type="button">Status</button>
const Inline = () => <button type="button">Agents inline</button>
const Item = ({ sessionId }: HeaderActionProps) => <DropdownMenuItem onSelect={() => selected.push(sessionId)}>Agents item</DropdownMenuItem>
const Nothing = () => null

const actions = (collapsible: React.ComponentType<HeaderActionProps>): HeaderActionDefinition[] => [
  { id: 'jobs', Component: Status, available: true },
  { id: 'agents', Component: collapsible, MenuItem: Item, available: true },
]

function Frame({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <I18nProvider locale="en">
      <TooltipProvider>
        <div className="@container/main" style={{ width }}>
          <header className="flex">{children}</header>
        </div>
      </TooltipProvider>
    </I18nProvider>
  )
}

/** 标题栏中名为 name 的按钮是否渲染（display: none 时没有布局框）。 */
const shown = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('header button')].some(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name && b.getClientRects().length > 0,
  )

describe('标题栏操作的窄主区呈现', () => {
  it('不窄于 560 px：全部留在标题栏，不显示"更多操作"', async () => {
    const screen = await render(
      <Frame width={600}>
        <HeaderActions actions={actions(Inline)} sessionId="s-1" openTab={() => {}} />
      </Frame>,
    )
    await expect.poll(() => shown('Agents inline')).toBe(true)
    expect(shown('Status')).toBe(true)
    expect(shown('More actions')).toBe(false)
    await screen.unmount()
  })

  it('窄于 560 px：可收起的操作进"更多操作"菜单，状态类操作留在标题栏；菜单项收到会话', async () => {
    selected.length = 0
    const screen = await render(
      <Frame width={400}>
        <HeaderActions actions={actions(Inline)} sessionId="s-1" openTab={() => {}} />
      </Frame>,
    )
    await expect.poll(() => shown('More actions')).toBe(true)
    expect(shown('Agents inline')).toBe(false)
    expect(shown('Status')).toBe(true)
    await userEvent.click(page.getByRole('button', { name: 'More actions' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'Agents item' }))
    await expect.poll(() => selected).toEqual(['s-1'])
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
    await screen.unmount()
  })

  it('窄于 560 px 但可收起的操作不渲染（例如子 Session 没有交接）：不显示空的"更多操作"', async () => {
    const screen = await render(
      <Frame width={400}>
        <HeaderActions actions={actions(Nothing)} sessionId="s-1" openTab={() => {}} />
      </Frame>,
    )
    await expect.poll(() => shown('Status')).toBe(true)
    expect(shown('More actions')).toBe(false)
    await screen.unmount()
  })

  it('交接：经菜单打开过对话框后切换会话，新会话的对话框不会自行打开', async () => {
    const fixture = createFixtureChat()
    await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
    const handoff = createHandoffStore({
      backend: { start: async () => ({ runId: 'h1' }), gitStatus: async () => ({ repo: false, dirtyFiles: 0 }), stop: async () => {} },
      writeDraft: () => {},
    })
    const worktrees = createWorktreesStore({
      list: async () => [],
      create: async () => ({}) as never,
      createSession: async () => ({}) as never,
      remove: async () => {},
    })
    const handoffActions: HeaderActionDefinition[] = [{ id: 'handoff', Component: HandoffButton, MenuItem: HandoffMenuItem, available: true }]
    const Pane = ({ sessionId }: { sessionId: string }) => (
      <ChatStoreProvider store={fixture.chat}>
        <HandoffStoresProvider handoff={handoff} worktrees={worktrees}>
          <Frame width={400}>
            <HeaderActions actions={handoffActions} sessionId={sessionId} openTab={() => {}} />
          </Frame>
        </HandoffStoresProvider>
      </ChatStoreProvider>
    )
    const screen = await render(<Pane sessionId="s-1" />)
    const dialog = page.getByRole('dialog', { name: 'Hand off to a new session' })
    await userEvent.click(page.getByRole('button', { name: 'More actions' }))
    await userEvent.click(page.getByRole('menuitem', { name: 'Hand off' }))
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()

    await screen.rerender(<Pane sessionId="s-3" />)
    await expect.element(page.getByRole('button', { name: 'More actions' })).toBeVisible()
    // 等一个渲染周期后再判定：打开请求经 effect 生效。
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(document.querySelector('[data-slot="handoff-dialog"]')).toBeNull()
    await screen.unmount()
  })
})

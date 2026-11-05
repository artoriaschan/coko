// M4 的界面容器：dock、标题栏操作与右栏 tabs 的注册表。未交付（available: false）的占位不挂载、不占位；交付后按注册表顺序显示。
import '../../../styles.css'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../../app/app.tsx'
import { createAppearanceStore } from '../../../app/appearance-store.ts'
import { ChatStoreProvider } from '../../../app/chat.tsx'
import { createConnectionStore } from '../../../app/connection-store.ts'
import { I18nProvider } from '../../../app/i18n.tsx'
import { createPreferences } from '../../../app/preferences.ts'
import { createSettingsPageStore } from '../../../app/settings-page-store.ts'
import { createFixtureChat } from '../../../testing/fixture-chat.ts'
import { HEADER_ACTIONS } from '../header-actions.ts'
import { RightPanel } from '../../right-panel/right-panel.tsx'
import { openPage } from '../../right-panel/layout-store.ts'
import { RIGHT_PANEL_TABS } from '../../right-panel/tabs.ts'
import { Dock } from './dock.tsx'
import { DOCK_SLOTS } from './dock-slots.ts'

it('注册表：dock 三张卡、标题栏全部操作、右栏全部 tab 均已交付', () => {
  expect(DOCK_SLOTS.map((s) => [s.id, s.available])).toEqual([
    ['todo', true],
    ['goal', true],
    ['queue', true],
  ])
  expect(HEADER_ACTIONS.map((a) => [a.id, a.available])).toEqual([
    ['jobs', true],
    ['agents', true],
    ['schedules', true],
    ['team', true],
  ])
  expect(RIGHT_PANEL_TABS.map((t) => [t.id, t.available])).toEqual([
    ['plan', true],
    ['jobs', true],
    ['agents', true],
    ['schedules', true],
    ['team', true],
    ['trace', true],
  ])
})

it('应用中：会话打开后 dock 没有内容时不占位；没有后台任务时不显示"后台任务"按钮，没有 Plan chip（不在 plan 模式）；右栏按需打开页面，开始页列出全部六个入口', async () => {
  const { chat, settings } = createFixtureChat()
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
  await expect.element(page.getByRole('textbox')).toBeVisible()
  // 待办卡与队列卡已交付，但 s-1 没有待办与追加指令：容器为空，empty:hidden 不占位。
  expect(getComputedStyle(document.querySelector('[data-slot="dock"]')!).display).toBe('none')
  expect(document.querySelector('[data-action="open-jobs"]')).toBeNull()
  await userEvent.click(page.getByRole('button', { name: 'Open sidebar' }))
  expect(document.querySelector('[data-slot="plan-chip"]')).toBeNull()
  await expect.element(page.getByRole('tab', { name: 'Start' })).toHaveAttribute('aria-selected', 'true')
  expect([...screen.container.querySelectorAll('[data-slot="app-frame-right"] [role="tab"]')].map((e) => e.getAttribute('data-tab'))).toEqual(['start'])
  for (const name of ['Plan', 'Tasks', 'Agents', 'Schedules', 'Team', 'Trace'])
    await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
})

function renderWithProviders(node: React.ReactNode) {
  const { chat } = createFixtureChat()
  return render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={chat}>
        <TooltipProvider>{node}</TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

it('dock：只挂载已交付的卡片，按 Todo → Goal → Queue；卡片都没有内容时容器不占位', async () => {
  const Card = (id: string) => () => <section data-card={id}>{id}</section>
  const Empty = () => null
  const slots = DOCK_SLOTS.map((s) => (s.id === 'queue' ? s : { ...s, available: true, Component: Card(s.id) }))
  const screen = await renderWithProviders(<Dock sessionId="s-1" slots={slots} />)
  await expect.element(page.getByText('todo')).toBeVisible()
  expect([...screen.container.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card'))).toEqual(['todo', 'goal'])

  await screen.rerender(
    <I18nProvider locale="en">
      <ChatStoreProvider store={createFixtureChat().chat}>
        <Dock sessionId="s-1" slots={DOCK_SLOTS.map((s) => ({ ...s, available: true, Component: Empty }))} />
      </ChatStoreProvider>
    </I18nProvider>,
  )
  const dock = screen.container.querySelector<HTMLElement>('[data-slot="dock"]')!
  expect(dock.getBoundingClientRect().height).toBe(0)
  expect(getComputedStyle(dock).display).toBe('none')
})

it('右栏：开始页只列出已交付页面，选择后原位替换引导页', async () => {
  const Panel = (id: string) => () => <p>{`panel-${id}`}</p>
  const tabs = RIGHT_PANEL_TABS.map((t) => ({ ...t, available: true, Component: Panel(t.id) }))
  openPage('s-1', 'start')
  await renderWithProviders(<RightPanel onClose={() => {}} tabs={tabs} />)
  await userEvent.click(page.getByRole('button', { name: 'Tasks', exact: true }))
  await expect.element(page.getByText('panel-jobs')).toBeVisible()
  await expect.element(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
})

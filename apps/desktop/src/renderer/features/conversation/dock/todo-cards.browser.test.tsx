// dock 的待办卡与队列卡：在应用中（内存协议后端）由 todo_list 条目与本窗口未送达的追加指令驱动。
import '../../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../../app/app.tsx'
import { createAppearanceStore } from '../../../app/appearance-store.ts'
import { createConnectionStore } from '../../../app/connection-store.ts'
import { createPreferences } from '../../../app/preferences.ts'
import { createSettingsPageStore } from '../../../app/settings-page-store.ts'
import { createFixtureChat } from '../../../testing/fixture-chat.ts'
import { DOCK_SLOTS } from './dock-slots.ts'

let seq = 1000
const record = (kind: string, payload: unknown): SessionEntryRecord =>
  ({
    sessionId: 's-1',
    seq: ++seq,
    kind,
    payloadVersion: 1,
    payload,
    runId: null,
    createdAt: seq,
  }) as SessionEntryRecord

const items = [
  { id: 't1', content: 'read the spec', status: 'completed', result: 'spec has three parts' },
  { id: 't2', content: 'write the tests', status: 'in_progress' },
  { id: 't3', content: 'implement the card', status: 'pending', blockedBy: ['t2'] },
]

async function open(extra: SessionEntryRecord[] = []) {
  const fixture = createFixtureChat()
  const base = fixture.chat
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={base}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.poll(() => base.getState().conversations['s-1']?.status).toBe('ready')
  for (const entry of extra) fixture.sendServer({ type: 'entry', sessionId: 's-1', entry })
  return fixture
}

const cards = () => [...document.querySelectorAll('[data-slot="dock"] > section')].map((e) => e.getAttribute('data-slot'))

it('注册表：三张卡均已交付；顺序 Todo → Goal → Queue', () => {
  expect(DOCK_SLOTS.map((s) => [s.id, s.available])).toEqual([
    ['todo', true],
    ['goal', true],
    ['queue', true],
  ])
})

it('待办卡：c/n 与当前项；展开后等待提示与可展开的 result；全部完成后一行，下一个 Run 开始后隐藏', async () => {
  const fixture = await open([record('todo_list', { items })])
  const card = page.getByRole('region', { name: 'To-dos' })
  await expect.element(card.getByText('To-dos 1/3')).toBeVisible()
  await expect.element(card.getByText('write the tests')).toBeVisible()
  expect(document.querySelector('[data-todo-list]')).toBeNull()

  await userEvent.click(page.getByRole('button', { name: 'Expand or collapse to-dos' }))
  await expect.element(page.getByRole('button', { name: 'Expand or collapse to-dos' })).toHaveAttribute('aria-expanded', 'true')
  await expect.element(card.getByText('Waiting for t2')).toBeVisible()
  expect(document.querySelectorAll('[data-todo-waiting]')).toHaveLength(1)
  const result = document.querySelector<HTMLElement>('[data-todo-item="t1"] [data-todo-result]')!
  expect(result.checkVisibility()).toBe(false)
  await userEvent.click(card.getByText('read the spec'))
  await expect.poll(() => result.checkVisibility()).toBe(true)
  expect(result.textContent).toBe('spec has three parts')

  // 前置项完成后不再提示等待。
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: record('todo_list', { items: [items[0], { ...items[1], status: 'completed' }, { ...items[2], status: 'in_progress' }] }),
  })
  await expect.element(card.getByText('To-dos 2/3')).toBeVisible()
  await expect.poll(() => document.querySelectorAll('[data-todo-waiting]').length).toBe(0)

  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('todo_list', { items: items.map((i) => ({ ...i, status: 'completed' })) }) })
  await expect.element(card.getByText('All done')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Expand or collapse to-dos' })).toBeDisabled()
  expect(document.querySelector('[data-todo-list]')).toBeNull()

  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('run_start', { trigger: 'submit' }) })
  await expect.poll(() => document.querySelector('[data-slot="todo-card"]')).toBeNull()
})

it('队列卡：未送达的追加指令单行显示、悬停看全文；送达后消失；排在待办卡之后', async () => {
  const fixture = await open([record('todo_list', { items }), record('run_start', { trigger: 'submit' })])
  expect(document.querySelector('[data-slot="queue-card"]')).toBeNull()
  const long = 'also check the README and every package manifest '.repeat(6).trim()
  void fixture.chat.getState().steer(long)
  const queued = page.getByRole('region', { name: 'Delivered after the current step' })
  await expect.element(queued.getByText('Queued 1')).toBeVisible()
  await expect.poll(cards).toEqual(['todo-card', 'queue-card'])
  const row = document.querySelector<HTMLElement>('[data-queued] button')!
  expect(row.scrollWidth).toBeGreaterThan(row.clientWidth)

  await userEvent.hover(row)
  await expect.poll(() => document.querySelector('[data-slot="hover-card-content"]')?.textContent).toBe(long)

  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: record('message', { role: 'user', content: [{ type: 'text', text: long }], timestamp: 1 }),
  })
  await expect.poll(() => document.querySelector('[data-slot="queue-card"]')).toBeNull()
})

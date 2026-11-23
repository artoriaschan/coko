// 应用内的 Session Reference：@ 菜单的会话候选取自界面已持有的会话列表（当前会话所属的 Project，新对话按草稿所选的 Project），
// 选中后提交的文本是 @session:<id>；带 chip 的草稿在切换会话与重新挂载后恢复，缺少标题的节点按损坏的草稿丢弃。
import '../../styles.css'
import type { Session } from '@coko/protocol'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

async function mount(sessions: Session[] = fixtureSessions) {
  const fixture = createFixtureChat({ sessions })
  const store = createAppearanceStore({ locale: 'zh', theme: 'light' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = await render(
    <div style={{ width: 1200, height: 900 }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
  return { fixture, screen }
}

const editor = () => page.getByRole('textbox', { name: '向 Coko 布置任务' })
const menu = () => document.querySelector<HTMLElement>('[role="listbox"][aria-label="文件与会话"]:not([aria-hidden="true"])')
/** 打开的菜单中各组的标题与条目的主文本（会话为标题，不含时间）。 */
const groups = () =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role="group"]') ?? [])].map((group) => ({
    heading: document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent,
    titles: [...group.querySelectorAll<HTMLElement>('[role="option"] span span span:first-child')].map((title) => title.textContent),
  }))
const chips = () =>
  [...(editor().element() as HTMLElement).querySelectorAll<HTMLElement>('[data-session-reference]')].map((chip) => [
    chip.dataset.sessionReference,
    chip.textContent,
  ])

it('会话内：候选只有同一 Project 的其他未归档会话；选中后提交的文本是 @session:<id>', async () => {
  const { fixture, screen } = await mount()
  const submit = vi.spyOn(fixture.api, 'submitMessage')
  fixture.chat.lists.getState().setArchiveState({ ...fixtureSessions[2]!, archivedAt: 5 })
  fixture.chat.getState().openSession('s-1')
  await editor().click()
  await userEvent.keyboard('@')
  // s-1 是当前会话，s-3 已归档，s-8 / s-9 属于另一个 Project。
  await expect
    .poll(groups)
    .toEqual([{ heading: '会话', titles: ['Sidecar startup handshake', 'ripgrep contract tests', '未命名', '工具卡 diff 展示', 'Forge packaging smoke'] }])
  await userEvent.keyboard('rip')
  await expect.poll(groups).toEqual([{ heading: '会话', titles: ['ripgrep contract tests'] }])
  await userEvent.keyboard('{Enter}')
  await expect.poll(chips).toEqual([['s-4', '@ripgrep contract tests']])
  await userEvent.keyboard('的结论继续')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => submit.mock.calls.map(([id, text]) => [id, text])).toEqual([['s-1', '@session:s-4 的结论继续']])
  await screen.unmount()
})

it('新对话草稿：按草稿所选的 Project 列出会话；没有选 Project 时列出独立对话', async () => {
  const solo: Session = { ...fixtureSessions[0]!, id: 's-solo', projectId: null, title: '独立的讨论', updatedAt: 95 }
  const { fixture, screen } = await mount([...fixtureSessions, solo])
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(editor()).toHaveFocus()
  await userEvent.keyboard('@')
  await expect.poll(groups).toEqual([{ heading: '会话', titles: ['独立的讨论'] }])
  await userEvent.keyboard('{Backspace}')
  await expect.poll(menu).toBeNull()

  fixture.chat.newChat.getState().selectProject('project-w-pi')
  await userEvent.keyboard('@')
  await expect.poll(groups).toEqual([{ heading: '会话', titles: ['Read agent-core event flow', '对比 coding-agent 截断策略'] }])
  await userEvent.keyboard('{Escape}')
  await screen.unmount()
})

it('带 chip 的草稿在切换会话与重新挂载后恢复，标题保持选中时的快照；缺少标题的节点使草稿被丢弃', async () => {
  const first = await mount()
  first.fixture.chat.getState().openSession('s-1')
  await editor().click()
  await userEvent.keyboard('参考 @rip')
  await expect.poll(groups).toEqual([{ heading: '会话', titles: ['ripgrep contract tests'] }])
  await userEvent.keyboard('{Enter}')
  await expect.poll(chips).toEqual([['s-4', '@ripgrep contract tests']])

  first.fixture.chat.getState().openSession('s-3')
  await expect.poll(chips).toEqual([])
  await expect.element(editor()).toHaveTextContent('')
  first.fixture.chat.getState().openSession('s-1')
  await expect.poll(chips).toEqual([['s-4', '@ripgrep contract tests']])
  await expect.element(editor()).toHaveTextContent('参考 @ripgrep contract tests')
  await first.screen.unmount()

  const saved = localStorage.getItem('coko.draft.s-1')!
  expect(saved).toContain('"type":"session-reference"')
  expect(saved).toContain('"id":"s-4"')

  // 重新挂载（重启）：被引用的会话已改名，chip 仍显示选中时的标题。
  const renamed = fixtureSessions.map((session) => (session.id === 's-4' ? { ...session, title: 'renamed later' } : session))
  const second = await mount(renamed)
  second.fixture.chat.getState().openSession('s-1')
  await expect.poll(chips).toEqual([['s-4', '@ripgrep contract tests']])
  await second.screen.unmount()

  localStorage.setItem('coko.draft.s-1', saved.replace('"title":"ripgrep contract tests"', '"title":""'))
  const third = await mount()
  third.fixture.chat.getState().openSession('s-1')
  await expect.poll(() => localStorage.getItem('coko.draft.s-1')).toBeNull()
  expect(chips()).toEqual([])
  await expect.element(editor()).toHaveTextContent('')
  await third.screen.unmount()
})

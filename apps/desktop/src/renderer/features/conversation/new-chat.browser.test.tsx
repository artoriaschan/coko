import '../../styles.css'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

it('新对话显示品牌欢迎页，所有入口保留同份文字草稿，输入区聚焦且不显示上下文环', async () => {
  const fixture = createFixtureChat()
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
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(page.getByText('今天我们来做些什么？')).toBeVisible()
  await expect.element(page.getByText('从一个想法开始，一起完成工作')).toBeVisible()
  const editor = page.getByRole('textbox', { name: '向 Coko 布置任务' })
  await expect.element(editor).toHaveFocus()
  await userEvent.type(editor, '保留这份草稿')
  fixture.chat.getState().openSession('s-1')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(editor).toHaveTextContent('保留这份草稿')
  await expect.element(page.getByRole('img', { name: 'Coko' })).toBeVisible()
  expect(document.querySelector('[data-context-ring]')).toBeNull()
  await screen.unmount()
})

it.each(['light', 'dark'] as const)('单份草稿在 %s 窄主区重新挂载后恢复，旧 Workspace 草稿清除，品牌与主要操作可达', async (theme) => {
  await page.viewport(446, 800)
  localStorage.setItem('coko.draft.workspace.obsolete', 'old draft')
  const mount = async () => {
    const fixture = createFixtureChat({ sessions: [] })
    const store = createAppearanceStore({ locale: 'zh', theme })
    const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
    const screen = await render(
      <div style={{ width: '100vw', height: '100vh' }}>
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
    await expect.poll(() => document.querySelector('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(390)
    return { fixture, screen }
  }
  const first = await mount()
  const editor = page.getByRole('textbox', { name: '向 Coko 布置任务' })
  await expect.element(editor).toBeEnabled()
  await userEvent.type(editor, '恢复文字与附件 @src/example.ts')
  await page.getByRole('button', { name: '权限模式：请求批准' }).click()
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).click()
  await first.screen.unmount()
  const second = await mount()
  await expect.element(editor).toHaveTextContent('恢复文字与附件 @src/example.ts')
  await expect.element(page.getByRole('button', { name: '权限模式：帮我批准' })).toBeVisible()
  expect(localStorage.getItem('coko.draft.workspace.obsolete')).toBeNull()
  const image = page.getByRole('img', { name: 'Coko' }).element() as HTMLImageElement
  await expect.poll(() => image.naturalWidth).toBeGreaterThan(0)
  const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
  expect(main.getBoundingClientRect().width).toBeGreaterThanOrEqual(390)
  expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth + 1)
  const welcome = document.querySelector<HTMLElement>('[data-slot="new-chat-welcome"]')!.getBoundingClientRect()
  const composer =
    document.querySelector<HTMLElement>('form[data-slot="composer"]')?.getBoundingClientRect() ?? document.querySelector('form')!.getBoundingClientRect()
  expect(welcome.bottom).toBeLessThanOrEqual(composer.top + 1)
  await page.screenshot({ element: main, path: `../../../../../../.vitest/cw11-${theme}.png` })
  await second.screen.unmount()
})

it.each(['light', 'dark'] as const)('%s：归属菜单在上方 6px，搜索区分同名项目；关闭不打开菜单且清除 Git 草稿', async (theme) => {
  await page.viewport(1200, 900)
  const fixture = createFixtureChat({ sessions: [] })
  await fixture.chat.getState().load()
  fixture.chat.lists.setState({
    projects: [
      {
        id: 'p-a',
        name: 'web',
        primaryWorkspaceId: 'w-coko',
        folders: [{ path: '/work/shop-web', primary: true }],
        pinnedAt: null,
        createdAt: 1,
        lastUsedAt: 1,
        sessionCount: 0,
      },
      {
        id: 'p-b',
        name: 'web',
        primaryWorkspaceId: 'w-pi',
        folders: [{ path: '/work/admin-web', primary: true }],
        pinnedAt: null,
        createdAt: 2,
        lastUsedAt: 2,
        sessionCount: 0,
      },
      {
        id: 'p-c',
        name: 'unique',
        primaryWorkspaceId: 'w-coko',
        folders: [{ path: '/work/hidden-folder', primary: true }],
        pinnedAt: null,
        createdAt: 3,
        lastUsedAt: 3,
        sessionCount: 0,
      },
    ],
  })
  const store = createAppearanceStore({ locale: 'zh', theme })
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
  const trigger = page.getByRole('button', { name: '选择对话归属：对话', exact: true })
  const anchor = trigger.element().getBoundingClientRect()
  await trigger.click()
  const menu = page.getByRole('menu', { name: '对话归属' })
  const bar = document.querySelector<HTMLElement>('[data-slot="destination-bar"]')!
  // 归属栏 36px 高、按钮在其中垂直居中：菜单与触发按钮保持 6px 间距。
  await expect.poll(() => Math.abs(anchor.top - menu.element().getBoundingClientRect().bottom - 6)).toBeLessThan(1)
  expect(Math.round(bar.getBoundingClientRect().height)).toBe(36)
  await expect.element(page.getByRole('menuitemradio', { name: '不在项目中工作', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.element(page.getByRole('menuitemradio', { name: 'web · shop-web', exact: true })).toBeVisible()
  await expect.element(page.getByRole('menuitemradio', { name: 'web · admin-web', exact: true })).toBeVisible()
  await expect.element(page.getByRole('menuitemradio', { name: 'unique', exact: true })).toBeVisible()
  await page.screenshot({ element: menu.element() as HTMLElement, path: `../../../../../../.vitest/cw12-menu-${theme}.png` })
  expect(menu.element().textContent).not.toContain('hidden-folder')
  const search = page.getByRole('textbox', { name: '搜索项目' })
  await expect.element(search).toHaveFocus()
  search.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await userEvent.keyboard('{ArrowDown}{Escape}')
  await expect.element(search).toHaveFocus()
  await expect.element(menu).toBeVisible()
  search.element().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await userEvent.type(search, 'unique')
  await expect.element(page.getByRole('menuitemradio', { name: 'web · shop-web', exact: true })).not.toBeInTheDocument()
  await userEvent.clear(search)
  await page.getByRole('menuitemradio', { name: 'web · shop-web', exact: true }).click()
  await expect.element(menu).not.toBeInTheDocument()
  const selected = page.getByRole('button', { name: '选择对话归属：web', exact: true })
  await expect.element(selected).toBeVisible()
  const label = document.querySelector<HTMLElement>('[data-destination-name]')!
  const before = label.getBoundingClientRect().left
  expect(selected.element().querySelectorAll('svg')[0]!.getBoundingClientRect().width).toBe(14)
  // 项目归属不显示展开箭头：只有文件夹/清除图标与设置图标。
  expect(selected.element().querySelectorAll('svg')).toHaveLength(1)
  expect(selected.element().getBoundingClientRect().height).toBe(28)
  expect(getComputedStyle(label).paddingBottom).toBe('2px')
  await userEvent.hover(selected)
  const close = page.getByRole('button', { name: '清除项目归属' })
  await expect.element(close).toBeVisible()
  await userEvent.hover(close)
  await expect.element(page.getByRole('tooltip', { name: '清除项目归属' })).toBeVisible()
  expect(label.getBoundingClientRect().left).toBe(before)
  await page.screenshot({ element: bar, path: `../../../../../../.vitest/cw12-hover-${theme}.png` })
  fixture.chat.newChat.getState().configure({ branch: 'feature', newWorktree: true })
  await close.click()
  await expect.element(trigger).toBeVisible()
  await expect.element(menu).not.toBeInTheDocument()
  expect(fixture.chat.newChat.getState()).toMatchObject({ projectId: null, branch: null, newWorktree: false })
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'unique', exact: true }).click()
  await page.getByRole('button', { name: '选择对话归属：unique' }).click()
  await expect.element(page.getByRole('menuitemradio', { name: 'unique', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: '不在项目中工作', exact: true }).click()
  await expect.element(trigger).toBeVisible()
  await page.screenshot({ element: document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!, path: `../../../../../../.vitest/cw12-${theme}.png` })
  await screen.unmount()
})

it('项目行新对话进入欢迎页并聚焦，保留项目展开状态；独立入口清除归属，已有会话不显示归属栏', async () => {
  const fixture = createFixtureChat()
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
  const project = page.getByRole('button', { name: 'coko', exact: true })
  await project.click()
  await expect.element(project).toHaveAttribute('aria-expanded', 'false')
  await userEvent.hover(project)
  await page.getByRole('button', { name: '在 coko 中新建会话' }).click()
  await expect.element(page.getByText('今天我们来做些什么？')).toBeVisible()
  await expect.element(page.getByRole('button', { name: '选择对话归属：coko' })).toBeVisible()
  await expect.element(page.getByRole('textbox', { name: '向 Coko 布置任务' })).toHaveFocus()
  await expect.element(project).toHaveAttribute('aria-expanded', 'false')
  fixture.chat.newChat.getState().configure({ branch: 'keep-branch', newWorktree: true })
  fixture.chat.getState().openSession('s-1')
  await expect.poll(() => document.querySelector('[data-slot="destination-bar"]')).toBeNull()
  await page.getByRole('button', { name: '后退', exact: true }).click()
  await expect.element(page.getByRole('button', { name: '选择对话归属：coko' })).toBeVisible()
  expect(fixture.chat.newChat.getState()).toMatchObject({ branch: 'keep-branch', newWorktree: true })
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(page.getByRole('button', { name: '选择对话归属：对话' })).toBeVisible()
  await screen.unmount()
})

it.each([
  {
    label: 'worktree',
    cwd: '/Users/me/coko/.coko-worktrees/wt-123456',
    projectId: 'project-w-coko',
    references: ['selected.ts'],
    source: '/Users/me/coko/README.md',
  },
  { label: 'primary', cwd: '/Users/me/coko', projectId: 'project-w-coko', references: ['README.md', 'selected.ts'], source: '@README.md' },
  { label: 'standalone', cwd: '/Users/me/standalone', projectId: null, references: ['selected.ts'], source: '/Users/me/coko/README.md' },
  { label: 'legacy Workspace fallback', cwd: undefined, projectId: null, references: ['README.md', 'selected.ts'], source: '@README.md' },
  {
    label: 'worktree draft before creation',
    cwd: undefined,
    projectId: 'project-w-coko',
    draft: true,
    references: ['README.md', 'selected.ts'],
    source: '@README.md',
  },
])('$label attachments use the correct directory at the App/composer boundary', async (config) => {
  const { cwd, projectId } = config
  const draft = 'draft' in config && config.draft === true
  await page.viewport(1200, 900)
  const session = { ...fixtureSessions[0]!, cwd, projectId }
  const fixture = createFixtureChat({ sessions: draft ? [] : [session] })
  const root = cwd ?? '/Users/me/coko'
  vi.stubGlobal('coko', { pickFiles: async () => ['/Users/me/coko/README.md', `${root}/selected.ts`, '/outside/notes.txt'] })
  try {
    const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
    const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
    const screen = await render(
      <div style={{ width: 1200, height: 900 }}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </div>,
    )
    if (draft) {
      fixture.chat.newChat.getState().selectProject('project-w-coko')
      fixture.chat.newChat.getState().configure({ newWorktree: true, branch: 'main' })
    } else await fixture.chat.getState().openSession(session.id)
    const editor = page.getByRole('textbox', { name: 'Give Coko a task' })
    await expect.element(editor).toBeVisible()
    await page.getByRole('button', { name: 'Add attachment' }).click()
    await expect.poll(() => editor.element().querySelector('[data-file-reference="selected.ts"]')).not.toBeNull()
    expect(editor.element().textContent).toContain('/outside/notes.txt')
    expect(editor.element().textContent).toContain(config.source)
    expect([...editor.element().querySelectorAll<HTMLElement>('[data-file-reference]')].map((node) => node.dataset.fileReference)).toEqual(config.references)
    await screen.unmount()
  } finally {
    vi.unstubAllGlobals()
  }
})

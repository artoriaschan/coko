// 设置分区注册表与菜单分组：未交付（available: false）的分区（外观、插件）不出现在导航中，也不能经 show / setSection 打开。
import '../../styles.css'
import type { Locale } from '@coko/i18n'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'
import { visibleHeaderActions } from '../conversation/header-actions.ts'
import { visibleRightPanelTabs } from '../right-panel/tabs.ts'
import { navigationGroups, resolveSection, SETTINGS_SECTIONS, visibleSections } from './sections.ts'

const ids = (groups: ReturnType<typeof navigationGroups>) => groups.map((g) => ({ group: g.id, sections: g.sections.map((s) => s.id) }))

it('菜单按个人、环境、插件、模型分组，关于不属于任何分类且在最后；未交付的外观、插件不出现', () => {
  expect(ids(navigationGroups())).toEqual([
    { group: 'personal', sections: ['general', 'memory'] },
    { group: 'environment', sections: ['permissions'] },
    { group: 'plugins', sections: ['skills', 'mcp', 'hooks'] },
    { group: 'models', sections: ['models'] },
    { group: null, sections: ['about'] },
  ])
})

it('分类内没有可显示的菜单项时不显示该分类', () => {
  const sections = SETTINGS_SECTIONS.map((s) => (s.id === 'permissions' ? { ...s, available: false } : s))
  expect(ids(navigationGroups(sections)).map((g) => g.group)).toEqual(['personal', 'plugins', 'models', null])
})

it('占位分区不显示，打开它时回到通用分区', () => {
  const sections = SETTINGS_SECTIONS.map((s) => (s.id === 'mcp' ? { ...s, available: false } : s))
  expect(visibleSections(sections).map((s) => s.id)).not.toContain('mcp')
  expect(resolveSection('mcp', sections).id).toBe('general')
})

function renderSettings(locale: Locale = 'en', theme: 'light' | 'dark' = 'light') {
  const store = createAppearanceStore({ theme, locale })
  const { chat, settings } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  return { screen, settingsPage }
}

/** 菜单的可见结构：每个分类的标题与菜单项文案；无分类的项标题为 null。 */
function menu(nav: Element) {
  return [...nav.querySelectorAll('[data-settings-group]')].map((group) => ({
    title: group.getAttribute('aria-labelledby') ? document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent : null,
    items: [...group.querySelectorAll('[data-section]')].map((el) => el.textContent),
  }))
}

afterEach(async () => {
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

it.each([
  [
    'zh',
    [
      { title: '个人', items: ['常规', '记忆'] },
      { title: '环境', items: ['权限'] },
      { title: '插件', items: ['技能', 'MCP', 'Hook'] },
      { title: '模型', items: ['模型服务'] },
      { title: null, items: ['关于'] },
    ],
  ],
  [
    'en',
    [
      { title: 'Personal', items: ['General', 'Memory'] },
      { title: 'Environment', items: ['Permissions'] },
      { title: 'Plugins', items: ['Skills', 'MCP', 'Hooks'] },
      { title: 'Models', items: ['Model services'] },
      { title: null, items: ['About'] },
    ],
  ],
] as const)('%s：设置菜单按分类显示标题与菜单项，关于在最底部且无分类标题', async (locale, expected) => {
  await page.viewport(1280, 800)
  const { screen, settingsPage } = renderSettings(locale)
  await screen
  settingsPage.open('general')
  const nav = settingsRegion().getByRole('navigation')
  await expect.element(nav).toBeVisible()
  expect(menu(nav.element())).toEqual(expected)
  // 分类以 group 角色暴露，名称为分类标题。
  await expect.element(nav.getByRole('group', { name: expected[0].title })).toBeVisible()
  // 关于是菜单中最后一项，位于其他分类下方。
  const rows = [...nav.element().querySelectorAll('[data-section]')]
  expect(rows.at(-1)?.getAttribute('data-section')).toBe('about')
  const models = nav.element().querySelector('[data-section="models"]')!.getBoundingClientRect()
  expect(rows.at(-1)!.getBoundingClientRect().top).toBeGreaterThan(models.bottom)
})

it('show 与 setSection 打开已交付分区并标记当前项；未交付分区回到常规', async () => {
  await page.viewport(1280, 800)
  const { screen, settingsPage } = renderSettings('en')
  await screen
  settingsPage.open('skills')
  const dialog = settingsRegion()
  await expect.element(dialog.getByRole('heading', { name: 'Skills & Commands' })).toBeVisible()
  const nav = dialog.getByRole('navigation').element()
  expect(nav.querySelector('[data-section="skills"]')?.getAttribute('aria-current')).toBe('page')
  expect([...nav.querySelectorAll('[aria-current="page"]')]).toHaveLength(1)

  settingsPage.setSection('permissions')
  await expect.element(dialog.getByRole('heading', { name: 'Permissions' })).toBeVisible()
  expect(nav.querySelector('[data-section="permissions"]')?.getAttribute('aria-current')).toBe('page')

  for (const id of ['appearance', 'plugins'] as const) {
    settingsPage.setSection(id)
    await expect.element(dialog.getByRole('heading', { name: 'General' })).toBeVisible()
    expect(nav.querySelector('[data-section="general"]')?.getAttribute('aria-current')).toBe('page')
    expect(nav.querySelector(`[data-section="${id}"]`)).toBeNull()
  }

  await dialog.getByRole('button', { name: 'Model services', exact: true }).click()
  expect(nav.querySelector('[data-section="models"]')?.getAttribute('aria-current')).toBe('page')
})

it('键盘按菜单顺序在菜单项间移动，焦点环可见，Enter 打开分区', async () => {
  await page.viewport(1280, 800)
  const { screen, settingsPage } = renderSettings('en')
  await screen
  settingsPage.open('general')
  const nav = settingsRegion().getByRole('navigation')
  await expect.element(nav).toBeVisible()
  const rows = [...nav.element().querySelectorAll<HTMLElement>('[data-section]')]
  rows[0]!.focus()
  // 从第一项开始按 Tab：记录每一步的焦点项与焦点环（键盘焦点为 :focus-visible，显示实线 outline）。
  const steps = [{ id: rows[0]!.getAttribute('data-section'), ring: 'skipped' }]
  for (let i = 1; i < rows.length; i++) {
    await userEvent.keyboard('{Tab}')
    const active = document.activeElement as HTMLElement
    steps.push({ id: active.getAttribute('data-section'), ring: active.matches(':focus-visible') ? getComputedStyle(active).outlineStyle : 'none' })
  }
  expect(steps.map((s) => s.id)).toEqual(['general', 'memory', 'permissions', 'skills', 'mcp', 'hooks', 'models', 'about'])
  expect(steps.slice(1).map((s) => s.ring)).toEqual(Array(rows.length - 1).fill('solid'))
  await userEvent.keyboard('{Enter}')
  await expect.element(settingsRegion().getByRole('heading', { name: 'About' })).toBeVisible()
})

it('M5 的注册表占位不显示：设置菜单中没有子代理、定时任务与通知，打开时回到常规；右栏 tab 与标题栏操作不含它们', async () => {
  expect(visibleRightPanelTabs().map((tab) => tab.id)).toEqual(['plan', 'jobs'])
  expect(visibleHeaderActions().map((action) => action.id)).toEqual(['jobs', 'cost'])
  await page.viewport(1280, 800)
  const { screen, settingsPage } = renderSettings('en')
  const result = await screen
  settingsPage.open('general')
  const dialog = settingsRegion()
  const nav = dialog.getByRole('navigation')
  await expect.element(nav).toBeVisible()
  for (const id of ['agents', 'schedules', 'notifications'] as const) {
    expect(nav.element().querySelector(`[data-section="${id}"]`)).toBeNull()
    settingsPage.setSection(id)
    await expect.element(dialog.getByRole('heading', { name: 'General' })).toBeVisible()
  }
  await result.unmount()
})

it('暗色主题：分类标题与菜单项使用主题前景色，标题比菜单项更弱', async () => {
  await page.viewport(1280, 800)
  for (const theme of ['light', 'dark'] as const) {
    const { screen, settingsPage } = renderSettings('en', theme)
    const result = await screen
    settingsPage.open('general')
    const nav = settingsRegion().getByRole('navigation')
    await expect.element(nav).toBeVisible()
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
    const title = document.getElementById(nav.element().querySelector('[data-settings-group]')!.getAttribute('aria-labelledby')!)!
    const item = nav.element().querySelector('[data-section="memory"]')!
    const bg = getComputedStyle(settingsRegion().element()).backgroundColor
    // 文字与背景不同色（不会在暗色下变成黑字黑底），标题与菜单项颜色不同（标题为弱化色）。
    expect(getComputedStyle(title).color).not.toBe(bg)
    expect(getComputedStyle(item).color).not.toBe(bg)
    expect(getComputedStyle(title).color).not.toBe(getComputedStyle(item).color)
    result.unmount()
  }
})

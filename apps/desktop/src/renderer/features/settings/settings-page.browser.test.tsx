// 整页设置（规格 2.1，2026-10-30 修订）：设置占满窗口，会话侧栏与聊天区隐藏但不卸载；“返回应用”、Escape 与再次按 ⌘, 回到应用；
// 有未保存修改时先确认；设置内的弹层先消费 Escape；按菜单项名称搜索导航。
import '../../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { toast } from '@coko/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

async function renderApp(locale: Locale = 'en', { width = 1280, height = 800, theme = 'light' as 'light' | 'dark' } = {}) {
  await page.viewport(width, height)
  const appearance = createAppearanceStore({ theme, locale })
  const { chat, settings, api } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.element(page.getByRole('button', { name: dictionaries[locale].sidebar.newSession })).toBeVisible()
  return { screen, chat, api, settings, settingsPage, appearance }
}

const main = () => document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
const sidebar = () => document.querySelector<HTMLElement>('[data-slot="app-frame-sidebar"]')!
const scroller = () => main().querySelector<HTMLElement>('.overflow-y-auto')!
const composer = () => page.getByRole('textbox', { name: 'Give Coko a task' })

it('⌘, 打开整页设置：会话侧栏与聊天区隐藏但不卸载；“返回应用”回到应用，草稿、滚动位置与焦点保持', async () => {
  await renderApp('en', { height: 420 })
  await expect.poll(() => scroller().scrollHeight > scroller().clientHeight).toBe(true)
  scroller().scrollTop = 40
  await composer().click()
  await userEvent.keyboard('keep this draft')
  const textbox = composer().element()

  await userEvent.keyboard('{Meta>},{/Meta}')
  const settings = settingsRegion()
  await expect.element(settings).toBeVisible()
  await expect.element(settings.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  // 整页：占满窗口，不是浮层弹窗。
  expect(settings.element().getBoundingClientRect()).toMatchObject({ top: 0, left: 0, width: 1280, height: 420 })
  expect(page.getByRole('dialog').query()).toBeNull()
  // 应用隐藏但仍在 DOM 中，不能聚焦或点击。
  expect(main().isConnected && sidebar().isConnected).toBe(true)
  expect(getComputedStyle(main()).visibility).toBe('hidden')
  expect(main().closest('[inert]')).not.toBeNull()
  // 焦点进入设置导航（当前项）。
  await expect.poll(() => settings.element().contains(document.activeElement)).toBe(true)
  expect(document.activeElement?.getAttribute('aria-current')).toBe('page')

  await settings.getByRole('button', { name: 'Back to app', exact: true }).click()
  await expect.element(settings).not.toBeInTheDocument()
  expect(getComputedStyle(main()).visibility).toBe('visible')
  expect(main().closest('[inert]')).toBeNull()
  expect(scroller().scrollTop).toBe(40)
  await expect.element(composer()).toHaveTextContent('keep this draft')
  // 焦点回到打开设置前的元素。
  await expect.poll(() => textbox.contains(document.activeElement)).toBe(true)
})

it('再次按 ⌘, 与 Escape 回到应用；侧栏设置按钮与 open(section) 定位到指定分区', async () => {
  const { settingsPage } = await renderApp('en')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = settingsRegion()
  await expect.element(settings.getByRole('heading', { level: 2, name: 'General' })).toBeVisible()
  await userEvent.keyboard('{Meta>},{/Meta}')
  await expect.element(settings).not.toBeInTheDocument()
  // 焦点回到侧栏设置按钮。
  await expect.element(page.getByRole('button', { name: 'Settings', exact: true })).toHaveFocus()

  settingsPage.open('models')
  await expect.element(settings.getByRole('heading', { level: 2, name: 'Model services' })).toBeVisible()
  expect(settings.element().querySelector('[data-section="models"]')?.getAttribute('aria-current')).toBe('page')
  await userEvent.keyboard('{Escape}')
  await expect.element(settings).not.toBeInTheDocument()
})

it('当前分区有未保存修改时，“返回应用”、Escape 与 ⌘, 先提示“放弃更改？”；继续编辑留在设置，确认后回到应用', async () => {
  const { settingsPage } = await renderApp('en')
  settingsPage.open('models')
  const settings = settingsRegion()
  await settings.getByRole('button', { name: 'Add model provider', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Provider ID', exact: true }).fill('custom-provider-2')
  const discard = page.getByRole('alertdialog', { name: 'Discard changes?' })

  await settings.getByRole('button', { name: 'Back to app', exact: true }).click()
  await expect.element(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await expect.element(discard).not.toBeInTheDocument()
  expect(settingsPage.getSnapshot().visible).toBe(true)

  settings.getByRole('textbox', { name: 'Provider ID', exact: true }).element().focus()
  await userEvent.keyboard('{Escape}')
  await expect.element(discard).toBeVisible()
  // 确认框中的 Escape 只关闭确认框，不离开设置。
  await userEvent.keyboard('{Escape}')
  await expect.element(discard).not.toBeInTheDocument()
  expect(settingsPage.getSnapshot().visible).toBe(true)
  await expect.element(settings.getByRole('textbox', { name: 'Provider ID', exact: true })).toHaveValue('custom-provider-2')

  await userEvent.keyboard('{Meta>},{/Meta}')
  await discard.getByRole('button', { name: 'Discard changes' }).click()
  await expect.element(settings).not.toBeInTheDocument()
})

it('设置内的菜单或弹窗打开时 Escape 只关闭它；设置打开时 Escape 不停止聊天区的 Run，回到应用后才停止', async () => {
  const { chat, api, settingsPage } = await renderApp('en')
  const abort = vi.spyOn(api, 'abortRun')
  chat.getState().openSession('s-2')
  await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  settingsPage.open('models')
  const settings = settingsRegion()
  await settings.getByRole('button', { name: 'Add model provider', exact: true }).click()
  await settings.getByRole('button', { name: 'API protocol', exact: true }).click()
  await expect.element(page.getByRole('menu')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(settingsPage.getSnapshot().visible).toBe(true)
  // 表单没有修改：下一次 Escape 回到应用，不停止 Run。
  await userEvent.keyboard('{Escape}')
  await expect.element(settings).not.toBeInTheDocument()
  expect(abort).not.toHaveBeenCalled()
  // Run 仍在进行，回到应用后可见并可停止。
  await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await vi.waitFor(() => expect(abort).toHaveBeenCalledWith('s-2'))
})

/** 导航的可见结构：分类 id 与菜单项 id。 */
const menu = () =>
  [...settingsRegion().element().querySelectorAll('[data-settings-group]')].map((group) => ({
    group: group.getAttribute('data-settings-group'),
    items: [...group.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section')),
  }))

it('“搜索设置…”按菜单项名称过滤导航：当前语言与英文名称、不区分大小写；分类随之隐藏；无匹配时显示空状态，清空后恢复；不搜索分区内的设置项', async () => {
  const { settingsPage } = await renderApp('zh')
  settingsPage.open('models')
  const settings = settingsRegion()
  const search = settings.getByRole('searchbox', { name: '搜索设置' })
  await expect.element(search).toHaveAttribute('placeholder', '搜索设置…')
  const full = menu()
  expect(full.map((g) => g.group)).toEqual(['personal', 'environment', 'plugins', 'models', ''])

  await search.fill('记忆')
  await expect.poll(menu).toEqual([{ group: 'personal', items: ['memory'] }])
  // 英文名称、大小写不敏感。
  await search.fill('MODEL')
  await expect.poll(menu).toEqual([{ group: 'models', items: ['models'] }])
  await search.fill('mcp')
  await expect.poll(menu).toEqual([{ group: 'plugins', items: ['mcp'] }])
  // 分组仍以分类标题为名称。
  await expect.element(settings.getByRole('group', { name: '插件' })).toBeVisible()
  // 详情不随搜索变化。
  await expect.element(settings.getByRole('heading', { level: 2, name: '模型服务' })).toBeVisible()

  // 分区内的设置项（如“API 协议”）与未交付的菜单项（外观）不参与搜索。
  for (const query of ['API', '协议', 'appearance', 'zzz']) {
    await search.fill(query)
    await expect.poll(menu).toEqual([])
    await expect.element(settings.getByRole('status')).toHaveTextContent('没有匹配的设置')
  }
  await search.fill('')
  await expect.poll(menu).toEqual(full)
  expect(settings.getByRole('status').query()).toBeNull()
})

it('外壳几何与源稿画面 01 一致：导航 240px、安全区 48px、返回行 H36、搜索框 H32/R12、菜单项 H32/R12、详情最宽 800px 居中', async () => {
  const { settingsPage } = await renderApp('en', { width: 1440, height: 960 })
  settingsPage.open('general')
  const settings = settingsRegion()
  await expect.element(settings).toBeVisible()
  const nav = settings.getByRole('navigation', { name: 'Settings sections' }).element()
  const column = nav.parentElement!.getBoundingClientRect()
  expect(column.left).toBe(0)
  expect(column.width).toBe(240)
  expect(column.height).toBe(960)
  const back = settings.getByRole('button', { name: 'Back to app' }).element().getBoundingClientRect()
  expect(back.top).toBe(48)
  expect(back.height).toBe(36)
  expect(back.left).toBe(12)
  expect(back.width).toBe(216)
  const searchBox = settings.getByRole('searchbox').element()
  expect(searchBox.getBoundingClientRect().height).toBe(32)
  expect(searchBox.getBoundingClientRect().width).toBe(216)
  expect(getComputedStyle(searchBox).borderRadius).toBe('12px')
  const item = nav.querySelector<HTMLElement>('[data-section="general"]')!
  expect(item.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(item).borderRadius).toBe('12px')
  // 当前项有选中态。
  expect(item.getAttribute('aria-current')).toBe('page')
  expect(getComputedStyle(item).backgroundColor).not.toBe(getComputedStyle(nav.querySelector('[data-section="memory"]')!).backgroundColor)
  // 详情：右侧居中，最宽 800px，上边距 72px。
  const heading = settings.getByRole('heading', { level: 2, name: 'General' }).element()
  const detail = heading.closest<HTMLElement>('[data-settings-detail]')!
  const body = heading.closest('[data-settings-detail] > div')!.getBoundingClientRect()
  expect(body.width).toBe(800)
  // 居中相对于实际可见的详情区域；经典滚动条占用的宽度不属于内容。
  expect(body.left).toBe(detail.getBoundingClientRect().left + (detail.clientWidth - body.width) / 2)
  expect(body.top).toBe(72)
})

it('明暗主题：导航与详情使用语义色，文字与背景在两种主题下都可区分', async () => {
  const colors: Record<string, string[]> = {}
  for (const theme of ['light', 'dark'] as const) {
    const { screen, settingsPage } = await renderApp('en', { theme })
    settingsPage.open('general')
    const settings = settingsRegion()
    await expect.element(settings).toBeVisible()
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
    const nav = settings.getByRole('navigation').element().parentElement!
    const detail = settings.element().querySelector('[data-settings-detail]')!
    const navBg = getComputedStyle(nav).backgroundColor
    const pageBg = getComputedStyle(settings.element()).backgroundColor
    const item = getComputedStyle(nav.querySelector('[data-section="memory"]')!).color
    expect(item).not.toBe(navBg)
    expect(getComputedStyle(detail.querySelector('h2')!).color).not.toBe(pageBg)
    colors[theme] = [navBg, pageBg, item]
    screen.unmount()
  }
  expect(colors.dark).not.toEqual(colors.light)
})

it('窄窗口 390px：导航在详情上方，返回入口、搜索框与菜单项可达，无整页横向滚动', async () => {
  const { settingsPage } = await renderApp('en', { width: 390, height: 700 })
  settingsPage.open('general')
  const settings = settingsRegion()
  await expect.element(settings).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  const back = settings.getByRole('button', { name: 'Back to app' }).element().getBoundingClientRect()
  expect(back.left).toBeGreaterThanOrEqual(0)
  expect(back.right).toBeLessThanOrEqual(390)
  const heading = settings.getByRole('heading', { level: 2, name: 'General' }).element().getBoundingClientRect()
  const nav = settings.getByRole('navigation').element().getBoundingClientRect()
  expect(heading.top).toBeGreaterThan(nav.bottom - 1)
  expect(heading.right).toBeLessThanOrEqual(390)
  // 最后一个菜单项可滚动到视口内并能打开。
  const about = settings.getByRole('button', { name: 'About', exact: true })
  await about.click()
  await expect.element(settings.getByRole('heading', { level: 2, name: 'About' })).toBeVisible()
})

it('可访问性：设置是带标题的 region，Tab 依次经过返回、搜索与菜单项；焦点环可见', async () => {
  const { settingsPage } = await renderApp('en')
  settingsPage.open('general')
  const settings = settingsRegion()
  await expect.element(settings.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  await expect.element(settings.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  const back = settings.getByRole('button', { name: 'Back to app' }).element() as HTMLElement
  back.focus()
  const steps: (string | null)[] = []
  for (let i = 0; i < 3; i++) {
    await userEvent.keyboard('{Tab}')
    const active = document.activeElement as HTMLElement
    expect(active.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(active).outlineStyle).toBe('solid')
    steps.push(active.getAttribute('data-section') ?? active.getAttribute('type'))
  }
  expect(steps).toEqual(['search', 'general', 'archived'])
  // 应用部分不在 Tab 顺序中。
  expect(main().closest('[inert]')).not.toBeNull()
})

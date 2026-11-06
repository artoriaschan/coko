import '../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@coko/ui'
import { App } from './app.tsx'
import { createAppearanceStore } from './appearance-store.ts'
import { createConnectionStore } from './connection-store.ts'
import { createPreferences } from './preferences.ts'
import { createSettingsPageStore } from './settings-page-store.ts'
import { catalogModel, customProvider } from '../testing/fake-settings.ts'
import { createFixtureChat } from '../testing/fixture-chat.ts'
import { setReducedMotion } from '../testing/browser-commands.ts'
import { openPage } from '../features/right-panel/layout-store.ts'
import { settingsRegion } from '../testing/settings-page.ts'

it('pinning and unpinning the open conversation preserve its content and editor DOM', async () => {
  await page.viewport(1200, 900)
  const fixture = renderApp('en')
  await fixture.screen
  await expect.element(page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true })).toBeVisible()
  const heading = page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true }).element()
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
  await userEvent.type(editor, 'Example retained draft')
  const row = page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true })
  await userEvent.hover(row)
  await userEvent.click(page.getByRole('button', { name: 'Pin conversation', exact: true }).first())
  await expect.element(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible()
  expect(page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true }).element()).toBe(heading)
  expect(document.querySelector('[contenteditable="true"]')).toBe(editor)
  expect(editor.textContent).toContain('Example retained draft')
  await userEvent.hover(row)
  await userEvent.click(page.getByRole('button', { name: 'Unpin conversation', exact: true }))
  await expect.element(page.getByRole('heading', { name: 'Pinned', exact: true })).not.toBeInTheDocument()
  expect(document.querySelector('[contenteditable="true"]')).toBe(editor)
  expect(editor.textContent).toContain('Example retained draft')
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
})

it('project pin, rename and edit preserve the open conversation and editor while updating destination references', async () => {
  await page.viewport(1200, 900)
  const fixture = renderApp('en')
  await fixture.screen
  await expect.element(page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true })).toBeVisible()
  const heading = page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true }).element()
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
  await userEvent.type(editor, 'Project draft stays')
  await userEvent.hover(page.getByRole('button', { name: 'coko', exact: true }))
  await page.getByRole('button', { name: 'Pin project', exact: true }).click()
  await expect.element(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible()
  expect(page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true }).element()).toBe(heading)
  expect(document.querySelector('[contenteditable="true"]')).toBe(editor)
  await userEvent.hover(page.getByRole('button', { name: 'coko', exact: true }))
  await page.getByRole('button', { name: 'More project actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Current project renamed')
  await userEvent.keyboard('{Enter}')
  expect(fixture.chat.lists.getState().projects.find((project) => project.id === 'project-w-coko')?.name).toBe('Current project renamed')
  await userEvent.hover(page.getByRole('button', { name: 'Current project renamed', exact: true }))
  await page.getByRole('button', { name: 'Edit project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true })
  await expect.element(dialog.getByRole('textbox', { name: 'Project name' })).toHaveValue('Current project renamed')
  await expect.element(dialog.getByText('/Users/me/coko', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await userEvent.hover(page.getByRole('button', { name: 'Current project renamed', exact: true }))
  await page.getByRole('button', { name: 'More project actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Edit project…', exact: true }).click()
  await expect.element(dialog.getByRole('textbox', { name: 'Project name' })).toHaveValue('Current project renamed')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await userEvent.hover(page.getByRole('button', { name: 'Current project renamed', exact: true }))
  await page.getByRole('button', { name: 'Unpin project', exact: true }).click()
  expect(document.querySelector('[contenteditable="true"]')).toBe(editor)
  expect(editor.textContent).toContain('Project draft stays')
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
  await userEvent.hover(page.getByRole('button', { name: 'Current project renamed', exact: true }))
  await page.getByRole('button', { name: 'New session in Current project renamed' }).click()
  await expect.element(page.getByRole('button', { name: 'Choose chat destination: Current project renamed' })).toBeVisible()
})

function leaves(value: unknown): string[] {
  return Object.values(value as Record<string, unknown>).flatMap((child) => (typeof child === 'string' ? [child] : leaves(child)))
}

/** 字典文案转为匹配模式：{name} 占位符匹配任意插值。 */
function dictionaryMatcher(locale: Locale) {
  const patterns = leaves(dictionaries[locale]).map((text) => new RegExp(`^${text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '.+')}$`))
  return (text: string) => patterns.some((pattern) => pattern.test(text))
}

const USER_CONTENT = '[data-user-content]'

/** 收集界面 chrome 中的文案：用户内容（会话标题、消息、工作区名）之外的文本节点与无障碍名称。 */
function chromeStrings(root: ParentNode = document.body): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    const parent = node.parentElement
    if (!text || !parent || parent.closest(USER_CONTENT) || parent.closest('script, style, time')) continue
    // Decorative text is hidden from assistive technology; control names are still checked below.
    if (parent.closest('[aria-hidden="true"]')) continue
    out.push(text)
  }
  for (const el of root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')) {
    // 时间是本地化的持久化事实，由 MessageTime 测试验证，不是固定 chrome 文案。
    if (el.tagName === 'TIME') continue
    // 用户内容内部只检查控件（例如 Markdown 代码块的复制按钮）
    if (el.closest(USER_CONTENT) && el.tagName !== 'BUTTON') continue
    const ownUserText = [...el.querySelectorAll(USER_CONTENT)].map((u) => u.textContent?.trim())
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      // Sonner 在区域名称后追加快捷键提示（如 "alt+T"），不属于文案
      const value = el
        .getAttribute(attr)
        ?.replace(/\s+(?:alt|ctrl|meta|shift)\+\w+$/i, '')
        .trim()
      if (value && !ownUserText.includes(value)) out.push(value)
    }
  }
  return out
}

it('chrome 文案检查排除原文和装饰文字，仍覆盖可见文案与原文区域内的控件名称', () => {
  const root = document.createElement('div')
  root.innerHTML = `
    <span data-user-content>src/sidebar.tsx<button aria-label="Untranslated control">original output</button></span>
    <span aria-hidden="true">·</span>
    <span>Untranslated visible text</span>
  `
  expect(chromeStrings(root)).toEqual(['Untranslated visible text', 'Untranslated control'])
})

const CJK = /[\u3400-\u9fff]/

const rgb = (value: string) =>
  value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number) as [number, number, number]
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const transparent = (color: string) => color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color)
/** 文字颜色对其最近的不透明背景（向上找祖先，最后是根元素）的对比度。 */
function contrastOf(el: Element): number {
  let node: Element | null = el
  let background = ''
  while (node) {
    const color = getComputedStyle(node).backgroundColor
    if (!transparent(color)) {
      background = color
      break
    }
    node = node.parentElement
  }
  if (background === '') background = getComputedStyle(document.documentElement).backgroundColor
  const [x, y] = [luminance(rgb(getComputedStyle(el).color)), luminance(rgb(background))].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

function renderApp(locale: Locale = 'zh', options: { providers?: boolean; theme?: 'light' | 'dark' } = {}) {
  const store = createAppearanceStore({ theme: options.theme ?? 'light', locale })
  const connection = createConnectionStore()
  const { chat, settings, backend, api } = createFixtureChat(options)
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  return {
    store,
    connection,
    chat,
    settings,
    backend,
    api,
    screen: render(
      <div style={{ width: '100vw', height: '100vh' }}>
        <App
          store={store}
          connection={connection}
          chat={chat}
          settings={settings}
          preferences={preferences}
          settingsPage={settingsPage}
          pickDirectory={async () => null}
        />
      </div>,
    ),
  }
}

async function openSettings(name: RegExp | string) {
  await page.getByRole('button', { name }).first().click()
  return settingsRegion()
}

afterEach(async () => {
  // Toast 状态是模块级的，先清掉并等其离开 DOM，避免泄漏到下一个用例
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

describe('界面语言', () => {
  it('在设置的通用分区切换语言后文案即时更新，写入设置并显示 Toast', async () => {
    await page.viewport(1280, 800)
    const { screen, backend } = renderApp('zh')
    await screen
    await expect.element(page.getByRole('button', { name: '新对话' })).toBeVisible()

    const dialog = await openSettings('设置')
    await dialog.getByRole('radio', { name: 'English' }).click()
    await expect.element(dialog.getByRole('heading', { name: 'General' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(settingsRegion()).not.toBeInTheDocument()
    await vi.waitFor(() => expect(backend.settings.get('locale')?.value).toBe('en'))

    await expect.element(page.getByRole('button', { name: 'New chat' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Give Coko a task' })).toBeVisible()
    await expect.element(page.getByText('Interface language switched to English')).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
  })

  it.each(['zh', 'en'] as const)('%s：界面 chrome 中的每条文案都来自该语言的字典', async (locale) => {
    await page.viewport(1280, 800)
    await renderApp(locale).screen
    // 等待 Markdown 代码块控件出现，使其按钮文案也纳入检查
    await expect.poll(() => document.querySelector('[data-streamdown="code-block-copy-button"]') !== null).toBe(true)
    const inDictionary = dictionaryMatcher(locale)
    const strings = chromeStrings()
    expect(strings.length).toBeGreaterThan(10)
    expect(strings.filter((s) => !inDictionary(s))).toEqual([])
  })

  it('en：界面 chrome 中没有残留的中文（语言名“中文”除外）', async () => {
    await page.viewport(1280, 800)
    await renderApp('en').screen
    await expect.poll(() => document.querySelector('[data-streamdown="code-block-copy-button"]') !== null).toBe(true)
    expect(chromeStrings().filter((s) => CJK.test(s) && s !== dictionaries.en.locale.zh)).toEqual([])
  })

  it('切换语言与改变窗口宽度不丢失输入草稿', async () => {
    await page.viewport(1280, 800)
    const { store, screen } = renderApp('zh')
    await screen
    const composer = page.getByRole('textbox', { name: '向 Coko 布置任务' })
    await composer.fill('保留这段草稿')
    store.setLocale('en')
    await page.viewport(800, 800)
    await expect.element(page.getByRole('textbox', { name: 'Give Coko a task' })).toHaveTextContent('保留这段草稿')
  })
})

it('details use a 48px title row followed by one selected conversation tab, with no connection or cost controls', async () => {
  await page.viewport(1280, 800)
  const { chat, connection, screen } = renderApp('en')
  await screen
  const heading = page.getByRole('heading', { name: '设计 token 与三栏骨架', exact: true })
  await expect.element(heading).toBeVisible()
  const titleRow = heading.element().closest('header')!
  expect(titleRow.getBoundingClientRect().height).toBe(48)
  expect(getComputedStyle(heading.element()).fontSize).toBe('14px')
  expect(getComputedStyle(heading.element()).fontWeight).toBe('500')
  const tab = page.getByRole('tab', { name: 'Conversation', exact: true })
  await expect.element(tab).toHaveAttribute('aria-selected', 'true')
  expect(page.getByRole('tablist').element().getBoundingClientRect().top).toBe(titleRow.getBoundingClientRect().bottom)
  expect(getComputedStyle(tab.element()).fontSize).toBe('13px')
  const indicator = tab.element().querySelector<HTMLElement>('[data-slot="conversation-tab-indicator"]')!
  expect(indicator.getBoundingClientRect().height).toBe(2)
  expect(getComputedStyle(indicator).backgroundColor).toBe(getComputedStyle(tab.element()).color)
  await tab.click()
  expect(chat.getState().activeSessionId).toBe('s-1')
  expect(titleRow.querySelector('[data-connection]')).toBeNull()
  expect(document.querySelector('[data-slot="session-cost"]')).toBeNull()
  connection.set({ phase: 'connected' })
  const status = document.querySelector<HTMLElement>('[role="status"][data-connection]')!
  await expect.poll(() => status.textContent).toBe('Sidecar connected')
  expect(status.getBoundingClientRect().width).toBe(1)
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect.element(tab).not.toBeInTheDocument()
  expect(document.querySelector('[data-connection="connected"]')).toBe(status)
})

describe('Sidecar 连接状态', () => {
  it('视觉隐藏的状态元素播报连接阶段，文案随界面语言切换', async () => {
    await page.viewport(1280, 800)
    const { store, connection, screen } = renderApp('zh')
    await screen
    const status = page.getByRole('status', { name: /Sidecar/i })
    await expect.element(status).toHaveAttribute('data-connection', 'connecting')
    await expect.element(status).toHaveTextContent('正在连接 Sidecar')

    connection.set({ phase: 'connected' })
    await expect.element(status).toHaveAttribute('data-connection', 'connected')
    await expect.element(status).toHaveTextContent('Sidecar 已连接')
    store.setLocale('en')
    await expect.element(status).toHaveTextContent('Sidecar connected')
    await expect.element(page.getByRole('button', { name: 'New chat' })).toBeVisible()
  })

  it('启动失败时覆盖对话区，显示失败说明与原样的错误详情', async () => {
    await page.viewport(1280, 800)
    const { connection, screen } = renderApp('en')
    await screen
    connection.set({ phase: 'failed', code: 'fixture-fatal', message: 'boom' })
    await expect.element(page.getByRole('status', { name: /Sidecar/i })).toHaveAttribute('data-connection', 'failed')
    await expect.element(page.getByRole('status', { name: /Sidecar/i })).toHaveTextContent('Sidecar failed to start')
    const detail = document.querySelector('[data-error-code]')
    expect(detail?.getAttribute('data-error-code')).toBe('fixture-fatal')
    expect(detail?.textContent).toBe('boom (fixture-fatal)')
    // 失败覆盖层盖住消息与输入区；连接状态继续由视觉隐藏的元素播报，侧栏仍可见。
    const hit = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    const composer = page.getByRole('textbox', { name: 'Give Coko a task' }).element()
    expect(composer.contains(hit(composer))).toBe(false)
    const statusEl = page.getByRole('status', { name: /Sidecar/i }).element()
    expect(statusEl.getBoundingClientRect().width).toBe(1)
    const newSession = page.getByRole('button', { name: 'New chat' }).element()
    expect(newSession.contains(hit(newSession))).toBe(true)
  })
})

describe('主题', () => {
  it('在设置中切换到深色主题', async () => {
    await page.viewport(1280, 800)
    const { screen, backend } = renderApp('en')
    await screen
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(255, 255, 255)')

    const dialog = await openSettings('Settings')
    await dialog.getByRole('radio', { name: 'Dark' }).click()
    await vi.waitFor(() => expect(backend.settings.get('theme')?.value).toBe('dark'))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(21, 21, 23)')
    const sidebar = document.querySelector('[data-slot="app-frame-sidebar"]')!
    expect(getComputedStyle(sidebar).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(sidebar, '::before').backgroundImage).toContain('linear-gradient')
  })
})

describe('设置页', () => {
  it.each(['zh', 'en'] as const)('%s：各分区的文案都来自字典；⌘, 打开，Escape 返回应用', async (locale) => {
    await page.viewport(1280, 800)
    await renderApp(locale).screen
    await expect.element(page.getByRole('button', { name: dictionaries[locale].sidebar.newSession })).toBeVisible()
    await userEvent.keyboard('{Meta>},{/Meta}')
    const dialog = settingsRegion()
    await expect.element(dialog).toBeVisible()
    const inDictionary = dictionaryMatcher(locale)
    const openSection = async (section: 'general' | 'models' | 'about') => {
      await dialog.getByRole('button', { name: dictionaries[locale].settings.nav[section], exact: true }).click()
      // 对话框标题之后是分区标题。
      await expect.element(dialog.getByRole('heading', { level: 2 }).last()).toBeVisible()
    }
    const untranslated = () => chromeStrings(dialog.element()).filter((s) => !inDictionary(s))
    await openSection('general')
    expect(untranslated()).toEqual([])
    await openSection('models')
    // 同时检查新建表单。
    await dialog.getByRole('button', { name: dictionaries[locale].providers.add }).click()
    await expect.element(dialog.getByLabelText(dictionaries[locale].providers.credential, { exact: true })).toBeVisible()
    expect(untranslated()).toEqual([])
    // 协议菜单的选项同样来自字典。
    await dialog.getByRole('button', { name: dictionaries[locale].providers.protocol, exact: true }).click()
    await expect.element(page.getByRole('menuitemradio').first()).toBeVisible()
    expect(chromeStrings(page.getByRole('menu').element()).filter((s) => !inDictionary(s))).toEqual([])
    await userEvent.keyboard('{Escape}')
    await openSection('about')
    expect(untranslated()).toEqual([])
    await userEvent.keyboard('{Escape}')
    await expect.element(settingsRegion()).not.toBeInTheDocument()
  })
})

describe('侧栏搜索', () => {
  it.each([1280, 800])('search opens a shared modal at %spx without creating or replacing the current Session', async (width) => {
    await page.viewport(width, 800)
    const { chat, screen } = renderApp('en')
    await screen
    await expect.poll(() => chat.getState().activeSessionId).toBe('s-1')
    const before = chat.lists.getState().sessions
    // 收起侧栏后搜索入口在抽屉中；窄窗口先展开抽屉。
    if (width < 1024) await page.getByRole('button', { name: 'Expand sidebar' }).click()
    const trigger = page.getByRole('button', { name: 'Search', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Search conversations' })
    const input = dialog.getByRole('combobox')
    await expect.element(input).toHaveFocus()
    await input.fill('SIDECAR')
    await expect.element(dialog.getByRole('option', { name: 'Sidecar startup handshake' })).toBeVisible()
    await expect.poll(() => dialog.element().querySelectorAll('[role=option]').length).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(chat.getState().activeSessionId).toBe('s-1')
    expect(chat.lists.getState().sessions).toEqual(before)
  })
})

describe('键盘', () => {
  it('⌘N 在任意焦点下新建会话草稿并聚焦输入区', async () => {
    await page.viewport(1280, 800)
    const { chat, screen } = renderApp('en')
    await screen
    await expect.poll(() => chat.getState().activeSessionId).toBe('s-1')
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('{Meta>}n{/Meta}')
    await expect.element(page.getByRole('heading', { level: 1, name: 'New chat' })).toBeVisible()
    expect(chat.getState().activeSessionId).toBeNull()
    await expect.poll(() => document.activeElement === page.getByRole('textbox', { name: 'Give Coko a task' }).element()).toBe(true)
  })

  it('Run 进行中时 Escape 在输入区之外也能停止', async () => {
    await page.viewport(1280, 800)
    const { chat, api, screen } = renderApp('en')
    await screen
    const abort = vi.spyOn(api, 'abortRun')
    chat.getState().openSession('s-2')
    await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible()
    await page.getByRole('heading', { level: 1 }).click()
    expect(document.activeElement?.getAttribute('role')).not.toBe('textbox')
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(abort).toHaveBeenCalledWith('s-2'))
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('设置打开时 Escape 只返回应用，不停止 Run', async () => {
    await page.viewport(1280, 800)
    const { chat, api, screen } = renderApp('en')
    await screen
    const abort = vi.spyOn(api, 'abortRun')
    chat.getState().openSession('s-2')
    await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible()
    await userEvent.keyboard('{Meta>},{/Meta}')
    await expect.element(settingsRegion()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(settingsRegion()).not.toBeInTheDocument()
    expect(abort).not.toHaveBeenCalled()
    // 回到应用后，下一次 Escape 才停止。
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1))
  })
})

describe('模型选择', () => {
  it('未配置 Provider 时发送入口引导到设置的 Models 分区，草稿保留', async () => {
    await page.viewport(1280, 800)
    await renderApp('en', { providers: false }).screen
    const composer = page.getByRole('textbox', { name: 'Give Coko a task' })
    await composer.fill('keep this draft')
    const setup = page.getByRole('button', { name: 'Set up a model' })
    await expect.element(setup).toBeVisible()
    await composer.click()
    await userEvent.keyboard('{Enter}')
    const dialog = settingsRegion()
    await expect.element(dialog.getByRole('heading', { name: 'Model services', level: 2 })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(composer).toHaveTextContent('keep this draft')
  })

  it('输入区显示当前会话的模型，可按 Provider 分组切换', async () => {
    await page.viewport(1280, 800)
    const { screen, chat, settings, backend } = renderApp('en')
    await screen
    backend.seedProvider(customProvider('p2', ['big-model'], { name: 'Second' }))
    await settings.getState().load()
    await expect.poll(() => chat.getState().activeSessionId).toBe('s-1')
    await chat.getState().selectModel({ providerId: 'p1', modelId: 'faux-1' })
    const picker = page.getByRole('button', { name: /^Choose model: / })
    await expect.element(picker).toHaveTextContent('faux-1·Off')
    await picker.click()
    await page.getByRole('menuitem', { name: /^Choose model: / }).click()
    await expect.element(page.getByRole('menu').getByText('Fixture')).toBeVisible()
    await expect.element(page.getByRole('menu').getByText('Second')).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'big-model' }).click()
    await userEvent.keyboard('{Escape}')
    await expect.element(picker).toHaveTextContent('big-model·Off')
    expect(chat.lists.getState().sessions.find((s) => s.id === 's-1')?.model).toEqual({ providerId: 'p2', modelId: 'big-model' })
  })

  it('推理档位：会话默认“关闭”；推理开关打开的模型列出“关闭”与已配置档位；选择写入会话；换到未配置该档位的模型回到“关闭”', async () => {
    await page.viewport(1280, 800)
    const { screen, chat, settings, backend } = renderApp('zh')
    await screen
    const levels = [{ level: 'off' }, { level: 'high', value: 'deep' }, { level: 'medium', value: 'medium' }] as const
    backend.seedProvider(
      customProvider('p2', [], {
        name: 'Second',
        models: [
          catalogModel('thinker', { reasoning: true, thinkingLevels: [...levels] }),
          catalogModel('low-only', { reasoning: true, thinkingLevels: [{ level: 'low', value: 'low' }] }),
          catalogModel('switched-off', { reasoning: false, thinkingLevels: [...levels] }),
        ],
      }),
    )
    await settings.getState().load()
    await expect.poll(() => chat.getState().activeSessionId).toBe('s-1')
    await chat.getState().selectModel({ providerId: 'p1', modelId: 'faux-1' })
    const picker = page.getByRole('button', { name: /^选择模型：/ })
    const choose = async (name: string) => {
      if (!document.querySelector('[role="menu"][data-state="open"]')) {
        await picker.click()
      }
      await page.getByRole('menuitem', { name: /^选择模型：/ }).click()
      await page.getByRole('menuitemradio', { name, exact: true }).click()
      await expect.poll(() => chat.lists.getState().sessions.find((s) => s.id === 's-1')?.model?.modelId).toBe(name)
    }
    await picker.click()
    await expect.element(page.getByRole('slider', { name: '推理档位' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    await choose('thinker')
    const slider = page.getByRole('slider', { name: '推理档位' })
    await expect.element(slider).toHaveAttribute('aria-valuemax', '2')
    await expect.element(slider).toHaveAttribute('aria-valuetext', 'Off')
    await userEvent.keyboard('{Tab}{End}')
    await expect.poll(() => chat.lists.getState().sessions.find((s) => s.id === 's-1')).toMatchObject({ model: { modelId: 'thinker' }, thinkingLevel: 'high' })
    await expect.poll(() => document.querySelector('[data-model-picker]')?.textContent).toBe('thinker·High')
    await choose('low-only')
    await expect.element(slider).toHaveAttribute('aria-valuetext', 'Off')
    await expect.element(slider).toHaveAttribute('aria-valuemax', '1')
    await expect.poll(() => chat.lists.getState().sessions.find((s) => s.id === 's-1')).toMatchObject({ thinkingLevel: 'off' })
    await choose('switched-off')
    await expect.element(slider).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
  })
})

describe('窄窗口', () => {
  it.each([
    ['en', 'Open sidebar', 'Toggle sidebar (⌘/Ctrl+Alt+B)', 'Collapse sidebar', 'Toggle sidebar (⌘/Ctrl+Alt+B)'],
    ['zh', '打开侧边栏', '展开／收起右侧栏（⌘/Ctrl+Alt+B）', '收起侧边栏', '展开／收起右侧栏（⌘/Ctrl+Alt+B）'],
  ] as const)('%s：右栏打开入口隐藏，收起后焦点回到入口，Tooltip 标出快捷键', async (locale, openName, openTip, closeName, closeTip) => {
    await page.viewport(1200, 900)
    await renderApp(locale).screen
    const open = page.getByRole('button', { name: openName, exact: true })
    await expect.element(open).toBeVisible()
    await userEvent.hover(open)
    await expect.element(page.getByRole('tooltip', { name: openTip, exact: true })).toBeVisible()
    ;(open.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(open).not.toBeInTheDocument()
    const close = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!).getByRole('button', { name: closeName, exact: true })
    await expect.element(close).toBeVisible()
    await userEvent.hover(close)
    await expect.element(page.getByRole('tooltip', { name: closeTip, exact: true })).toBeVisible()
    ;(close.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(open).toBeVisible()
    await expect.poll(() => document.activeElement).toBe(open.element())
    await expect.element(close).not.toBeInTheDocument()
  })

  it('390px：无整页横向滚动，控制条与发送入口在视口内', async () => {
    await page.viewport(390, 700)
    await renderApp('en').screen
    await expect.poll(() => document.querySelector('[data-slot="app-frame"]')?.getAttribute('data-sidebar')).toBe('hidden')
    await expect.poll(() => document.querySelector('[data-streamdown="table"]') !== null).toBe(true)

    const doc = document.documentElement
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth)
    const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
    // data-sidebar 先更新，grid 列宽随后完成过渡；按真实可观察布局等待，不测中途的 110px 内容列。
    await expect.poll(() => main.scrollWidth - main.clientWidth).toBeLessThanOrEqual(0)
    // 代码、表格等列对齐内容只能在自身区域内横向滚动；KaTeX 的 MathML 副本始终被裁剪为 1px，只供读屏使用。
    // Markdown 插件异步渲染，轮询到布局稳定后再判定。
    const overflowing = () =>
      [...main.querySelectorAll<HTMLElement>('*')]
        .filter((el) => !el.closest('pre, [data-streamdown="table-wrapper"], [data-streamdown="code-block-body"], .katex-mathml'))
        .filter((el) => el.getBoundingClientRect().right > 390.5)
        .map((el) => el.outerHTML.slice(0, 80))
    await expect.poll(overflowing, { timeout: 5000 }).toEqual([])

    for (const name of ['Expand sidebar', 'New chat', 'Send']) {
      const rect = page.getByRole('button', { name }).element().getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(390)
    }
  })

  it.each(['light', 'dark'] as const)('390px（%s）：输入区占位符为一行且不越界，对比度 ≥ 4.5:1', async (theme) => {
    await page.viewport(390, 700)
    await renderApp('en', { theme }).screen
    await expect.poll(() => document.querySelector('[data-slot="app-frame"]')?.getAttribute('data-sidebar')).toBe('hidden')
    await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
    const editor = page.getByRole('textbox', { name: 'Give Coko a task' }).element() as HTMLElement
    const placeholder = () => document.querySelector<HTMLElement>('[data-slot="composer-placeholder"]')
    await expect.poll(() => placeholder()?.textContent).toBe('Give Coko a task')
    // 一行：元素高度等于行高（逐词换行时为数倍）。Lexical 会重建占位符元素，每次重新查询。
    const lines = () => {
      const current = placeholder()
      return current ? Math.round(current.getBoundingClientRect().height / parseFloat(getComputedStyle(current).lineHeight)) : 0
    }
    await expect.poll(lines).toBe(1)
    const el = placeholder()!
    const style = getComputedStyle(el)
    expect(el.getBoundingClientRect().height).toBeCloseTo(parseFloat(style.lineHeight), 0)
    expect([style.whiteSpace, style.textOverflow, style.overflow]).toEqual(['nowrap', 'ellipsis', 'hidden'])
    // 新的编辑区独占工具栏上方整行，短提示可以完整显示；需要时仍由 ellipsis 在编辑区内截断。
    expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(editor.getBoundingClientRect().right + 0.5)
    expect(contrastOf(el)).toBeGreaterThanOrEqual(4.5)
  })

  it('390px：标题栏没有交接按钮或旧的更多操作菜单，右栏入口保持可达', async () => {
    await page.viewport(390, 700)
    await renderApp('en').screen
    await expect.poll(() => document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBe(390)
    const header = document.querySelector<HTMLElement>('[data-slot="app-frame-main"] header')!
    expect(header.querySelector('[data-action="open-handoff"]')).toBeNull()
    expect(header.querySelector('[data-action="more-header-actions"]')).toBeNull()
    const right = header.querySelector<HTMLElement>('button[aria-label="Open sidebar"]')!
    expect(right.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    right.focus()
    expect(document.activeElement).toBe(right)
  })

  it('控制条展开的抽屉中可以选择会话，选择后抽屉关闭', async () => {
    await page.viewport(800, 700)
    await renderApp('en').screen
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    const drawer = page.getByRole('dialog', { name: 'Sidebar' })
    // 运行中的会话：按钮名称包含运行状态。
    await drawer.getByRole('button', { name: /^Sidecar startup handshake/ }).click()
    await expect.element(drawer).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Sidecar startup handshake' })).toBeVisible()
  })
})

describe('双栏工作台导航', () => {
  it('H32 三项导航、左上历史按钮与固定设置入口；插件和定时任务保留侧栏', async () => {
    await page.viewport(1280, 800)
    await renderApp('en').screen
    const back = page.getByRole('button', { name: 'Go back', exact: true })
    const forward = page.getByRole('button', { name: 'Go forward', exact: true })
    await expect.element(back).toBeDisabled()
    await expect.element(forward).toBeDisabled()
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const rows = navigation.element().querySelectorAll('[data-workbench-nav]')
    expect(rows).toHaveLength(3)
    expect([...rows].map((row) => row.getBoundingClientRect().height)).toEqual([32, 32, 32])
    const controls = [...document.querySelectorAll('[data-workbench-window-controls] button')].map((button) => button.getAttribute('aria-label'))
    expect(controls).toEqual(['Collapse sidebar', 'Go back', 'Go forward'])
    await navigation.getByRole('button', { name: 'Plugins', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await expect.element(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible()
    expect(document.querySelector('[data-settings-page]')).toBeNull()
    await navigation.getByRole('button', { name: 'Scheduled tasks', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Scheduled tasks', exact: true })).toBeVisible()
    await back.click()
    await expect.element(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await forward.click()
    await expect.element(page.getByRole('heading', { name: 'Scheduled tasks', exact: true })).toBeVisible()
    const footer = document.querySelector('[data-workbench-settings]')!
    const sidebar = document.querySelector('[data-slot="app-frame-sidebar"]')!
    expect(footer.getBoundingClientRect().bottom).toBe(sidebar.getBoundingClientRect().bottom)
    expect(footer.getBoundingClientRect().height).toBe(46)
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    expect(settings.element().getBoundingClientRect().height).toBe(36)
    expect(getComputedStyle(settings.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await userEvent.hover(settings.element())
    await expect.poll(() => getComputedStyle(settings.element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('新对话常态透明；hover 行铺满整行，hover 搜索只亮按钮', async () => {
    await page.viewport(1280, 800)
    await renderApp('en').screen
    const group = document.querySelector<HTMLElement>('[data-workbench-nav]')!
    const newChat = page.getByRole('button', { name: 'New chat', exact: true }).element() as HTMLElement
    const search = page.getByRole('button', { name: 'Search', exact: true }).element() as HTMLElement
    expect(getComputedStyle(group).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await userEvent.hover(newChat)
    await expect.poll(() => getComputedStyle(group).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(newChat).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await userEvent.hover(search)
    await expect.poll(() => getComputedStyle(group).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await expect.poll(() => getComputedStyle(search).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})

describe('内容区历史与草稿', () => {
  it('会话、新对话和页面参与历史，设置不占历史；列表移除的会话自动跳过', async () => {
    await page.viewport(1280, 800)
    const { chat, api, screen } = renderApp('en')
    await screen
    const back = page.getByRole('button', { name: 'Go back', exact: true })
    const forward = page.getByRole('button', { name: 'Go forward', exact: true })
    await page.getByRole('button', { name: /^Sidecar startup handshake/ }).click()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Sidecar startup handshake' })).toBeVisible()
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Give Coko a task' })
    await editor.fill('a draft kept across pages')
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect.element(settingsRegion()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(settingsRegion()).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await back.click()
    await expect.element(editor).toHaveTextContent('a draft kept across pages')
    // 模拟协议列表刷新：被移除的会话不应再成为前进、后退的目标。
    const remaining = chat.lists.getState().sessions.filter((session) => session.id !== 's-2')
    vi.spyOn(api, 'listSessions').mockResolvedValue(remaining)
    await chat.getState().load()
    await back.click()
    await expect.element(page.getByRole('heading', { level: 1, name: '设计 token 与三栏骨架' })).toBeVisible()
    await forward.click()
    await expect.element(editor).toHaveTextContent('a draft kept across pages')
    await forward.click()
    await expect.element(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await expect.element(forward).toBeDisabled()
    // 矩形子表面不能覆盖 AppFrame 的四个圆角。
    const frame = document.querySelector<HTMLElement>('[data-slot="app-frame"]')!
    const style = getComputedStyle(frame)
    expect([style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]).toEqual([
      '28px',
      '28px',
      '28px',
      '28px',
    ])
    for (const [x, y] of [
      [1, 1],
      [1279, 1],
      [1, 799],
      [1279, 799],
    ]) {
      const target = document.elementFromPoint(x!, y!)
      expect(target === frame || !frame.contains(target)).toBe(true)
    }
  })
})

it('opens Start on demand, replaces it with a singleton page and collapses after its final close', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  await expect.element(panel.getByRole('tab', { name: 'Start', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(panel.getByRole('tab').all().length).toBe(1)
  expect(panel.getByRole('button', { name: 'New tab', exact: true }).query()).toBeNull()
  expect(panel.getByRole('button', { name: 'Close Start', exact: true }).query()).toBeNull()
  for (const name of ['Plan', 'Tasks', 'Agents', 'Schedules', 'Team']) {
    await expect.element(panel.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await page.screenshot({ element: panel.element(), path: '../../../../../.vitest/sidebar-start-desktop.png' })
  await panel.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect.element(panel.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(panel.getByRole('tab').all().length).toBe(1)
  await expect.element(panel.getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Close Tasks', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toHaveFocus()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.element(panel.getByRole('tab', { name: 'Start', exact: true })).toBeVisible()
})

it('retains separate sidebar pages per Session and hides the container on non-session pages', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = () => page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  await panel().getByRole('button', { name: 'Tasks', exact: true }).click()
  await panel().getByRole('button', { name: 'New tab', exact: true }).click()
  await panel().getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: /^Sidecar startup handshake/ }).click()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await panel().getByRole('button', { name: 'Team', exact: true }).click()
  await page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true }).click()
  expect(
    panel()
      .getByRole('tab')
      .all()
      .map((tab) => tab.element().getAttribute('data-tab')),
  ).toEqual(['jobs', 'plan'])
  await expect.element(panel().getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('tab', { name: 'Plan', exact: true })).not.toBeInTheDocument()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).not.toBeInTheDocument()
})

it('keeps the right page mounted through fullscreen and collapses narrow fullscreen without reopening', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  const panel = document.querySelector<HTMLElement>('[data-slot="app-frame-right"]')!
  const pageNode = document.querySelector('#right-panel-tabpanel')!
  const center = document.querySelector('[data-slot="app-frame-main"]')!
  await expect.poll(() => Math.round(panel.getBoundingClientRect().width)).toBe(648)
  const centerWidth = center.getBoundingClientRect().width
  const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true })
  expect(fullscreen.query()).not.toBeNull()
  await fullscreen.click()
  await expect.poll(() => panel.getBoundingClientRect().width).toBe(1440)
  expect(center.getBoundingClientRect().width).toBe(centerWidth)
  expect(document.querySelector('#right-panel-tabpanel')).toBe(pageNode)
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await expect.poll(() => Math.round(panel.getBoundingClientRect().width)).toBe(648)
  expect(document.querySelector('#right-panel-tabpanel')).toBe(pageNode)
  await page.viewport(700, 900)
  await expect.element(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible()
  await expect.poll(() => panel.getBoundingClientRect().width).toBe(700)
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toHaveFocus()
  await page.viewport(1440, 900)
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  expect(panel.hidden).toBe(true)
})

it('resizes the sidebar panel through its separator and remembers fit collapse across window growth', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = document.querySelector<HTMLElement>('[data-slot="app-frame-right"]')!
  const handle = page.getByRole('separator', { name: 'Resize sidebar panel', exact: true })
  await handle.click()
  await userEvent.keyboard('{Home}')
  await expect.poll(() => Math.round(panel.getBoundingClientRect().width)).toBe(300)
  await userEvent.keyboard('{ArrowLeft}')
  await expect.poll(() => Math.round(panel.getBoundingClientRect().width)).toBe(316)
  await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).click()
  await userEvent.keyboard('{End}')
  await expect.poll(() => document.querySelector('[data-slot="app-frame-sidebar"]')!.getBoundingClientRect().width).toBe(420)
  await page.viewport(1120, 900)
  await expect.poll(() => Math.round(panel.getBoundingClientRect().width)).toBe(300)
  await page.viewport(1119, 900)
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="app-frame-sidebar"]')!.getBoundingClientRect().width).toBe(420)
  await page.viewport(1440, 900)
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  expect(panel.hidden).toBe(true)
})

it.each([
  ['en', 'light', 'Open sidebar', 'Start', 'Team'],
  ['zh', 'dark', '打开侧边栏', '开始', '团队'],
] as const)('%s %s: Start and its page entry remain reachable at 390 CSS px', async (locale, theme, open, start, lastPage) => {
  await page.viewport(390, 400)
  await renderApp(locale, { theme }).screen
  await page.getByRole('button', { name: open, exact: true }).click()
  await expect.element(page.getByRole('tab', { name: start, exact: true })).toBeVisible()
  const card = page.getByRole('button', { name: lastPage, exact: true })
  const bounds = card.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(390)
  const first = page.getByRole('button', { name: locale === 'zh' ? '计划' : 'Plan', exact: true })
  ;(first.element() as HTMLElement).focus()
  for (let index = 0; index < 4; index++) await userEvent.keyboard('{Tab}')
  await expect.element(card).toHaveFocus()
  const focusedBounds = card.element().getBoundingClientRect()
  expect(focusedBounds.top).toBeGreaterThanOrEqual(0)
  expect(focusedBounds.bottom).toBeLessThanOrEqual(400)
  await page.screenshot({ path: `../../../../../.vitest/sidebar-start-${locale}-${theme}-390-short.png` })
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('tab', { name: lastPage, exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
})

it('sidebar tabs use manual keyboard activation and modifier arrows reorder the focused tab', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  await panel.getByRole('button', { name: 'Tasks', exact: true }).click()
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  const plan = panel.getByRole('tab', { name: 'Plan', exact: true })
  const trace = panel.getByRole('tab', { name: 'Tasks', exact: true })
  ;(plan.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(trace).toHaveFocus()
  await expect.element(plan).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Enter}')
  await expect.element(trace).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Meta>}{Shift>}{ArrowRight}{/Shift}{/Meta}')
  expect(
    panel
      .getByRole('tab')
      .all()
      .map((tab) => tab.element().textContent),
  ).toEqual(['Plan', 'Tasks'])
  await expect.element(trace).toHaveFocus()
  await userEvent.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')
  expect(
    panel
      .getByRole('tab')
      .all()
      .map((tab) => tab.element().textContent),
  ).toEqual(['Tasks', 'Plan'])
  await userEvent.keyboard('{End}')
  await expect.element(plan).toHaveFocus()
  await expect.element(trace).toHaveAttribute('aria-selected', 'true')
})

it('sidebar supports middle-click and context closing while its sole Start tab stays protected', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  const open = async (name: string) => {
    if (!panel.getByRole('tab', { name: 'Start', exact: true }).query()) await panel.getByRole('button', { name: 'New tab', exact: true }).click()
    await panel.getByRole('button', { name, exact: true }).click()
  }
  const order = () =>
    panel
      .getByRole('tab')
      .all()
      .map((tab) => tab.element().textContent)
  await open('Tasks')
  await open('Plan')
  await open('Team')
  await panel.getByRole('tab', { name: 'Plan', exact: true }).click({ button: 'middle' })
  expect(order()).toEqual(['Tasks', 'Team'])
  await panel.getByRole('tab', { name: 'Tasks', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true }).click()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(order()).toEqual(['Tasks'])
  await open('Plan')
  await open('Team')
  await panel.getByRole('tab', { name: 'Plan', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(order()).toEqual(['Plan'])
  await panel.getByRole('tab', { name: 'Plan', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const start = panel.getByRole('tab', { name: 'Start', exact: true })
  await start.click({ button: 'middle' })
  await start.click({ button: 'right' })
  expect(page.getByRole('menu').query()).toBeNull()
  await expect.element(start).toBeVisible()
})

it('sidebar tabs reorder through pointer dragging without changing the selected page', async () => {
  await page.viewport(1440, 900)
  await renderApp('en').screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  await panel.getByRole('button', { name: 'Tasks', exact: true }).click()
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  const source = panel.getByRole('tab', { name: 'Tasks', exact: true }).element()
  const target = panel.getByRole('tab', { name: 'Plan', exact: true }).element()
  const center = (element: Element) => {
    const rect = element.getBoundingClientRect()
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
  }
  const fire = (element: EventTarget, type: string, point: { clientX: number; clientY: number }, buttons: number) =>
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        isPrimary: true,
        pointerType: 'mouse',
        pointerId: 1,
        button: 0,
        buttons,
        ...point,
      }),
    )
  const from = center(source)
  const to = center(target)
  fire(source, 'pointerdown', from, 1)
  fire(document, 'pointermove', { ...from, clientX: from.clientX + 8 }, 1)
  await new Promise(requestAnimationFrame)
  fire(document, 'pointermove', to, 1)
  await new Promise(requestAnimationFrame)
  fire(document, 'pointerup', to, 0)
  await expect
    .poll(() =>
      panel
        .getByRole('tab')
        .all()
        .map((tab) => tab.element().textContent),
    )
    .toEqual(['Plan', 'Tasks'])
  await expect.element(panel.getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true')
})

it.each([
  ['en', 'light'],
  ['zh', 'dark'],
] as const)('%s %s: overflowing sidebar tabs scroll with fading edges while controls remain reachable at 390px', async (locale, theme) => {
  await page.viewport(390, 800)
  const { store, screen } = renderApp('en', { theme })
  await screen
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  for (const name of ['Plan', 'Tasks', 'Agents', 'Schedules', 'Team']) {
    if (!panel.getByRole('tab', { name: 'Start', exact: true }).query()) await panel.getByRole('button', { name: 'New tab', exact: true }).click()
    await panel.getByRole('button', { name, exact: true }).click()
  }
  store.setLocale(locale)
  const list = panel.getByRole('tablist').element() as HTMLElement
  expect(list.scrollWidth).toBeGreaterThan(list.clientWidth)
  expect(getComputedStyle(list).overflowX).toBe('auto')
  expect(getComputedStyle(list).scrollbarWidth).toBe('none')
  list.scrollLeft = 0
  list.dispatchEvent(new Event('scroll'))
  await expect.poll(() => getComputedStyle(list).maskImage).toContain('linear-gradient')
  list.scrollLeft = list.scrollWidth / 2 - list.clientWidth / 2
  list.dispatchEvent(new Event('scroll'))
  await expect.poll(() => getComputedStyle(list).maskImage.match(/rgba\(0, 0, 0, 0\)/g)?.length).toBe(2)
  const close = page
    .elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
    .getByRole('button', { name: locale === 'zh' ? '收起侧边栏' : 'Collapse sidebar', exact: true })
    .element()
  const bounds = close.getBoundingClientRect()
  expect(bounds.width).toBeGreaterThanOrEqual(28)
  expect(bounds.right).toBeLessThanOrEqual(390)
  expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.left)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
})

it.each([false, true])('opening an already displayed sidebar page glows for 600ms while foreground changes do not glow (reduce=%s)', async (reduced) => {
  await setReducedMotion(reduced)
  onTestFinished(() => setReducedMotion(false))
  await page.viewport(1440, 900)
  await renderApp('en').screen
  const openTasks = () => openPage('s-1', 'jobs')
  openTasks()
  await expect.element(page.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(document.querySelector('[data-slot="panel-attention"]')).toBeNull()
  openTasks()
  await expect.poll(() => document.querySelector('[data-slot="panel-attention"]')).not.toBeNull()
  const glow = document.querySelector<HTMLElement>('[data-slot="panel-attention"]')
  expect(glow).not.toBeNull()
  const animation = glow!.getAnimations()[0]!
  animation.pause()
  expect(animation.effect!.getTiming().duration).toBe(600)
  expect(getComputedStyle(glow!).boxShadow).toContain('inset')
  const frames = (animation.effect as KeyframeEffect).getKeyframes()
  expect(frames.map((frame) => frame.opacity)).toEqual(reduced ? ['1', '1'] : ['1', '0'])
  animation.finish()
  await expect.poll(() => document.querySelector('[data-slot="panel-attention"]')).toBeNull()
  const panel = page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!)
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  openTasks()
  await expect.element(page.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(document.querySelector('[data-slot="panel-attention"]')).toBeNull()
  await panel.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  openTasks()
  await expect.element(page.getByRole('tab', { name: 'Tasks', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="panel-attention"]')).toBeNull()
})

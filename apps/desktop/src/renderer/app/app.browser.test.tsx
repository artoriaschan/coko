import '../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@coko/ui'
import { App } from './app.tsx'
import { createAppearanceStore } from './appearance-store.ts'
import { createConnectionStore } from './connection-store.ts'
import { createPreferences } from './preferences.ts'
import { createSettingsDialogStore } from './settings-dialog-store.ts'
import { createFixtureChat } from '../testing/fixture-chat.ts'

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
    if (!text || !parent || parent.closest(USER_CONTENT) || parent.closest('script, style')) continue
    out.push(text)
  }
  for (const el of root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')) {
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

const CJK = /[\u3400-\u9fff]/

function renderApp(locale: Locale = 'zh', options: { providers?: boolean } = {}) {
  const store = createAppearanceStore({ theme: 'light', locale })
  const connection = createConnectionStore()
  const { chat, settings, backend, api } = createFixtureChat(options)
  const settingsDialog = createSettingsDialogStore()
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
          settingsDialog={settingsDialog}
          pickDirectory={async () => null}
        />
      </div>,
    ),
  }
}

async function openSettings(name: RegExp | string) {
  await page.getByRole('button', { name }).first().click()
  return page.getByRole('dialog')
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
    await expect.element(page.getByRole('button', { name: '新会话' })).toBeVisible()

    const dialog = await openSettings('设置')
    await dialog.getByRole('radio', { name: 'English' }).click()
    await expect.element(dialog.getByRole('heading', { name: 'General' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(backend.settings.get('locale')?.value).toBe('en'))

    await expect.element(page.getByRole('button', { name: 'New session' })).toBeVisible()
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

describe('Sidecar 连接状态', () => {
  it('骨架中显示连接阶段，文案随界面语言切换', async () => {
    await page.viewport(1280, 800)
    const { store, connection, screen } = renderApp('zh')
    await screen
    const status = page.getByRole('status')
    await expect.element(status).toHaveAttribute('data-connection', 'connecting')
    await expect.element(status).toHaveTextContent('正在连接 Sidecar')

    connection.set({ phase: 'connected' })
    await expect.element(status).toHaveAttribute('data-connection', 'connected')
    await expect.element(status).toHaveTextContent('Sidecar 已连接')
    store.setLocale('en')
    await expect.element(status).toHaveTextContent('Sidecar connected')
    await expect.element(page.getByRole('button', { name: 'New session' })).toBeVisible()
  })

  it('启动失败时覆盖对话区，显示失败说明与原样的错误详情', async () => {
    await page.viewport(1280, 800)
    const { connection, screen } = renderApp('en')
    await screen
    connection.set({ phase: 'failed', code: 'fixture-fatal', message: 'boom' })
    await expect.element(page.getByRole('status')).toHaveAttribute('data-connection', 'failed')
    await expect.element(page.getByRole('status')).toHaveTextContent('Sidecar failed to start')
    const detail = document.querySelector('[data-error-code]')
    expect(detail?.getAttribute('data-error-code')).toBe('fixture-fatal')
    expect(detail?.textContent).toBe('boom (fixture-fatal)')
    // 失败覆盖层盖住消息与输入区，标题行的连接指示与侧栏仍可见。
    const hit = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    const composer = page.getByRole('textbox', { name: 'Give Coko a task' }).element()
    expect(composer.contains(hit(composer))).toBe(false)
    const statusEl = page.getByRole('status').element()
    expect(statusEl.contains(hit(statusEl))).toBe(true)
    const newSession = page.getByRole('button', { name: 'New session' }).element()
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
    expect(getComputedStyle(sidebar).backgroundColor).toBe('rgb(27, 27, 28)')
  })
})

describe('设置弹窗', () => {
  it.each(['zh', 'en'] as const)('%s：各分区的文案都来自字典；⌘, 打开，Escape 关闭并把焦点还给页面', async (locale) => {
    await page.viewport(1280, 800)
    await renderApp(locale).screen
    await expect.element(page.getByRole('button', { name: dictionaries[locale].sidebar.newSession })).toBeVisible()
    await userEvent.keyboard('{Meta>},{/Meta}')
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    const inDictionary = dictionaryMatcher(locale)
    const openSection = async (section: 'general' | 'models' | 'about') => {
      await dialog.getByRole('button', { name: dictionaries[locale].settings[section], exact: true }).click()
      // 对话框标题之后是分区标题。
      await expect.element(dialog.getByRole('heading', { level: 2 }).last()).toBeVisible()
    }
    const untranslated = () => chromeStrings(dialog.element()).filter((s) => !inDictionary(s))
    await openSection('general')
    expect(untranslated()).toEqual([])
    await openSection('models')
    // 同时检查新建表单。
    await dialog.getByRole('button', { name: dictionaries[locale].providers.add }).click()
    await page.getByRole('menuitem', { name: dictionaries[locale].providers.kinds.deepseek }).click()
    await expect.element(dialog.getByLabelText(dictionaries[locale].providers.credential, { exact: true })).toBeVisible()
    expect(untranslated()).toEqual([])
    await openSection('about')
    expect(untranslated()).toEqual([])
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('Models：新建 Provider 只回显末四位；Credential 失败时保留输入并转为编辑', async () => {
    await page.viewport(1280, 800)
    const { screen, backend } = renderApp('en', { providers: false })
    await screen
    const dialog = await openSettings('Settings')
    await dialog.getByRole('button', { name: 'Models', exact: true }).click()
    await expect.element(dialog.getByText('No Providers yet. Add one to start a conversation.')).toBeVisible()

    backend.setCredential.mockResolvedValueOnce({ ok: false, code: 'encryption-unavailable', message: 'no keychain' })
    await dialog.getByRole('button', { name: 'Add Provider' }).click()
    await page.getByRole('menuitem', { name: 'OpenAI compatible' }).click()
    await dialog.getByLabelText('Name', { exact: true }).fill('Local')
    await dialog.getByLabelText('Base URL', { exact: true }).fill('http://127.0.0.1:9/v1')
    await dialog.getByLabelText('Models', { exact: true }).fill('m1, m2')
    const secret = dialog.getByLabelText('Credential', { exact: true })
    await secret.fill('sk-browser-test-9876')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect.element(dialog.getByRole('alert')).toHaveTextContent('System encryption is unavailable. The Credential was not saved.')
    await expect.element(secret).toHaveValue('sk-browser-test-9876')
    expect(backend.providers).toHaveLength(1)
    // 再次保存是编辑同一个 Provider，不会重复创建。
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.element(page.elementLocator(dialog.element().querySelector('[data-provider-id]')!)).toBeVisible()
    expect(backend.providers).toHaveLength(1)
    await expect
      .element(page.elementLocator(dialog.element().querySelector('[data-credential-status="configured"]')!))
      .toHaveTextContent('Configured · ends in 9876')
    expect(dialog.element().textContent).not.toContain('sk-browser-test')
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
    await expect.element(page.getByRole('heading', { level: 1, name: 'New session' })).toBeVisible()
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

  it('对话框打开时 Escape 只关闭对话框，不停止 Run', async () => {
    await page.viewport(1280, 800)
    const { chat, api, screen } = renderApp('en')
    await screen
    const abort = vi.spyOn(api, 'abortRun')
    chat.getState().openSession('s-2')
    await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible()
    await userEvent.keyboard('{Meta>},{/Meta}')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(abort).not.toHaveBeenCalled()
    // 对话框关闭后，下一次 Escape 才停止。
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
    const dialog = page.getByRole('dialog')
    await expect.element(dialog.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(composer).toHaveTextContent('keep this draft')
  })

  it('输入区显示当前会话的模型，可按 Provider 分组切换', async () => {
    await page.viewport(1280, 800)
    const { screen, chat, settings, backend } = renderApp('en')
    await screen
    await backend.api.createProvider({ name: 'Second', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', models: ['big-model'] })
    await settings.getState().load()
    await expect.poll(() => chat.getState().activeSessionId).toBe('s-1')
    const picker = page.getByRole('button', { name: /^Choose model: / })
    await expect.element(picker).toHaveTextContent('faux-1')
    await picker.click()
    await expect.element(page.getByRole('menu').getByText('Fixture')).toBeVisible()
    await expect.element(page.getByRole('menu').getByText('Second')).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'big-model' }).click()
    await expect.element(picker).toHaveTextContent('big-model')
    expect(chat.getState().sessions.find((s) => s.id === 's-1')?.model).toEqual({ providerId: 'p2', modelId: 'big-model' })
  })
})

describe('窄窗口', () => {
  it('390px：无整页横向滚动，rail 与发送入口在视口内', async () => {
    await page.viewport(390, 700)
    await renderApp('en').screen
    await expect.poll(() => document.querySelector('[data-slot="app-frame"]')?.getAttribute('data-sidebar')).toBe('rail')
    await expect.poll(() => document.querySelector('[data-streamdown="table"]') !== null).toBe(true)

    const doc = document.documentElement
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth)
    const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    // 代码、表格等列对齐内容只能在自身区域内横向滚动；KaTeX 的 MathML 副本始终被裁剪为 1px，只供读屏使用。
    // Markdown 插件异步渲染，轮询到布局稳定后再判定。
    const overflowing = () =>
      [...main.querySelectorAll<HTMLElement>('*')]
        .filter((el) => !el.closest('pre, [data-streamdown="table-wrapper"], [data-streamdown="code-block-body"], .katex-mathml'))
        .filter((el) => el.getBoundingClientRect().right > 390.5)
        .map((el) => el.outerHTML.slice(0, 80))
    await expect.poll(overflowing, { timeout: 5000 }).toEqual([])

    for (const name of ['Expand sidebar', 'New session', 'Send']) {
      const rect = page.getByRole('button', { name }).element().getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(390)
    }
  })

  it('rail 展开的抽屉中可以选择会话，选择后抽屉关闭', async () => {
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

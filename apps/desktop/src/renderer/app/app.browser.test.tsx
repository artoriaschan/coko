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
import { catalogModel, customProvider } from '../testing/fake-settings.ts'
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
    await dialog.getByLabelText(dictionaries[locale].providers.protocol, { exact: true }).click()
    await expect.element(page.getByRole('menuitemradio').first()).toBeVisible()
    expect(chromeStrings(page.getByRole('menu').element()).filter((s) => !inDictionary(s))).toEqual([])
    await userEvent.keyboard('{Escape}')
    await openSection('about')
    expect(untranslated()).toEqual([])
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('Models：新建 Provider 只回显末四位；加密不可用时整次提交被拒绝，什么都不保存，表单保留草稿', async () => {
    await page.viewport(1280, 800)
    const { screen, backend } = renderApp('en', { providers: false })
    await screen
    const dialog = await openSettings('Settings')
    await dialog.getByRole('button', { name: 'Model services', exact: true }).click()
    await expect.element(dialog.getByText('No Providers yet. Add one to start a conversation.')).toBeVisible()

    backend.saveProvider.mockResolvedValueOnce({ ok: false, code: 'encryption-unavailable', message: 'no keychain' })
    await dialog.getByRole('button', { name: 'Add Provider' }).click()
    await dialog.getByLabelText('Provider ID', { exact: true }).fill('custom-provider-1')
    await dialog.getByLabelText('Name', { exact: true }).fill('Local')
    await dialog.getByLabelText('Base URL', { exact: true }).fill('http://127.0.0.1:9/v1')
    await dialog.getByRole('textbox', { name: 'Models', exact: true }).fill('m1, m2')
    const secret = dialog.getByLabelText('Credential', { exact: true })
    await secret.fill('sk-browser-test-9876')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect.element(dialog.getByRole('alert')).toHaveTextContent(dictionaries.en.providers.credentialErrors['encryption-unavailable'])
    await expect.element(secret).toHaveValue('sk-browser-test-9876')
    await expect.element(dialog.getByLabelText('Provider ID', { exact: true })).toHaveValue('custom-provider-1')
    expect(backend.providers).toEqual([])
    expect(dialog.element().querySelector('[data-provider-id]')).toBeNull()
    // 重试仍是新建，一次提交配置、目录与 Key。
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => dialog.element().querySelector('[data-provider-id]')).not.toBeNull()
    expect(backend.saveProvider).toHaveBeenLastCalledWith({
      mode: 'create',
      provider: expect.objectContaining({ id: 'custom-provider-1', models: [expect.objectContaining({ id: 'm1' }), expect.objectContaining({ id: 'm2' })] }),
      secret: 'sk-browser-test-9876',
    })
    expect(backend.providers).toHaveLength(1)
    await expect
      .element(page.elementLocator(dialog.element().querySelector('[data-credential-status="configured"]')!))
      .toHaveTextContent('Configured · ends in 9876')
    expect(dialog.element().textContent).not.toContain('sk-browser-test')
  })
})

describe('侧栏搜索', () => {
  const visibleTitles = () => [...document.querySelectorAll('[data-session-id]')].map((el) => el.textContent?.trim())

  it('搜索按钮打开输入框，按标题过滤会话（不区分大小写），无结果时说明；Escape 清除并关闭', async () => {
    await page.viewport(1280, 800)
    const { screen } = renderApp('en')
    await screen
    await expect.poll(() => visibleTitles().length).toBeGreaterThan(3)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const input = page.getByRole('searchbox', { name: 'Search sessions' })
    await expect.element(input).toHaveFocus()
    await userEvent.keyboard('SIDECAR')
    await expect.poll(visibleTitles).toEqual(['Sidecar startup handshake'])
    // 没有命中会话的工作区不显示。
    expect(document.querySelector('[aria-labelledby="workspace-w-pi"]')).toBeNull()
    await input.fill('no such session')
    await expect.poll(visibleTitles).toEqual([])
    await expect.element(page.getByText('No matching sessions')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(input).not.toBeInTheDocument()
    await expect.poll(() => visibleTitles().length).toBeGreaterThan(3)
  })

  it('rail 中的搜索按钮展开侧栏并聚焦搜索框', async () => {
    await page.viewport(800, 700)
    await renderApp('en').screen
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Sidebar' })
    await expect.element(drawer.getByRole('searchbox', { name: 'Search sessions' })).toHaveFocus()
    await userEvent.keyboard('ripgrep')
    await expect.poll(visibleTitles).toEqual(['ripgrep contract tests'])
  })
})

describe('Models 分区', () => {
  it('新建：输入 Provider ID 并选择三种协议之一（默认 OpenAI Chat Completions）；ID 不合格式、重复或未填 Key 时不提交', async () => {
    await page.viewport(1280, 800)
    const { screen, backend, settings } = renderApp('zh', { providers: false })
    await screen
    backend.seedProvider(customProvider('custom-provider-1', ['custom-model-1'], { name: '自定义供应商一' }))
    await settings.getState().load()
    const dialog = await openSettings('设置')
    await dialog.getByRole('button', { name: '模型服务', exact: true }).click()
    // 列表项显示名称与 Provider ID，没有类别标签。
    await expect.poll(() => dialog.element().querySelector('[data-provider-id="custom-provider-1"]')?.textContent).toContain('自定义供应商一custom-provider-1')

    await dialog.getByRole('button', { name: '添加 Provider' }).click()
    const protocol = dialog.getByLabelText('API 协议', { exact: true })
    await expect.element(protocol).toHaveTextContent('OpenAI Chat Completions')
    await protocol.click()
    expect([...document.querySelectorAll('[role="menuitemradio"]')].map((el) => el.textContent)).toEqual([
      'OpenAI Chat Completions',
      'OpenAI Responses',
      'Anthropic Messages',
    ])
    await page.getByRole('menuitemradio', { name: 'Anthropic Messages' }).click()
    await expect.element(protocol).toHaveTextContent('Anthropic Messages')

    await dialog.getByLabelText('名称', { exact: true }).fill('自定义供应商二')
    await dialog.getByLabelText('地址', { exact: true }).fill('https://gateway.example')
    await dialog.getByRole('textbox', { name: '模型', exact: true }).fill('custom-model-2')
    const id = dialog.getByLabelText('Provider ID', { exact: true })
    for (const [value, message] of [
      ['Custom-2', dictionaries.zh.providers.idInvalid],
      ['custom-provider-1', dictionaries.zh.providers.idTaken],
      ['custom-provider-2', dictionaries.zh.providers.credentialRequired],
    ] as const) {
      await id.fill(value)
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect.element(dialog.getByRole('alert')).toHaveTextContent(message)
    }
    expect(backend.saveProvider).not.toHaveBeenCalled()

    await dialog.getByLabelText('Credential', { exact: true }).fill('sk-new-provider-2222')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect.poll(() => dialog.element().querySelector('[data-provider-id="custom-provider-2"]')).not.toBeNull()
    expect(backend.providers.find((p) => p.id === 'custom-provider-2')).toMatchObject({
      name: '自定义供应商二',
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example',
      models: [{ id: 'custom-model-2', contextWindow: 128_000, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] }],
      credential: { hint: '2222' },
    })
    expect(backend.saveProvider).toHaveBeenCalledTimes(1)
  })

  it('编辑：ID 为静态文本；修改协议与目录后保存，已有模型的能力配置保留；留空 Key 不改 Credential；删除后从列表移除', async () => {
    await page.viewport(1280, 800)
    const { screen, backend, settings } = renderApp('en', { providers: false })
    await screen
    const rich = catalogModel('custom-model-1', {
      contextWindow: 1_000_000,
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevels: [{ level: 'high', value: 'high' }],
    })
    backend.seedProvider({ ...customProvider('custom-provider-2', []), name: 'Custom two', models: [rich] }, 'sk-existing-key-5555')
    await settings.getState().load()
    const dialog = await openSettings('Settings')
    await dialog.getByRole('button', { name: 'Model services', exact: true }).click()
    await dialog.getByRole('button', { name: 'Edit' }).click()
    await expect.poll(() => dialog.element().querySelector('[data-provider-form]')?.textContent).toContain('Custom twocustom-provider-2')
    expect(dialog.element().querySelector('[data-provider-form] input[name="providerId"]')).toBeNull()

    await dialog.getByLabelText('API protocol', { exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'OpenAI Responses' }).click()
    await dialog.getByRole('textbox', { name: 'Models', exact: true }).fill('custom-model-1, custom-model-3')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => dialog.element().querySelector('[data-provider-form]')).toBeNull()
    expect(backend.providers).toMatchObject([
      { id: 'custom-provider-2', api: 'openai-responses', models: [rich, catalogModel('custom-model-3')], credential: { hint: '5555' } },
    ])
    // Key 留空：一次提交不带 secret，原 Credential 保留。
    expect(backend.saveProvider).toHaveBeenCalledWith({
      mode: 'update',
      provider: expect.objectContaining({ id: 'custom-provider-2', api: 'openai-responses' }),
    })
    expect(backend.saveProvider.mock.calls[0]![0]).not.toHaveProperty('secret')

    await dialog.getByRole('button', { name: 'Delete' }).click()
    await dialog.getByRole('button', { name: 'Confirm delete' }).click()
    await expect.element(dialog.getByText('No Providers yet. Add one to start a conversation.')).toBeVisible()
    expect(backend.providers).toEqual([])
  })

  it('保存失败时显示可行动的本地化说明，技术原文只在详情中', async () => {
    await page.viewport(1280, 800)
    const { screen, backend } = renderApp('en', { providers: false })
    await screen
    backend.saveProvider.mockResolvedValueOnce({ ok: false, code: 'bad-request', message: 'Invalid request: /baseUrl must match format "uri"' })
    const dialog = await openSettings('Settings')
    await dialog.getByRole('button', { name: 'Model services', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add Provider' }).click()
    await dialog.getByLabelText('Provider ID', { exact: true }).fill('local')
    await dialog.getByLabelText('Name', { exact: true }).fill('Local')
    await dialog.getByLabelText('Base URL', { exact: true }).fill('http://127.0.0.1:9/v1')
    await dialog.getByRole('textbox', { name: 'Models', exact: true }).fill('m1')
    await dialog.getByLabelText('Credential', { exact: true }).fill('sk-local-key-0001')
    await dialog.getByRole('button', { name: 'Save' }).click()
    const alert = dialog.getByRole('alert')
    await expect.element(alert).toHaveTextContent(dictionaries.en.providers.errors.invalid)
    expect(alert.element().textContent).not.toContain('Invalid request')
    // 技术原文放在可展开的详情中，可选中复制。
    const details = dialog.element().querySelector('[data-error-detail]')
    expect(details?.textContent).toContain('Invalid request: /baseUrl must match format "uri"')
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
    backend.seedProvider(customProvider('p2', ['big-model'], { name: 'Second' }))
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
    const picker = page.getByRole('button', { name: /^选择模型：/ })
    const levelItems = () => [...document.querySelectorAll('[data-thinking-level]')].map((el) => [el.textContent, el.getAttribute('aria-checked')])
    const choose = async (name: string) => {
      await picker.click()
      await page.getByRole('menuitemradio', { name, exact: true }).click()
    }

    // 没有推理档位的模型（faux-1）不显示档位选项。
    await picker.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    expect(levelItems()).toEqual([])
    await userEvent.keyboard('{Escape}')

    await choose('thinker')
    await picker.click()
    await expect.element(page.getByRole('menu').getByText('推理档位')).toBeVisible()
    // 固定顺序；新会话的档位为“关闭”；未配置的档位不出现。
    expect(levelItems()).toEqual([
      ['关闭', 'true'],
      ['medium', 'false'],
      ['high', 'false'],
    ])
    await page.getByRole('menuitemradio', { name: 'high', exact: true }).click()
    await expect.poll(() => chat.getState().sessions.find((s) => s.id === 's-1')).toMatchObject({ model: { modelId: 'thinker' }, thinkingLevel: 'high' })
    // 触发按钮显示模型名称与当前档位。
    await expect.poll(() => picker.element().textContent).toBe('thinkerhigh')

    // 换到未配置 high 的模型：回到“关闭”。
    await choose('low-only')
    await expect.poll(() => chat.getState().sessions.find((s) => s.id === 's-1')).toMatchObject({ model: { modelId: 'low-only' }, thinkingLevel: 'off' })
    await picker.click()
    await expect.poll(levelItems).toEqual([
      ['关闭', 'true'],
      ['low', 'false'],
    ])
    await userEvent.keyboard('{Escape}')

    // 推理开关关闭的模型只有“关闭”，不显示档位选项。
    await choose('switched-off')
    await picker.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    expect(levelItems()).toEqual([])
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

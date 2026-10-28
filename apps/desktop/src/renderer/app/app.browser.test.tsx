import '../styles.css'
import { dictionaries, type Locale } from '@coko/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@coko/ui'
import { App } from './app.tsx'
import { createAppearanceStore } from './appearance-store.ts'

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

function renderApp(locale: Locale = 'zh') {
  const store = createAppearanceStore({ theme: 'light', locale })
  return {
    store,
    screen: render(
      <div style={{ width: '100vw', height: '100vh' }}>
        <App store={store} />
      </div>,
    ),
  }
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
  it('从外观菜单切换语言后文案即时更新，并显示 Toast', async () => {
    await page.viewport(1280, 800)
    const { screen } = renderApp('zh')
    await screen
    await expect.element(page.getByRole('button', { name: '新会话' })).toBeVisible()

    await page.getByRole('button', { name: '外观与语言' }).click()
    await page.getByRole('menuitemradio', { name: 'English' }).click()

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
    await expect.element(page.getByRole('textbox', { name: 'Give Coko a task' })).toHaveValue('保留这段草稿')
  })
})

describe('主题', () => {
  it('从外观菜单切换到深色主题', async () => {
    await page.viewport(1280, 800)
    await renderApp('en').screen
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(255, 255, 255)')

    await page.getByRole('button', { name: 'Appearance and language' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(21, 21, 23)')
    const sidebar = document.querySelector('[data-slot="app-frame-sidebar"]')!
    expect(getComputedStyle(sidebar).backgroundColor).toBe('rgb(27, 27, 28)')
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
    await drawer.getByRole('button', { name: 'Sidecar startup handshake' }).click()
    await expect.element(drawer).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Sidecar startup handshake' })).toBeVisible()
  })
})

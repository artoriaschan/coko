import '../styles/theme.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ComposerEditor, type ComposerEditorProps } from './composer-editor.tsx'
import { ComposerTypeahead, type ComposerTypeaheadItem } from './composer-typeahead.tsx'

const ITEMS: ComposerTypeaheadItem[] = [
  { key: 'review', label: '/review', hint: '<path>', description: 'Review a path', group: 'project' },
  { key: 'git:commit', label: '/git:commit', description: 'Write a commit message', group: 'project' },
  { key: 'hello', label: '/hello', hint: '<name>', description: 'Greet someone', group: 'user' },
]
const GROUPS = [
  { id: 'builtin', label: 'Built-in' },
  { id: 'project', label: 'Project' },
  { id: 'user', label: 'User' },
]
const getItems = (query: string) => ITEMS.filter((item) => item.key.startsWith(query))
const onSelect = (item: ComposerTypeaheadItem) => `/${item.key} `

type Submit = ComposerEditorProps['onSubmit']

async function setup() {
  const onSubmit = vi.fn<Submit>(() => true)
  const onEscape = vi.fn<() => void>()
  await render(
    <div style={{ width: 480, padding: '320px 16px 16px' }}>
      <ComposerEditor label="Task" placeholder="Give Coko a task" onSubmit={onSubmit} onEscape={onEscape}>
        <ComposerTypeahead trigger="/" position="start" getItems={getItems} groups={GROUPS} onSelect={onSelect} label="Commands" />
      </ComposerEditor>
    </div>,
  )
  return { onSubmit, onEscape }
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const root = () => editor().element() as HTMLElement
const menu = () => document.querySelector<HTMLElement>('[role="listbox"][aria-label="Commands"]')
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent ?? null
const text = () => root().textContent

/** 合成按键事件：keyCode 不在 KeyboardEventInit 标准字段中，事后定义只读属性。 */
function keydown(target: HTMLElement, init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ComposerTypeahead', () => {
  it('草稿开头输入 / 打开分组菜单，焦点留在编辑区并以 aria-activedescendant 指向选中项；↑↓ 循环移动', async () => {
    await setup()
    await editor().click()
    await userEvent.keyboard('/')
    await expect.poll(() => options().length).toBe(3)
    expect(menu()).not.toBeNull()
    expect([...menu()!.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('data-group'))).toEqual(['project', 'user'])
    expect(document.activeElement).toBe(root())
    expect(root().getAttribute('aria-controls')).toBe(menu()!.id)
    expect(selected()).toContain('/review')
    expect(root().getAttribute('aria-activedescendant')).toBe(options()[0]!.id)

    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toContain('/git:commit')
    expect(root().getAttribute('aria-activedescendant')).toBe(options()[1]!.id)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(selected()).toContain('/review')
    await userEvent.keyboard('{ArrowUp}')
    expect(selected()).toContain('/hello')
    expect(document.activeElement).toBe(root())
  })

  it('Enter 确认：插入 "/name " 且不提交；之后 Enter 照常提交', async () => {
    const { onSubmit } = await setup()
    await editor().click()
    await userEvent.keyboard('/he')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => menu()).toBeNull()
    expect(text()).toBe('/hello ')
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('Ann{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/hello Ann')
  })

  it('菜单打开后连续输入再按 Enter：整个 token（含尚未渲染的查询）被替换', async () => {
    await setup()
    await editor().click()
    await userEvent.keyboard('/')
    await expect.poll(() => options().length).toBe(3)
    await userEvent.keyboard('rev{Enter}')
    await expect.poll(() => text()).toBe('/review ')
  })

  it('Tab 确认选中项', async () => {
    await setup()
    await editor().click()
    await userEvent.keyboard('/')
    await expect.poll(() => options().length).toBe(3)
    await userEvent.keyboard('{ArrowDown}{Tab}')
    await expect.poll(() => text()).toBe('/git:commit ')
    expect(menu()).toBeNull()
  })

  it('Esc 关闭且草稿不变、不触发编辑区的 Esc；同一 token 继续输入不再弹出；删掉 token 后重新输入 / 再次弹出', async () => {
    const { onEscape } = await setup()
    await editor().click()
    await userEvent.keyboard('/re')
    await expect.poll(() => options().length).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => menu()).toBeNull()
    expect(text()).toBe('/re')
    expect(onEscape).not.toHaveBeenCalled()
    await userEvent.keyboard('v')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(menu()).toBeNull()
    expect(text()).toBe('/rev')
    // 菜单已关闭：Esc 交给编辑区。
    await userEvent.keyboard('{Escape}')
    expect(onEscape).toHaveBeenCalledOnce()
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}/')
    await expect.poll(() => options().length).toBe(3)
  })

  it('不在草稿开头的 / 不触发；没有匹配的查询不打开菜单，Enter 照常提交', async () => {
    const { onSubmit } = await setup()
    await editor().click()
    await userEvent.keyboard('see /re')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(menu()).toBeNull()
    await userEvent.keyboard('{Backspace>7/}/zzz')
    expect(text()).toBe('/zzz')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(menu()).toBeNull()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/zzz')
  })

  it('输入法组合期间不打开菜单；组合中的 Enter（Chrome isComposing、Safari keyCode 229）不确认也不提交', async () => {
    const { onSubmit } = await setup()
    await editor().click()
    const el = root()
    // 真实的输入法组合（Chromium CDP）：组合中的 "/" 已在编辑区内，但菜单不出现。
    const session = cdp() as { send(method: string, params?: object): Promise<unknown> }
    await session.send('Input.imeSetComposition', { text: '/', selectionStart: 1, selectionEnd: 1 })
    // 组合期间 Lexical 在组合文本旁放一个零宽空格。
    await expect.poll(() => text()?.replace(/\u200b/g, '')).toBe('/')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(menu()).toBeNull()
    await session.send('Input.insertText', { text: '' })
    // 组合结束后照常打开菜单；菜单打开时到达的输入法 Enter 不确认选中项、也不提交。
    await userEvent.keyboard('{Backspace>3/}/r')
    expect(text()).toBe('/r')
    await expect.poll(() => options().length).toBe(1)
    keydown(el, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    keydown(el, { key: 'Enter', code: 'Enter', isComposing: false, keyCode: 229 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(menu()).not.toBeNull()
    expect(text()).toBe('/r')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('指针选择：点击选项插入且焦点仍在编辑区；菜单在编辑区上方且不越出窗口', async () => {
    await setup()
    await editor().click()
    await userEvent.keyboard('/')
    await expect.poll(() => options().length).toBe(3)
    const panel = document.querySelector<HTMLElement>('[data-slot="composer-typeahead"]')!
    await expect.poll(() => panel.getBoundingClientRect().height).toBeGreaterThan(0)
    const rect = panel.getBoundingClientRect()
    expect(rect.bottom).toBeLessThanOrEqual(root().getBoundingClientRect().top)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
    await userEvent.click(options()[2]!)
    await expect.poll(() => text()).toBe('/hello ')
    expect(document.activeElement).toBe(root())
    expect(menu()).toBeNull()
  })
})

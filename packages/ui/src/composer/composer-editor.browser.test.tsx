import '../styles/theme.css'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ComposerEditor, type ComposerEditorHandle, type ComposerEditorProps } from './composer-editor.tsx'

type Submit = ComposerEditorProps['onSubmit']

function Harness({ onSubmit, onEscape, handle }: { onSubmit: Submit; onEscape?: () => void; handle?: React.Ref<ComposerEditorHandle> }) {
  return (
    <div style={{ width: 480, padding: 16 }}>
      <ComposerEditor ref={handle} label="Task" placeholder="Give Coko a task" onSubmit={onSubmit} onEscape={onEscape} />
    </div>
  )
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const editorElement = () => editor().element() as HTMLElement

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

describe('ComposerEditor', () => {
  it('Enter 提交去掉首尾空白的文本，成功后清空', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().fill('  write a greeting  ')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('write a greeting')
    await expect.poll(() => editorElement().textContent).toBe('')
  })

  it('Shift+Enter 换行不提交；随后 Enter 提交多行文本', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().click()
    await userEvent.keyboard('first')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('second')
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('first\nsecond')
  })

  it('空白内容按 Enter 不提交', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().fill('   ')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('IME 组合期间（Chrome：compositionend 之前的 Enter）不提交', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().fill('ni')
    const root = editorElement()
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    keydown(root, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(root.textContent).toContain('ni')
  })

  it('IME 确认候选的 Enter（Safari：compositionend 之后、keyCode 229）不提交', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().fill('你好')
    const root = editorElement()
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    keydown(root, { key: 'Enter', code: 'Enter', isComposing: false, keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()
    // 组合结束后的普通 Enter 照常提交。
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('你好')
  })

  it('提交失败时保留输入', async () => {
    const onSubmit = vi.fn<Submit>(async () => false)
    await render(<Harness onSubmit={onSubmit} />)
    await editor().fill('keep me')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(editorElement().textContent).toBe('keep me')
  })

  it('Escape 调用 onEscape；handle.submit 与按钮共用同一提交路径', async () => {
    const onSubmit = vi.fn<Submit>(() => true)
    const onEscape = vi.fn<() => void>()
    const handle = React.createRef<ComposerEditorHandle>()
    await render(<Harness onSubmit={onSubmit} onEscape={onEscape} handle={handle} />)
    await editor().fill('from button')
    await userEvent.keyboard('{Escape}')
    expect(onEscape).toHaveBeenCalledOnce()
    await handle.current!.submit()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('from button')
    await expect.poll(() => editorElement().textContent).toBe('')
  })
})

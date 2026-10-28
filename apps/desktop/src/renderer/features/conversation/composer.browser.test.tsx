import '../../styles.css'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { I18nProvider } from '../../app/i18n.tsx'
import { Composer, type ComposerHandle, type ComposerProps } from './composer.tsx'

type Submit = ComposerProps['onSend']

function renderComposer(props: Partial<ComposerProps> & { handle?: React.Ref<ComposerHandle> }) {
  const onSend = vi.fn<Submit>(async () => true)
  const onSteer = vi.fn<Submit>(async () => true)
  const onStop = vi.fn<() => void>()
  const onPause = vi.fn<() => void>()
  const { handle, ...rest } = props
  const result = render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div style={{ width: 560, padding: 16 }}>
          <Composer
            ref={handle}
            running={false}
            disabled={false}
            needsSetup={false}
            onSend={onSend}
            onSteer={onSteer}
            onStop={onStop}
            onPause={onPause}
            onSetup={() => {}}
            {...rest}
          />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  return { result, onSend, onSteer, onStop, onPause }
}

const editor = () => page.getByRole('textbox', { name: 'Give Coko a task' })
const editorElement = () => editor().element() as HTMLElement
const action = (name: string) => document.querySelector('[data-action="' + name + '"]') as HTMLButtonElement | null

describe('Composer：Run 进行中', () => {
  it('编辑区可输入，Enter 调用 steer 而非 submit，成功后清空；暂停与停止并列', async () => {
    const h = renderComposer({ running: true })
    await h.result
    expect(action('pause')).not.toBeNull()
    expect(action('stop')).not.toBeNull()
    expect(action('send')).toBeNull()
    // 空输入时没有发送入口。
    expect(action('steer')).toBeNull()

    await editor().fill('  also check the README  ')
    expect(action('steer')).not.toBeNull()
    await userEvent.keyboard('{Enter}')
    expect(h.onSteer).toHaveBeenCalledExactlyOnceWith('also check the README')
    expect(h.onSend).not.toHaveBeenCalled()
    expect(h.onStop).not.toHaveBeenCalled()
    await expect.poll(() => editorElement().textContent).toBe('')

    action('pause')!.click()
    expect(h.onPause).toHaveBeenCalledOnce()
    action('stop')!.click()
    expect(h.onStop).toHaveBeenCalledOnce()
  })

  it('发送按钮在 Run 中也走 steer；steer 被拒时保留输入', async () => {
    const h = renderComposer({ running: true, onSteer: vi.fn<Submit>(async () => false) })
    await h.result
    await editor().fill('keep me')
    action('steer')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(editorElement().textContent).toBe('keep me')
  })

  it('IME 组合中按 Enter 不提交追加指令', async () => {
    const h = renderComposer({ running: true })
    await h.result
    await editor().fill('ni')
    const root = editorElement()
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', isComposing: true })
    Object.defineProperty(event, 'keyCode', { value: 229 })
    root.dispatchEvent(event)
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    expect(h.onSteer).not.toHaveBeenCalled()
    expect(root.textContent).toContain('ni')
  })

  it('暂停请求中暂停按钮禁用', async () => {
    const paused = renderComposer({ running: true, pausing: true })
    await paused.result
    expect(action('pause')!.disabled).toBe(true)
    expect(action('pause')!.getAttribute('aria-label')).toBe('Pausing after the current step')
  })

  it('没有 Run 时 Enter 照常 submit，不显示暂停', async () => {
    const idle = renderComposer({ running: false })
    await idle.result
    expect(action('pause')).toBeNull()
    await editor().fill('hello')
    await userEvent.keyboard('{Enter}')
    expect(idle.onSend).toHaveBeenCalledExactlyOnceWith('hello')
    expect(idle.onSteer).not.toHaveBeenCalled()
  })

  it('restore 把退回的文本放回编辑区，接在已有草稿之前', async () => {
    const handle = React.createRef<ComposerHandle>()
    const h = renderComposer({ running: false, handle })
    await h.result
    await editor().fill('my draft')
    handle.current!.restore('first\nsecond')
    await expect.poll(() => editorElement().innerText.replace(/\n+/g, '|')).toBe('first|second|my draft')
    await userEvent.keyboard('{Enter}')
    expect(h.onSend).toHaveBeenCalledExactlyOnceWith('first\nsecond\nmy draft')
  })
})

import '../../styles.css'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { I18nProvider } from '../../app/i18n.tsx'
import { createContextStore } from '../../stores/context-store.ts'
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

describe('Composer：双层输入区', () => {
  it('粘贴与拖入文件沿用引用节点，工作目录前缀相似的外部路径不误判', async () => {
    const h = renderComposer({ fileWorkspacePath: '/work', getFilePath: (file) => (file.name === 'a.ts' ? '/work/a.ts' : '/workspace/b.txt') })
    await h.result
    const paste = new DataTransfer()
    paste.items.add(new File(['a'], 'a.ts', { type: 'text/plain' }))
    editorElement().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: paste }))
    await expect.poll(() => editorElement().textContent).toContain('@a.ts')
    const drop = new DataTransfer()
    drop.items.add(new File(['b'], 'b.txt', { type: 'text/plain' }))
    editorElement().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: drop }))
    await expect.poll(() => editorElement().textContent).toContain('/workspace/b.txt')
    expect(editorElement().querySelectorAll('[data-file-reference]')).toHaveLength(1)
    const image = new DataTransfer()
    image.items.add(new File(['png'], 'paste.png', { type: 'image/png' }))
    editorElement().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: image }))
    await expect.element(page.getByRole('alert')).toHaveTextContent('Image attachments are not available yet')
    expect(editorElement().textContent).not.toContain('paste.png')
  })
  it('系统选择插入 Workspace 内 File Reference 与外部绝对路径，图片拒绝并保留草稿', async () => {
    const picks = ['/work/src/a.ts', '/outside/notes.txt', '/work/image.png']
    const h = renderComposer({ fileWorkspacePath: '/work', pickFiles: async () => picks })
    await h.result
    await editor().fill('check ')
    await userEvent.click(page.getByRole('button', { name: 'Add attachment' }))
    await expect.poll(() => editorElement().textContent).toContain('@src/a.ts')
    expect(editorElement().querySelector('[data-file-reference="src/a.ts"]')).not.toBeNull()
    expect(editorElement().textContent).toContain('/outside/notes.txt')
    expect(editorElement().textContent).not.toContain('image.png')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Image attachments are not available yet')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => h.onSend.mock.calls.length).toBe(1)
    expect(h.onSend.mock.calls[0]?.[0]).toContain('@src/a.ts')
  })
  it('主输入框基准高 120px，控件依序位于底部的 32px 工具栏', async () => {
    const screen = await renderComposer({
      permissionControl: <button data-test="permission">Permissions</button>,
      planChip: <span data-test="plan">Plan</span>,
      accessory: <button data-test="model">Model</button>,
    }).result
    const form = screen.container.querySelector('form')!
    const toolbar = form.querySelector('[data-slot="composer-toolbar"]')!
    expect(form.getBoundingClientRect().height).toBe(120)
    const placeholder = form.querySelector('[data-slot="composer-placeholder"]')!.getBoundingClientRect()
    expect(placeholder.left - form.getBoundingClientRect().left).toBe(12)
    expect(placeholder.top - form.getBoundingClientRect().top).toBe(12)
    expect(toolbar?.getBoundingClientRect().height).toBe(32)
    const controls = ['[data-action="attach"]', '[data-test="permission"]', '[data-test="plan"]', '[data-test="model"]', '[data-action="send"]'].map(
      (selector) => toolbar.querySelector(selector)!,
    )
    expect(controls.every(Boolean)).toBe(true)
    const x = controls.map((node) => node.getBoundingClientRect().x)
    expect(x).toEqual([...x].sort((a, b) => a - b))
    expect(editorElement().getBoundingClientRect().bottom).toBeLessThanOrEqual(toolbar.getBoundingClientRect().top)
  })
})

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

describe('Composer：压缩状态行', () => {
  it('当前会话正在压缩时显示"正在压缩上下文…"与停止按钮（调用 onStop）；其他会话压缩时不显示', async () => {
    const contextStore = createContextStore(async () => {
      throw new Error('offline')
    })
    const h = renderComposer({ running: true, commandTarget: { sessionId: 's1' }, contextStore })
    await h.result
    expect(document.querySelector('[data-slot="compaction-status"]')).toBeNull()
    contextStore.setState({ compacting: { s2: true } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.querySelector('[data-slot="compaction-status"]')).toBeNull()
    contextStore.setState({ compacting: { s1: true } })
    const status = () => document.querySelector('[data-slot="compaction-status"]')
    await expect.poll(() => status()?.getAttribute('role')).toBe('status')
    expect(status()!.textContent).toContain('Compacting context…')
    expect(action('stop-compaction')?.textContent).toBe('Stop compacting')
    action('stop-compaction')!.click()
    expect(h.onStop).toHaveBeenCalledOnce()
    contextStore.setState({ compacting: {} })
    await expect.poll(() => document.querySelector('[data-slot="compaction-status"]')).toBeNull()
  })
})

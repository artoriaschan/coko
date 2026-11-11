import './theme.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '../components/button.tsx'
import { Checkbox } from '../components/checkbox.tsx'
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.tsx'
import { Input } from '../components/input.tsx'
import { Textarea } from '../components/textarea.tsx'
import { ToggleGroup, ToggleGroupItem } from '../components/toggle-group.tsx'
import { ToolCard } from '../tool-card/tool-card.tsx'
import { trackKeyboardFocus } from '../lib/focus-visible.ts'

/** ring token 的计算颜色：用同一 token 着色的探针元素读出。 */
function ringColor(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--ring)'
  document.body.append(probe)
  try {
    return getComputedStyle(probe).color
  } finally {
    probe.remove()
  }
}

/** 当前焦点与其焦点环；期望值为 Tab 键到达（:focus-visible）时的 2px 实线、ring 颜色。 */
function focusRing(element: Element | null) {
  if (element === null || document.activeElement !== element) return { focused: false }
  const style = getComputedStyle(element)
  return { focused: true, visible: element.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
}

const expectedRing = () => ({ focused: true, visible: true, style: 'solid', width: '2px', color: ringColor() })

let stopTracking: () => void
beforeEach(() => {
  stopTracking = trackKeyboardFocus(document)
})

afterEach(() => {
  stopTracking()
  document.body.replaceChildren()
})

describe('键盘焦点环', () => {
  it('鼠标点击单行、多行和富文本输入并输入文字时不显示焦点框，Tab 导航后才显示', async () => {
    await render(
      <div>
        <Input aria-label="Name" />
        <Textarea aria-label="Description" />
        <div contentEditable aria-label="Rich text" />
        <Button>Next</Button>
      </div>,
    )
    for (const input of document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable]')) {
      const border = getComputedStyle(input).borderColor
      await userEvent.click(input)
      expect(document.activeElement).toBe(input)
      expect(getComputedStyle(input).outlineStyle).toBe('none')
      expect(getComputedStyle(input).borderColor).toBe(border)
      await userEvent.keyboard('name')
      expect(getComputedStyle(input).outlineStyle).toBe('none')
    }
    await userEvent.tab()
    await expect.poll(() => focusRing(document.querySelector('button'))).toEqual(expectedRing())
  })

  it('Tab 聚焦后的控件被鼠标再次点击时立即隐藏焦点框', async () => {
    await render(<Button>Action</Button>)
    const button = document.querySelector('button')!
    await userEvent.tab()
    await expect.poll(() => focusRing(button)).toEqual(expectedRing())
    await userEvent.click(button)
    expect(document.activeElement).toBe(button)
    expect(getComputedStyle(button).outlineStyle).toBe('none')
  })

  it('自动聚焦不进入键盘焦点模式，Shift+Tab 可以显示焦点框', async () => {
    await render(
      <div>
        <Button>Previous</Button>
        <Input aria-label="Name" />
      </div>,
    )
    const input = document.querySelector<HTMLInputElement>('input')!
    input.focus()
    expect(getComputedStyle(input).outlineStyle).toBe('none')
    await userEvent.tab({ shift: true })
    await expect.poll(() => focusRing(document.querySelector('button'))).toEqual(expectedRing())
  })

  it('文档上的多个宿主共享输入方式，最后一个卸载后恢复原有状态并移除监听', () => {
    const isolated = document.implementation.createHTMLDocument()
    isolated.documentElement.setAttribute('data-focus-modality', 'original')
    const stopFirst = trackKeyboardFocus(isolated)
    const stopSecond = trackKeyboardFocus(isolated)
    try {
      isolated.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      expect(isolated.documentElement.getAttribute('data-focus-modality')).toBe('keyboard')
      stopFirst()
      isolated.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))
      expect(isolated.documentElement.getAttribute('data-focus-modality')).toBe('pointer')
      stopSecond()
      expect(isolated.documentElement.getAttribute('data-focus-modality')).toBe('original')
      isolated.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      isolated.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }))
      expect(isolated.documentElement.getAttribute('data-focus-modality')).toBe('original')
    } finally {
      stopFirst()
      stopSecond()
    }
  })

  it('共享控件经 Tab 聚焦后显示 ring 颜色的焦点环', async () => {
    await render(
      <div>
        <Button>Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Input aria-label="Name" />
        <Checkbox aria-label="Agree" />
        <ToggleGroup type="single" defaultValue="a" aria-label="Mode">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
        </ToggleGroup>
        <ToolCard icon={null} title="bash" summary="ls" status="done" statusLabel="Done">
          <p>body</p>
        </ToolCard>
      </div>,
    )
    const order = [
      document.querySelector('[data-variant="default"]'),
      document.querySelector('[data-variant="ghost"]'),
      document.querySelector('[data-slot="input"]'),
      document.querySelector('[data-slot="checkbox"]'),
      document.querySelector('[data-slot="toggle-group-item"][data-state="on"]'),
      document.querySelector('[data-slot="tool-card"] button'),
    ]
    expect(order.every((element) => element !== null)).toBe(true)
    for (const element of order) {
      await userEvent.tab()
      // transition-colors 会让焦点环颜色过渡，等过渡结束后再比较。
      await expect.poll(() => focusRing(element)).toEqual(expectedRing())
    }
  })

  it('对话框的关闭按钮经 Tab 聚焦后显示焦点环', async () => {
    await render(
      <Dialog open>
        <DialogContent closeLabel="Close" aria-describedby={undefined}>
          <DialogTitle>Title</DialogTitle>
          <Button>Inside</Button>
        </DialogContent>
      </Dialog>,
    )
    const close = document.querySelector('[data-slot="dialog-close"]')
    for (let i = 0; i < 3 && document.activeElement !== close; i++) await userEvent.tab()
    await expect.poll(() => focusRing(close)).toEqual(expectedRing())
  })
})

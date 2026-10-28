import './theme.css'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '../components/button.tsx'
import { Checkbox } from '../components/checkbox.tsx'
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.tsx'
import { Input } from '../components/input.tsx'
import { ToggleGroup, ToggleGroupItem } from '../components/toggle-group.tsx'
import { ToolCard } from '../tool-card/tool-card.tsx'

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

afterEach(() => {
  document.body.replaceChildren()
})

describe('键盘焦点环', () => {
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

import '../styles/theme.css'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { AppFrame, useAppFrame } from './app-frame.tsx'

const labels = { sidebar: 'Sidebar', main: 'Main', rightPanel: 'Right panel', resizeSidebar: 'Resize sidebar' }

function Toggle() {
  const { toggleSidebar, sidebarVisible } = useAppFrame()
  return (
    <button type="button" aria-expanded={sidebarVisible} onClick={toggleSidebar}>
      toggle
    </button>
  )
}

function Harness({ rightOpen = false, initialWidth = 280 }: { rightOpen?: boolean; initialWidth?: number }) {
  const [width, setWidth] = React.useState(initialWidth)
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AppFrame
        labels={labels}
        sidebar={
          <div>
            <Toggle />
            <a href="#s1">session one</a>
          </div>
        }
        rail={<Toggle />}
        rightOpen={rightOpen}
        rightPanel={<div>preview</div>}
        sidebarWidth={width}
        onSidebarWidthChange={setWidth}
        sidebarCollapsed={collapsed}
        onSidebarCollapsedChange={setCollapsed}
      >
        <div data-testid="content" style={{ width: 'min(100%, clamp(680px, 64cqi, 920px))' }}>
          content
        </div>
      </AppFrame>
    </div>
  )
}

const widthOf = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().width
const sidebarWidth = () => widthOf('[data-slot="app-frame-sidebar"]')

async function settle(predicate: () => boolean) {
  await expect.poll(predicate, { timeout: 2000 }).toBe(true)
}

beforeEach(() => {
  document.documentElement.classList.remove('dark')
})

afterEach(async () => {
  await page.viewport(1280, 800)
})

describe('AppFrame 侧栏宽度', () => {
  it('宽窗口默认 280px，键盘把宽度限制在 264–420', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 280)

    const handle = page.getByRole('separator', { name: 'Resize sidebar' })
    await handle.click()
    await userEvent.keyboard('{End}')
    await settle(() => sidebarWidth() === 420)
    await userEvent.keyboard('{ArrowRight}')
    await settle(() => sidebarWidth() === 420)
    await userEvent.keyboard('{Home}')
    await settle(() => sidebarWidth() === 264)
    await userEvent.keyboard('{ArrowLeft}')
    await settle(() => sidebarWidth() === 264)
    await expect.element(handle).toHaveAttribute('aria-valuenow', '264')
  })

  it('拖动分隔条改变宽度，越界时停在上限', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 280)
    const handle = document.querySelector<HTMLElement>('[data-slot="app-frame-resize-handle"]')!
    const x = handle.getBoundingClientRect().left + 4
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 60, clientY: 100 }))
    await settle(() => sidebarWidth() === 340)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 600, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 600, clientY: 100 }))
    await settle(() => sidebarWidth() === 420)
    // 松开后不再跟随指针
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x - 200, clientY: 100 }))
    expect(sidebarWidth()).toBe(420)
  })

  it('宽窗口下切换按钮在展开与 56px rail 之间切换', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 280)
    await page.getByRole('button', { name: 'toggle' }).click()
    await settle(() => sidebarWidth() === 56)
    await page.getByRole('button', { name: 'toggle' }).click()
    await settle(() => sidebarWidth() === 280)
    expect(document.querySelector('[data-slot="app-frame"]')!.getAttribute('data-sidebar')).toBe('expanded')
  })
})

describe('AppFrame 窄窗口', () => {
  it('帧宽 <1024 自动收起为 56px rail；回到宽窗口恢复', async () => {
    await page.viewport(1023, 800)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 56)
    expect(document.querySelector('[data-slot="app-frame-resize-handle"]')).toBeNull()
    await page.viewport(1024, 800)
    await settle(() => sidebarWidth() === 280)
  })

  it('rail 上的切换按钮以抽屉覆盖中栏，Escape 关闭并把焦点还给按钮', async () => {
    await page.viewport(800, 800)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 56)
    const mainBefore = widthOf('[data-slot="app-frame-main"]')

    await page.getByRole('button', { name: 'toggle' }).click()
    const drawer = page.getByRole('dialog', { name: 'Sidebar' })
    await expect.element(drawer).toBeVisible()
    await expect.element(drawer.getByRole('link', { name: 'session one' })).toBeVisible()
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(mainBefore)

    await userEvent.keyboard('{Escape}')
    await expect.element(drawer).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'toggle' })).toHaveFocus()
  })

  it('点击遮罩关闭抽屉', async () => {
    await page.viewport(800, 800)
    await render(<Harness />)
    await page.getByRole('button', { name: 'toggle' }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    document.querySelector('[data-slot="app-frame-scrim"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('390px 宽时中栏不产生整页横向滚动', async () => {
    await page.viewport(390, 700)
    await render(<Harness />)
    await settle(() => sidebarWidth() === 56)
    const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
    expect(main.getBoundingClientRect().width).toBe(390 - 56)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    expect(widthOf('[data-testid="content"]')).toBeLessThanOrEqual(390 - 56)
  })
})

describe('AppFrame 右栏', () => {
  it('打开时占帧宽 45%，中栏保持 ≥400', async () => {
    await page.viewport(1600, 800)
    await render(<Harness rightOpen />)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 720)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(1600 - 280 - 720)
  })

  it('空间不足时先缩小右栏，再把侧栏收为 rail', async () => {
    await page.viewport(1100, 800)
    await render(<Harness rightOpen />)
    // 1100 - 280 - 400 = 420 ≥ 300：右栏缩到 420，侧栏保持展开
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 420)
    expect(sidebarWidth()).toBe(280)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(400)
  })

  it('窄到放不下右栏列时改为覆盖中栏', async () => {
    await page.viewport(700, 800)
    await render(<Harness rightOpen />)
    await settle(() => document.querySelector('[data-slot="app-frame"]')!.getAttribute('data-right') === 'overlay')
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(700 - 56)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  })
})

describe('主题', () => {
  it('明暗主题切换语义 token 的实际取值', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    const body = () => getComputedStyle(document.body)
    const sidebar = () => getComputedStyle(document.querySelector('[data-slot="app-frame-sidebar"]')!)
    expect(body().backgroundColor).toBe('rgb(255, 255, 255)')
    expect(body().color).toBe('rgb(15, 17, 21)')
    expect(sidebar().backgroundColor).toBe('rgb(249, 250, 251)')

    document.documentElement.classList.add('dark')
    expect(body().backgroundColor).toBe('rgb(21, 21, 23)')
    expect(body().color).toBe('rgb(249, 250, 251)')
    expect(sidebar().backgroundColor).toBe('rgb(27, 27, 28)')
    expect(body().colorScheme).toBe('dark')
  })

  it('默认色板类不生成样式（--color-* 已清空）', async () => {
    await render(<div data-testid="probe" className="bg-red-500" />)
    expect(getComputedStyle(document.querySelector('[data-testid="probe"]')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('圆角档位与 rounded-round 的实际几何', async () => {
    await render(
      <>
        <div data-testid="panel" className="size-20 rounded-panel" />
        <div data-testid="round" className="size-6 rounded-round" />
      </>,
    )
    expect(getComputedStyle(document.querySelector('[data-testid="panel"]')!).borderTopLeftRadius).toBe('28px')
    const round = getComputedStyle(document.querySelector('[data-testid="round"]')!)
    expect(Number.parseFloat(round.borderTopLeftRadius)).toBeGreaterThanOrEqual(12)
  })
})

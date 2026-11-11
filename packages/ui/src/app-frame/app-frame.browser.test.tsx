import '../styles/theme.css'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { AppFrame, AppFrameCollapsedControls, useAppFrame } from './app-frame.tsx'

const pointer = (type: string, options: PointerEventInit) =>
  new PointerEvent(type, {
    pointerType: 'mouse',
    isPrimary: true,
    pointerId: 1,
    buttons: type === 'pointerup' ? 0 : 1,
    bubbles: true,
    cancelable: true,
    ...options,
  })

const labels = { sidebar: 'Sidebar', main: 'Main', rightPanel: 'Right panel', resizeSidebar: 'Resize sidebar', resizeRightPanel: 'Resize right panel' }

function Toggle() {
  const { toggleSidebar, sidebarVisible } = useAppFrame()
  return (
    <button type="button" aria-expanded={sidebarVisible} onClick={toggleSidebar}>
      toggle
    </button>
  )
}

function Rail() {
  const { peekSidebar } = useAppFrame()
  return (
    <div data-sidebar-expand onPointerEnter={peekSidebar}>
      <Toggle />
    </div>
  )
}

function Preview() {
  const { rightFullscreen, toggleRightFullscreen } = useAppFrame()
  return (
    <>
      <button type="button" onClick={toggleRightFullscreen}>
        {rightFullscreen ? 'exit fullscreen' : 'fullscreen'}
      </button>
      <details>
        <summary>retained disclosure</summary>
        <div>preview</div>
      </details>
      <div data-testid="preview-scroll" className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: 1600 }}>long preview</div>
      </div>
    </>
  )
}

function Harness({
  rightOpen: initialRightOpen = false,
  initialWidth = 280,
  onWidthChange,
}: {
  rightOpen?: boolean
  initialWidth?: number
  onWidthChange?: (side: 'left' | 'right', width: number) => void
}) {
  const [width, setWidth] = React.useState(initialWidth)
  const [collapsed, setCollapsed] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(initialRightOpen)
  const [rightWidth, setRightWidth] = React.useState<number>()
  const [fullscreen, setFullscreen] = React.useState(false)
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
        rail={<Rail />}
        rightOpen={rightOpen}
        onRightOpenChange={setRightOpen}
        rightWidth={rightWidth}
        onRightWidthChange={(width) => {
          setRightWidth(width)
          onWidthChange?.('right', width)
        }}
        rightFullscreen={fullscreen}
        onRightFullscreenChange={setFullscreen}
        rightPanel={<Preview />}
        sidebarWidth={width}
        onSidebarWidthChange={(width) => {
          setWidth(width)
          onWidthChange?.('left', width)
        }}
        sidebarCollapsed={collapsed}
        onSidebarCollapsedChange={setCollapsed}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div data-window-drag className="flex h-12 shrink-0 items-center">
            <AppFrameCollapsedControls />
          </div>
          <div data-testid="content" style={{ width: 'min(100%, clamp(680px, 64cqi, 920px))' }}>
            <button type="button" aria-pressed={rightOpen} onClick={() => setRightOpen(true)}>
              open preview
            </button>
            <button type="button" onClick={() => setRightOpen(false)}>
              close preview
            </button>
            content
          </div>
        </div>
      </AppFrame>
    </div>
  )
}

const widthOf = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().width)

it('Tab 聚焦两侧分隔条后改用鼠标拖拽时立即隐藏焦点框', async () => {
  await page.viewport(1440, 900)
  await render(
    <>
      <input aria-label="Text focus" />
      <Harness rightOpen />
    </>,
  )
  const input = document.querySelector('input')!
  for (const label of [labels.resizeSidebar, labels.resizeRightPanel]) {
    await userEvent.click(input)
    const handle = page.getByRole('separator', { name: label }).element()
    await userEvent.tab()
    handle.focus()
    expect(getComputedStyle(handle).outlineStyle).toBe('solid')
    await userEvent.click(handle)
    const bounds = handle.getBoundingClientRect()
    const startX = bounds.left + bounds.width / 2
    handle.dispatchEvent(
      pointer('pointerdown', {
        button: 0,
        clientX: startX,
        clientY: 100,
      }),
    )
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: startX + 20,
        clientY: 100,
      }),
    )
    document.dispatchEvent(
      pointer('pointerup', {
        clientX: startX + 20,
        clientY: 100,
      }),
    )
    expect(getComputedStyle(handle).outlineStyle).toBe('none')
  }
})

const sidebarWidth = () => widthOf('[data-slot="app-frame-sidebar"]')
const sidebarState = () => document.querySelector('[data-slot="app-frame"]')!.getAttribute('data-sidebar')
const controlsVisible = () => document.querySelector('[data-slot="app-frame-collapsed-controls"]') !== null

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
    await expect.poll(sidebarWidth).toBe(280)

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
    await userEvent.keyboard('{Enter}')
    expect(sidebarWidth()).toBe(264)
    await expect.element(handle).toHaveAttribute('aria-controls', 'sidebar')
  })

  it('拖动分隔条改变宽度，越界时停在上限', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await expect.poll(sidebarWidth).toBe(280)
    const handle = document.querySelector<HTMLElement>('[data-slot="app-frame-resize-handle"]')!
    const x = handle.getBoundingClientRect().left + 4
    handle.dispatchEvent(
      pointer('pointerdown', {
        button: 0,
        clientX: x,
        clientY: 100,
      }),
    )
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: x + 60,
        clientY: 100,
      }),
    )
    await expect.poll(sidebarWidth).toBe(340)
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: x + 600,
        clientY: 100,
      }),
    )
    document.dispatchEvent(
      pointer('pointerup', {
        clientX: x + 600,
        clientY: 100,
      }),
    )
    await settle(() => sidebarWidth() === 420)
    // 松开后不再跟随指针
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: x - 200,
        clientY: 100,
      }),
    )
    expect(sidebarWidth()).toBe(420)
  })

  it('宽窗口下切换按钮在展开与整列收起之间切换', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await expect.poll(sidebarWidth).toBe(280)
    await page.getByRole('button', { name: 'toggle' }).click()
    await settle(() => sidebarState() === 'hidden')
    expect(document.querySelector('[data-slot="app-frame-sidebar"]')).toBeNull()
    expect(controlsVisible()).toBe(true)
    await page.getByRole('button', { name: 'toggle' }).click()
    await expect.poll(sidebarWidth).toBe(280)
    expect(sidebarState()).toBe('expanded')
  })

  it('收起后悬停控制条的展开按钮浮出侧栏卡片', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    await expect.poll(sidebarWidth).toBe(280)
    await page.getByRole('button', { name: 'toggle' }).click()
    await settle(() => sidebarState() === 'hidden')

    document.querySelector('[data-sidebar-expand]')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await settle(() => document.querySelector('[data-slot="app-frame-peek"]') !== null)
    const peek = document.querySelector<HTMLElement>('[data-slot="app-frame-peek"]')!
    expect(peek.textContent).toContain('session one')
    expect(peek.getBoundingClientRect().width).toBe(280)
    expect(getComputedStyle(peek).borderRadius).toBe('28px')
    expect(getComputedStyle(peek).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})

describe('AppFrame 窄窗口', () => {
  it('帧宽 <1024 自动收起为控制条；回到宽窗口恢复', async () => {
    await page.viewport(1023, 800)
    await render(<Harness />)
    await settle(() => sidebarState() === 'hidden')
    expect(controlsVisible()).toBe(true)
    expect(document.querySelector('[data-slot="app-frame-resize-handle"]')).toBeNull()
    await page.viewport(1024, 800)
    await expect.poll(sidebarWidth).toBe(280)
  })

  it('控制条的展开按钮以抽屉覆盖中栏，Escape 关闭并把焦点还给按钮', async () => {
    await page.viewport(800, 800)
    await render(<Harness />)
    await settle(() => sidebarState() === 'hidden')
    // 等布局提交主内容的全部宽度后再比较抽屉是否覆盖。
    await settle(() => widthOf('[data-slot="app-frame-main"]') === 800)
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
    document.querySelector('[data-slot="app-frame-scrim"]')!.dispatchEvent(pointer('pointerdown', { bubbles: true }))
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('390px 宽时中栏不产生整页横向滚动', async () => {
    await page.viewport(390, 700)
    await render(<Harness />)
    await settle(() => sidebarState() === 'hidden')
    const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
    await settle(() => main.getBoundingClientRect().width === 390)
    expect(main.getBoundingClientRect().width).toBe(390)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    expect(widthOf('[data-testid="content"]')).toBeLessThanOrEqual(390)
  })
})

describe('AppFrame 右栏', () => {
  it('展开与收起平滑分配两栏宽度，退出期间保留正文并立即禁止交互', async () => {
    await page.viewport(1440, 800)
    await render(<Harness />)
    const panel = document.querySelector<HTMLElement>('[data-slot="app-frame-right"]')!
    const column = document.querySelector<HTMLElement>('[data-slot="app-frame-right-column"]')!
    const animations = () =>
      [...document.querySelectorAll('[data-slot="app-frame-main-column"], [data-slot="app-frame-right-column"]')].flatMap((node) => node.getAnimations())
    const pauseHalfway = async () => {
      await expect.poll(() => column.getAnimations().length).toBeGreaterThan(0)
      const current = animations()
      for (const animation of current) {
        animation.pause()
        animation.currentTime = Number(animation.effect!.getTiming().duration) / 2
      }
      await expect.poll(() => widthOf('[data-slot="app-frame-right-column"]')).toBeGreaterThan(0)
      expect(widthOf('[data-slot="app-frame-right-column"]')).toBeLessThan(648)
      expect(widthOf('[data-slot="app-frame-main"]')).toBeGreaterThan(512)
      expect(widthOf('[data-slot="app-frame-main"]')).toBeLessThan(1160)
      return current
    }
    await page.getByRole('button', { name: 'open preview' }).click()
    const opening = await pauseHalfway()
    await page.screenshot({ path: '../../../../.vitest/right-panel-enter-midpoint.png' })
    for (const animation of opening) animation.finish()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    await page.getByText('retained disclosure', { exact: true }).click()
    const disclosure = panel.querySelector('details')!
    await page.getByRole('button', { name: 'close preview' }).click()
    const closing = await pauseHalfway()
    expect(panel.hidden).toBe(false)
    expect(panel.inert).toBe(true)
    expect(panel.querySelector('details')).toBe(disclosure)
    await page.screenshot({ path: '../../../../.vitest/right-panel-exit-midpoint.png' })
    for (const animation of closing) animation.finish()
    await settle(() => panel.hidden === true)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(1160)
    await page.getByRole('button', { name: 'open preview' }).click()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    expect(panel.querySelector('details')).toBe(disclosure)
    expect(disclosure.open).toBe(true)
  })

  it('快速反向开合会到达最后选择的状态，拖动分隔条没有过渡延迟', async () => {
    await page.viewport(1440, 800)
    await render(<Harness />)
    await page.getByRole('button', { name: 'open preview' }).click()
    await page.getByRole('button', { name: 'close preview' }).click()
    await page.getByRole('button', { name: 'open preview' }).click()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    await expect.poll(() => document.querySelector('[data-right-transitioning]')).toBeNull()
    const handle = page.getByRole('separator', { name: 'Resize right panel' })
    await handle.dropTo(handle, { sourcePosition: { x: 4, y: 200 }, targetPosition: { x: 84, y: 200 }, force: true })
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 568)
    expect(document.querySelector('[data-slot="app-frame-right-column"]')!.getAnimations()).toHaveLength(0)
  })

  it('拖拽会中断尚未结束的展开动画并立即调整列宽', async () => {
    await page.viewport(1440, 800)
    await render(<Harness />)
    await page.getByRole('button', { name: 'open preview' }).click()
    const column = document.querySelector('[data-slot="app-frame-right-column"]')!
    await expect.poll(() => column.getAnimations().length).toBeGreaterThan(0)
    for (const node of document.querySelectorAll('[data-slot="app-frame-main-column"], [data-slot="app-frame-right-column"]')) {
      for (const animation of node.getAnimations()) {
        animation.pause()
        animation.currentTime = Number(animation.effect!.getTiming().duration) / 2
      }
    }
    const handle = page.getByRole('separator', { name: 'Resize right panel' }).element()
    await settle(() => Math.round(handle.getBoundingClientRect().left + 4) === Math.round(column.getBoundingClientRect().left))
    const x = handle.getBoundingClientRect().left + 4
    handle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: x, clientY: 200 }))
    await expect.poll(() => document.querySelector('[data-right-transitioning]')).toBeNull()
    expect(column.getAnimations()).toHaveLength(0)
    document.dispatchEvent(pointer('pointermove', { clientX: x + 20, clientY: 200 }))
    document.dispatchEvent(pointer('pointerup', { clientX: x + 20, clientY: 200 }))
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 628)
  })

  it('全屏覆盖整个帧，底层列宽、正文DOM与展开和滚动状态保持', async () => {
    await page.viewport(1440, 800)
    await render(<Harness rightOpen />)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    await page.getByText('retained disclosure', { exact: true }).click()
    const detail = document.querySelector('details')!
    const scroll = document.querySelector<HTMLElement>('[data-testid="preview-scroll"]')!
    scroll.scrollTop = 180
    await page.getByRole('button', { name: 'fullscreen', exact: true }).click()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 1440)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(512)
    expect(document.querySelector('details')).toBe(detail)
    expect(detail.open).toBe(true)
    expect(scroll.scrollTop).toBe(180)
    expect(document.querySelector('[data-slot="app-frame-right-resize-handle"]')).toBeNull()
    await page.getByRole('button', { name: 'exit fullscreen', exact: true }).click()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    expect(document.querySelector('details')).toBe(detail)
    expect(detail.open).toBe(true)
    expect(scroll.scrollTop).toBe(180)
  })

  it('700px打开自动全屏，退出后收起且变宽不会重开', async () => {
    await page.viewport(700, 800)
    await render(<Harness />)
    await page.getByRole('button', { name: 'open preview' }).click()
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 700)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(700)
    await page.getByRole('button', { name: 'exit fullscreen', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'open preview' })).toHaveAttribute('aria-pressed', 'false')
    await page.viewport(1440, 800)
    await settle(() => widthOf('[data-slot="app-frame-main"]') === 1160)
    expect(document.querySelector('[data-slot="app-frame-right"]')!.hasAttribute('hidden')).toBe(true)
  })
  it('拖动与键盘调整右栏宽度，保留400px中栏且与左分隔条使用同一步长', async () => {
    await page.viewport(1440, 800)
    await render(<Harness rightOpen />)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 648)
    const handle = page.getByRole('separator', { name: 'Resize right panel' })
    await handle.click()
    await userEvent.keyboard('{Home}')
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 300)
    await userEvent.keyboard('{ArrowLeft}')
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 316)
    await userEvent.keyboard('{End}')
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 760)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(400)
    await userEvent.keyboard('{ArrowLeft}')
    expect(widthOf('[data-slot="app-frame-right"]')).toBe(760)
    const element = handle.element()
    const start = element.getBoundingClientRect().left + 4
    element.dispatchEvent(
      pointer('pointerdown', {
        button: 0,
        clientX: start,
      }),
    )
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: start + 160,
      }),
    )
    document.dispatchEvent(pointer('pointerup', { bubbles: true }))
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 600)
    document.dispatchEvent(
      pointer('pointermove', {
        clientX: start - 500,
      }),
    )
    expect(widthOf('[data-slot="app-frame-right"]')).toBe(600)
  })
  it('打开时占帧宽 45%，中栏保持 ≥400', async () => {
    await page.viewport(1600, 800)
    await render(<Harness rightOpen />)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 720)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(1600 - 280 - 720)
  })

  it('空间不足时先缩小右栏，侧栏不让位', async () => {
    await page.viewport(1100, 800)
    await render(<Harness rightOpen />)
    // 1100 - 280 - 400 = 420 ≥ 300：右栏缩到 420，侧栏保持展开
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 420)
    expect(sidebarWidth()).toBe(280)
    expect(widthOf('[data-slot="app-frame-main"]')).toBe(400)
  })

  it('保持左侧栏，右栏缩到300后整栏关闭，窗口变宽不重开', async () => {
    await page.viewport(1200, 800)
    await render(<Harness rightOpen initialWidth={420} />)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 380)
    await page.viewport(1120, 800)
    await settle(() => widthOf('[data-slot="app-frame-right"]') === 300)
    expect(sidebarWidth()).toBe(420)
    await page.viewport(1119, 800)
    await settle(() => document.querySelector('[data-slot="app-frame-right"]')!.hasAttribute('hidden'))
    await expect.element(page.getByRole('button', { name: 'open preview' })).toHaveAttribute('aria-pressed', 'false')
    expect(sidebarWidth()).toBe(420)
    await expect.poll(() => widthOf('[data-slot="app-frame-main"]')).toBe(699)
    await page.viewport(1440, 800)
    await settle(() => widthOf('[data-slot="app-frame-main"]') === 1020)
    expect(document.querySelector('[data-slot="app-frame-right"]')!.hasAttribute('hidden')).toBe(true)
  })
})

describe('主题', () => {
  it('明暗主题切换语义 token 的实际取值', async () => {
    await page.viewport(1280, 800)
    await render(<Harness />)
    const body = () => getComputedStyle(document.body)
    const sidebar = () => getComputedStyle(document.querySelector('[data-slot="app-frame-sidebar"]')!)
    const main = () => getComputedStyle(document.querySelector('[data-slot="app-frame-main"]')!)
    expect(body().backgroundColor).toBe('rgb(255, 255, 255)')
    expect(body().color).toBe('rgb(15, 17, 21)')
    expect(sidebar().backgroundColor).toBe('rgb(247, 251, 251)')
    expect(main().backgroundColor).toBe('rgb(255, 255, 255)')
    expect(sidebar().backgroundImage).toContain('linear-gradient')
    expect(sidebar().backdropFilter).toBe('none')
    const lightSurface = sidebar().backgroundImage

    document.documentElement.classList.add('dark')
    expect(body().backgroundColor).toBe('rgb(21, 21, 23)')
    expect(body().color).toBe('rgb(249, 250, 251)')
    expect(sidebar().backgroundColor).toBe('rgb(27, 27, 28)')
    expect(main().backgroundColor).toBe('rgb(21, 21, 23)')
    expect(sidebar().backgroundImage).not.toBe(lightSurface)
    expect(sidebar().backdropFilter).toBe('none')
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

it.each(['left', 'right'] as const)('AppFrame %s drag stops on blur and unmount, and a later drag starts with the current width', async (side) => {
  await page.viewport(1440, 800)
  const changes: number[] = []
  const view = await render(
    <Harness
      rightOpen
      onWidthChange={(changedSide, width) => {
        if (changedSide === side) changes.push(width)
      }}
    />,
  )
  const selector = side === 'left' ? '[data-slot="app-frame-sidebar"]' : '[data-slot="app-frame-right"]'
  const handleSelector = side === 'left' ? '[data-slot="app-frame-resize-handle"]' : '[data-slot="app-frame-right-resize-handle"]'
  await expect.poll(() => widthOf(selector)).toBe(side === 'left' ? 280 : 648)
  const aligned = () => {
    const handle = document.querySelector(handleSelector)!.getBoundingClientRect()
    const panel = document.querySelector(selector)!.getBoundingClientRect()
    return Math.round(handle.left + handle.width / 2) === Math.round(side === 'left' ? panel.right : panel.left)
  }
  await settle(aligned)
  const begin = () => {
    const handle = document.querySelector(handleSelector)!
    const bounds = handle.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    handle.dispatchEvent(
      pointer('pointerdown', {
        button: 0,
        clientX: x,
        clientY: 100,
      }),
    )
    return x
  }
  const firstX = begin()
  document.dispatchEvent(
    pointer('pointermove', {
      clientX: firstX + (side === 'left' ? 30 : -30),
      clientY: 100,
    }),
  )
  await expect.poll(() => widthOf(selector)).toBe(side === 'left' ? 310 : 678)
  window.dispatchEvent(new Event('blur'))
  await expect.element(page.elementLocator(document.querySelector(handleSelector)!)).not.toHaveAttribute('data-separator', 'active')
  await settle(aligned)
  const afterBlur = changes.length
  document.dispatchEvent(pointer('pointermove', { bubbles: true, clientX: 650 }))
  expect(changes).toHaveLength(afterBlur)
  const secondX = begin()
  document.dispatchEvent(
    pointer('pointermove', {
      clientX: secondX + (side === 'left' ? 20 : -20),
      clientY: 100,
    }),
  )
  await expect.poll(() => widthOf(selector)).toBe(side === 'left' ? 330 : 698)
  await view.unmount()
  const afterUnmount = changes.length
  document.dispatchEvent(pointer('pointermove', { bubbles: true, clientX: 660 }))
  document.dispatchEvent(pointer('pointerup', { bubbles: true }))
  expect(changes).toHaveLength(afterUnmount)
})

import '../../styles.css'
import type {} from '@vitest/browser-playwright'
import type { AvailableModel, SessionModel, ThinkingLevel } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import * as React from 'react'
import { expect, it, vi } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { ModelPicker } from './model-picker.tsx'

const models: AvailableModel[] = [
  {
    providerId: 'a',
    providerName: 'Provider A',
    modelId: 'a1',
    name: 'Example A',
    thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  { providerId: 'b', providerName: 'Provider B', modelId: 'b1', name: 'Example B', thinkingLevels: ['off', 'low'] },
]

function Picker() {
  const [value, setValue] = React.useState<SessionModel>({ providerId: 'a', modelId: 'a1' })
  const [level, setLevel] = React.useState<ThinkingLevel>('high')
  return (
    <ModelPicker
      models={models}
      value={value}
      thinkingLevel={level}
      disabled={false}
      onChange={(model, next) => {
        setValue(model)
        setLevel(next)
      }}
    />
  )
}

const mount = () =>
  render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div style={{ padding: 240 }}>
          <div style={{ width: 192, display: 'flex', justifyContent: 'flex-end' }}>
            <Picker />
          </div>
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
const particles = () => [...document.querySelectorAll<HTMLElement>('[data-slot="thinking-particle"]')]

it('opens current detail first, replaces it with provider groups, and returns to the selected model detail', async () => {
  await mount()
  const trigger = page.elementLocator(document.querySelector<HTMLElement>('[data-model-picker]')!)
  await trigger.click()
  await expect.element(page.getByRole('slider', { name: 'Thinking level' })).toBeVisible()
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1)
  expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
  await page.getByRole('menuitem', { name: 'Choose model: Example A' }).click()
  await expect.element(page.getByRole('menu').getByText('Provider A')).toBeVisible()
  await expect.element(page.getByRole('menu').getByText('Provider B')).toBeVisible()
  expect(document.querySelector('[role="slider"]')).toBeNull()
  await page.getByRole('menuitemradio', { name: 'Example B' }).click()
  await expect.element(page.getByRole('slider', { name: 'Thinking level' })).toHaveAttribute('aria-valuetext', 'Off')
  await expect.poll(() => document.querySelector('[data-model-picker]')?.textContent).toBe('Example B·Off')
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('button', { name: 'Choose model: Example B' })).toHaveFocus()
})

it('keyboard reaches slider; all seven levels render the specified particle count and effective flow duration without closing detail', async () => {
  await mount()
  await page.getByRole('button', { name: 'Choose model: Example A' }).click()
  await userEvent.keyboard('{Tab}')
  const slider = page.getByRole('slider', { name: 'Thinking level' })
  await expect.element(slider).toHaveFocus()
  await userEvent.keyboard('{Home}')
  const expected = [
    ['Off', 0, 0],
    ['Minimal', 3, 4000],
    ['Low', 6, 3000],
    ['Medium', 10, 2200],
    ['High', 15, 1600],
    ['Xhigh', 21, 1100],
    ['Max', 28, 750],
  ] as const
  await expect.element(slider).toHaveAttribute('aria-valuetext', 'Off')
  expect(particles()).toHaveLength(0)
  for (const [i, [label, count, duration]] of expected.slice(1).entries()) {
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuetext', label)
    await expect.poll(() => particles().length).toBe(count)
    expect(document.querySelectorAll('[data-slot="thinking-tick"]')).toHaveLength(5 - i)
    await expect.poll(() => particles()[0]?.getAnimations()[0]?.playState).toBe('running')
    const animation = particles()[0]!.getAnimations()[0]!
    await expect.poll(() => Number(animation.effect!.getTiming().duration) / animation.playbackRate).toBeCloseTo(duration)
    expect((animation.effect as KeyframeEffect).getKeyframes().at(-1)?.transform).toContain('-1')
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(document.querySelector('[data-model-picker]')?.getAttribute('data-thinking-level-current')).toBe(models[0]!.thinkingLevels[i + 1])
  }
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => particles().length).toBe(0)
})

it('reduced motion and hidden page pause particles while level selection remains available', async () => {
  const original = window.matchMedia.bind(window)
  const motion = original('(prefers-reduced-motion: reduce)')
  const matches = vi.spyOn(motion, 'matches', 'get').mockReturnValue(true)
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => (query === '(prefers-reduced-motion: reduce)' ? motion : original(query)))
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  try {
    await mount()
    await page.getByRole('button', { name: 'Choose model: Example A' }).click()
    await expect.poll(() => particles()[0]?.getAnimations()[0]?.playState).toBe('paused')
    await userEvent.keyboard('{Tab}{End}')
    await expect.element(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Max')
    matches.mockReturnValue(false)
    motion.dispatchEvent(new Event('change'))
    await expect.poll(() => particles()[0]?.getAnimations()[0]?.playState).toBe('running')
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await expect.poll(() => particles()[0]?.getAnimations()[0]?.playState).toBe('paused')
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await expect.poll(() => particles()[0]?.getAnimations()[0]?.playState).toBe('running')
    await userEvent.keyboard('{Escape}')
  } finally {
    matches.mockRestore()
    media.mockRestore()
    hidden.mockRestore()
  }
})

it('drag previews detail and trigger together, then snaps to a valid level on release', async () => {
  await page.viewport(1000, 800)
  await mount()
  await page.getByRole('button', { name: 'Choose model: Example A' }).click()
  await expect.poll(() => document.querySelector('[role="menu"]')!.getBoundingClientRect().width).toBe(280)
  const slider = document.querySelector<HTMLElement>('[role="slider"]')!
  const rect = slider.getBoundingClientRect()
  const iframe = window.frameElement?.getBoundingClientRect()
  const dx = iframe?.left ?? 0
  const dy = iframe?.top ?? 0
  const x = rect.left + 14 + (rect.width - 28) * 0.52
  const y = rect.top + rect.height / 2
  const session = cdp()
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + dx, y: y + dy, button: 'left', buttons: 1, clickCount: 1 })
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y: y + dy, button: 'left', buttons: 1 })
    await expect.poll(() => slider.getAttribute('aria-valuetext')).toBe('Medium')
    expect(document.querySelector('[data-model-picker]')?.textContent).toBe('Example A·Medium')
    const thumb = document.querySelector('[data-slot="thinking-thumb"]')!.getBoundingClientRect()
    expect(thumb.left + thumb.width / 2).toBeCloseTo(x, 0)
  } finally {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 })
  }
  await expect
    .poll(() => {
      const thumb = document.querySelector('[data-slot="thinking-thumb"]')!.getBoundingClientRect()
      const settled = slider.getBoundingClientRect()
      return Math.abs(thumb.left + thumb.width / 2 - (settled.left + settled.width / 2))
    })
    .toBeLessThan(1)
  expect(document.querySelector('[data-model-picker]')?.textContent).toBe('Example A·Medium')
  await userEvent.keyboard('{Escape}')
})

it.each(['light', 'dark'])('%s detail retains canvas geometry near a narrow window edge', async (theme) => {
  await page.viewport(390, 700)
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <div style={{ position: 'fixed', bottom: 30, right: 20 }}>
            <Picker />
          </div>
        </TooltipProvider>
      </I18nProvider>,
    )
    await page.getByRole('button', { name: 'Choose model: Example A' }).click()
    await expect
      .poll(() => {
        const rect = document.querySelector('[role="menu"]')!.getBoundingClientRect()
        return { width: rect.width, height: rect.height, visible: rect.left >= 8 && rect.right <= 382 }
      })
      .toEqual({ width: 280, height: 112, visible: true })
    const slider = document.querySelector('[role="slider"]')!.getBoundingClientRect()
    expect(slider.width).toBe(256)
    expect(slider.height).toBe(28)
    expect(document.querySelector('[data-slot="thinking-thumb"]')!.getBoundingClientRect().width).toBe(28)
    expect(document.querySelectorAll('[role="menu"] button')).toHaveLength(0)
    await page.screenshot({ element: document.querySelector('[role="menu"]')!, path: `../../../../../../.vitest/cw05-${theme}.png` })
    await userEvent.keyboard('{Escape}')
  } finally {
    document.documentElement.className = original
  }
})

const brandedModels: AvailableModel[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    thinkingLevels: ['off', 'high'],
  },
  { providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-chat', name: 'DeepSeek Chat', thinkingLevels: ['off'] },
]

it('长模型名视觉检查', async () => {
  const long: AvailableModel[] = [
    {
      providerId: 'anthropic',
      providerName: 'Anthropic',
      modelId: 'claude-sonnet-4-5-extended-thinking',
      name: 'Claude Sonnet 4.5 Extended Thinking Ultra Long Name',
      thinkingLevels: ['off', 'high'],
    },
  ]
  await render(
    <I18nProvider locale="zh">
      <TooltipProvider>
        <div style={{ width: 330, display: 'flex' }}>
          <ModelPicker
            models={long}
            value={{ providerId: 'anthropic', modelId: 'claude-sonnet-4-5-extended-thinking' }}
            thinkingLevel="high"
            disabled={false}
            onChange={() => {}}
          />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  const trigger = document.querySelector<HTMLElement>('[data-model-picker]')!
  console.log('SIZE', trigger.scrollWidth, Math.ceil(trigger.getBoundingClientRect().width))
  await page.screenshot({ element: trigger, path: '../../../../../../.vitest/model-long-name.png' })
  await page.elementLocator(trigger).click()
  await expect.element(page.getByRole('menu')).toBeVisible()
  await page.screenshot({ element: document.querySelector('[role="menu"]') as HTMLElement, path: '../../../../../../.vitest/model-long-detail.png' })
  await page.getByRole('menuitem').first().click()
  await page.screenshot({ element: document.querySelector('[role="menu"]') as HTMLElement, path: '../../../../../../.vitest/model-long-list.png' })
  await userEvent.keyboard('{Escape}')
})

it('触发按钮不带模型图标；供应商分组不配图标，模型行按模型名称显示单色品牌图标', async () => {
  await render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div style={{ padding: 240 }}>
          <ModelPicker
            models={brandedModels}
            value={{ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }}
            thinkingLevel="off"
            disabled={false}
            onChange={() => {}}
          />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  const trigger = document.querySelector<HTMLElement>('[data-model-picker]')!
  // 按钮只显示模型名与推理档位，不带模型图标。
  expect(trigger.querySelector('svg title')).toBeNull()
  await page.elementLocator(trigger).click()
  // 详情浮层的当前模型行按模型名称显示 Claude 单色图标。
  expect([...document.querySelectorAll('[role="menu"] svg title')].map((title) => title.textContent)).toEqual(['Claude'])
  await page.getByRole('menuitem', { name: 'Choose model: Claude Sonnet 4.5' }).click()
  const menu = document.querySelector('[role="menu"]')!
  await expect.element(page.getByRole('menu')).toBeVisible()
  // 图标的 <title> 也在 textContent 中，分组名按文本节点断言，避免与图标标题混淆。
  const groupNames = [...menu.querySelectorAll('[data-slot="dropdown-menu-label"] span')].map((span) => span.textContent)
  expect(groupNames).toEqual(['Anthropic', 'DeepSeek'])
  for (const label of menu.querySelectorAll('[data-slot="dropdown-menu-label"]')) expect(label.querySelector('svg')).toBeNull()
  const titles = [...menu.querySelectorAll('[role="menuitemradio"] svg title')].map((title) => title.textContent)
  expect(titles).toEqual(['Claude', 'DeepSeek'])
  // 单色图标跟随前景色，而不是品牌色。
  const modelIcon = [...menu.querySelectorAll('[role="menuitemradio"] svg')].find((svg) => svg.querySelector('title'))
  expect(modelIcon?.getAttribute('class')).toContain('text-foreground')
  await userEvent.keyboard('{Escape}')
})

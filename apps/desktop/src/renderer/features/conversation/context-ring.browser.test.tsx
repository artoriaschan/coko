import '../../styles.css'
import type { ContextUsageResponse } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { createContextStore, type ContextTarget } from '../../stores/context-store.ts'
import { Composer } from './composer.tsx'
import { ContextRingControl } from './context-ring.tsx'
import { ModelPicker } from './model-picker.tsx'
import { ModePicker } from './mode-picker.tsx'

const usage = (tokens: number, extra: Partial<ContextUsageResponse> = {}): ContextUsageResponse => ({
  contextWindow: 40_000,
  threshold: 23_000,
  warning: 3_000,
  tokens,
  estimated: false,
  breakdown: { system: 120, prompt: 1000, assistant: 400, thinking: 80, tools: 400 },
  instructions: [
    { path: '/home/u/.coko/AGENTS.md', scope: 'user', chars: 10, truncated: false },
    { path: '/w/AGENTS.md', scope: 'project', chars: 40_000, truncated: true },
  ],
  diagnostics: [{ source: 'skills', code: 'name-mismatch', path: '/w/.coko/skills/x/SKILL.md', message: 'Name does not match' }],
  autoCompact: { enabled: true, paused: false },
  ...extra,
})

function renderRing(response: ContextUsageResponse, target: ContextTarget = { sessionId: 's1' }) {
  const fetchUsage = vi.fn<(target: ContextTarget) => Promise<ContextUsageResponse>>(async () => response)
  const store = createContextStore(fetchUsage)
  render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <div style={{ paddingTop: 450, paddingLeft: 400 }}>
          <ContextRingControl target={target} store={store} />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
  return { fetchUsage, store }
}

const ring = () => document.querySelector('[data-context-ring]') as HTMLButtonElement
const card = () => document.querySelector('[data-slot="context-card"]') as HTMLElement | null
const colorOf = (className: string) => {
  const probe = document.createElement('span')
  probe.className = className
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

beforeEach(async () => {
  await page.viewport(1280, 900)
})

describe('上下文环', () => {
  it('24px 入口只显示 12px 环；百分比在名称与 Tooltip，低于预警线为 link 色', async () => {
    const { store } = renderRing(usage(2_000))
    await expect.poll(() => store.getState().status).toBe('ready')
    expect(ring()?.textContent).toBe('')
    expect(ring().dataset.level).toBe('normal')
    expect(ring().getBoundingClientRect().width).toBe(24)
    expect(ring().getBoundingClientRect().height).toBe(24)
    expect(ring().querySelector('svg')!.getBoundingClientRect().width).toBe(12)
    await expect.poll(() => getComputedStyle(ring()).color).toBe(colorOf('text-link'))
    await userEvent.hover(ring())
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Context 5% used')
    expect(card()).toBeNull()
  })

  it.each([
    [3_000, 'warning', 'text-warning-text'],
    [23_000, 'critical', 'text-destructive'],
  ] as const)('tokens %i：%s', async (tokens, level, className) => {
    renderRing(usage(tokens))
    await expect.poll(() => ring()?.dataset.level).toBe(level)
    // 颜色有过渡动画：等其停在目标色。
    await expect.poll(() => getComputedStyle(ring()).color).toBe(colorOf(className))
    expect(colorOf(className)).not.toBe(colorOf('text-muted-foreground'))
  })

  it('点击打开五类明细；分母与几何正确，不展示指令、诊断与估算；Esc 返回环', async () => {
    const { fetchUsage, store } = renderRing(usage(2_000, { estimated: true }))
    await expect.poll(() => store.getState().status).toBe('ready')
    await userEvent.hover(ring())
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Context 5% used')
    expect(card()).toBeNull()
    await userEvent.click(ring())
    await expect.poll(() => card()).not.toBeNull()
    const dialog = page.getByRole('dialog', { name: 'Context usage' })
    await expect.element(dialog).toBeVisible()
    expect(card()!.querySelector('[data-slot="context-usage"]')!.textContent).toBe('2,000 / 40,000 tokens')
    expect([...card()!.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['System', 'Prompts', 'Assistant', 'Thinking', 'Tools'])
    expect(card()!.querySelector('[data-part-value="prompt"]')!.textContent).toBe('1,000 · 50.00%')
    expect(card()!.querySelector('[data-capacity-part="prompt"]')!.getBoundingClientRect().width).toBeCloseTo(7.9, 0)
    expect(card()!.querySelector('[data-instruction-file], [data-diagnostic]')).toBeNull()
    expect(card()!.textContent).not.toMatch(/includes estimates|Instruction files|Diagnostics/)
    await expect.poll(() => card()!.getBoundingClientRect().width).toBe(348)
    const bounds = card()!.getBoundingClientRect(),
      anchor = ring().getBoundingClientRect()
    expect(bounds.height).toBe(384)
    expect(bounds.right).toBeCloseTo(anchor.right, 0)
    expect(anchor.top - bounds.bottom).toBeCloseTo(8, 0)
    for (const value of card()!.querySelectorAll('[data-part-value]')) expect(getComputedStyle(value).textAlign).toBe('right')
    // 打开时刷新：挂载时一次，之后至少一次。
    expect(fetchUsage.mock.calls.length).toBeGreaterThanOrEqual(2)

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => card()).toBeNull()
    expect(document.activeElement).toBe(ring())
  })

  it('读取失败且没有旧值时环只画轨道，名称为"Context usage"', async () => {
    const store = createContextStore(async () => {
      throw new Error('boom')
    })
    render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <ContextRingControl target={{ workspaceId: 'w' }} store={store} />
        </TooltipProvider>
      </I18nProvider>,
    )
    await expect.poll(() => store.getState().status).toBe('error')
    expect(ring().getAttribute('aria-label')).toBe('Context usage')
    expect(ring().textContent).toBe('')
  })

  it('没有有效窗口时只有轨道，不伪造 0%；键盘可打开，外部点击返回入口焦点', async () => {
    const { store } = renderRing(usage(0, { contextWindow: 0, threshold: 0, warning: 0 }))
    await expect.poll(() => store.getState().status).toBe('ready')
    ring().focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => card()).not.toBeNull()
    expect(ring().textContent).toBe('')
    expect(card()!.textContent).not.toContain('0% used')
    await userEvent.click(document.body, { position: { x: 20, y: 20 } })
    await expect.poll(() => card()).toBeNull()
    expect(document.activeElement).toBe(ring())
  })

  it('靠窗口边缘时详情仍在视口内，移动指针进卡片后保持可读', async () => {
    const { store } = renderRing(usage(2000))
    await expect.poll(() => store.getState().status).toBe('ready')
    const wrapper = ring().parentElement!
    wrapper.style.paddingLeft = '0px'
    await userEvent.click(ring())
    await expect.poll(() => card()).not.toBeNull()
    await userEvent.hover(card()!)
    await expect.element(page.getByRole('dialog', { name: 'Context usage' })).toBeVisible()
    const bounds = card()!.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(8)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 8)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => card()).toBeNull()
  })
})

describe('输入区底栏在 390px 宽度', () => {
  it('上下文环与模式、模型选择都可见、互不重叠，不出现横向溢出', async () => {
    localStorage.clear()
    render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <div style={{ width: 390 }}>
            <Composer
              className="flex flex-wrap items-end gap-2 rounded-panel bg-background p-2 shadow-soft"
              running={false}
              disabled={false}
              needsSetup={false}
              onSend={async () => true}
              onSteer={async () => true}
              onStop={() => {}}
              onPause={() => {}}
              onSetup={() => {}}
              commandTarget={{ workspaceId: 'w-390' }}
              accessory={
                <>
                  <ModePicker value="default" onChange={() => {}} />
                  <ModelPicker
                    models={[
                      { providerId: 'p', providerName: 'Provider', modelId: 'm', name: 'A model with a fairly long display name', thinkingLevels: ['off'] },
                    ]}
                    value={{ providerId: 'p', modelId: 'm' }}
                    thinkingLevel="off"
                    disabled={false}
                    onChange={() => {}}
                  />
                </>
              }
            />
          </div>
        </TooltipProvider>
      </I18nProvider>,
    )
    await expect.poll(() => ring()).not.toBeNull()
    const form = document.querySelector('form')!
    const boxes = ['[data-permission-mode]', '[data-model-picker]', '[data-context-ring]', '[data-action="send"]'].map((selector) =>
      document.querySelector(selector)!.getBoundingClientRect(),
    )
    const outer = form.getBoundingClientRect()
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(20)
      expect(box.left).toBeGreaterThanOrEqual(outer.left)
      expect(box.right).toBeLessThanOrEqual(outer.right + 0.5)
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!]
        const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
        expect(overlap).toBe(false)
      }
    // 模型选择在环出现后仍保留可读宽度（只截断，不被挤成图标）。
    expect(boxes[1]!.width).toBeGreaterThan(80)
    expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
  })
})

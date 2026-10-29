import '../../styles.css'
import type { ContextUsageResponse } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
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
  breakdown: { system: 120, instructions: 10_001, skills: 30, memory: 12, tools: 900, messages: 40 },
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
      <div style={{ padding: 200 }}>
        <ContextRingControl target={target} store={store} />
      </div>
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

describe('上下文环', () => {
  it('显示百分比；低于预警线为 normal，越过预警线为 warning 色，达到阈值为 destructive 色', async () => {
    renderRing(usage(2_000))
    await expect.poll(() => ring()?.textContent).toBe('5%')
    expect(ring().dataset.level).toBe('normal')
    expect(ring().getAttribute('aria-label')).toBe('Context 5% used')
  })

  it.each([
    [3_000, 'warning', 'text-warning'],
    [23_000, 'critical', 'text-destructive'],
  ] as const)('tokens %i：%s', async (tokens, level, className) => {
    renderRing(usage(tokens))
    await expect.poll(() => ring()?.dataset.level).toBe(level)
    // 颜色有过渡动画：等其停在目标色。
    await expect.poll(() => getComputedStyle(ring()).color).toBe(colorOf(className))
    expect(colorOf(className)).not.toBe(colorOf('text-muted-foreground'))
  })

  it('点击打开 HoverCard：用量、分项、指令文件（截断）与诊断；Esc 关闭且焦点回到环', async () => {
    const { fetchUsage } = renderRing(usage(2_000, { estimated: true }))
    await expect.poll(() => ring()?.textContent).toBe('5%')
    // 只悬停不打开（布局变化把环移到静止的指针下时不能弹出卡片挡住上方的按钮）；等过 openDelay（300 ms）的上限。
    await userEvent.hover(ring())
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(card()).toBeNull()
    await userEvent.click(ring())
    await expect.poll(() => card()).not.toBeNull()
    const dialog = page.getByRole('dialog', { name: 'Context' })
    await expect.element(dialog).toBeVisible()
    expect(card()!.querySelector('[data-slot="context-usage"]')!.textContent).toBe('2,000 / 40,000 tokens · includes estimates')
    expect([...card()!.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['System prompt', 'Instructions', 'Skills', 'Memory', 'Tools', 'Messages'])
    expect(card()!.querySelector('[data-instruction-file="/w/AGENTS.md"]')!.textContent).toContain('Truncated')
    expect(card()!.querySelector('[data-diagnostic="name-mismatch"]')).not.toBeNull()
    // 打开时刷新：挂载时一次，之后至少一次。
    expect(fetchUsage.mock.calls.length).toBeGreaterThanOrEqual(2)

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => card()).toBeNull()
    expect(document.activeElement).toBe(ring())
    // 断言"不会再打开"只能等过计时器的上限：openDelay 300 ms，这里等 600 ms。
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(card()).toBeNull()
  })

  it('读取失败且没有旧值时环只画轨道，名称为"Context usage"', async () => {
    const store = createContextStore(async () => {
      throw new Error('boom')
    })
    render(
      <I18nProvider locale="en">
        <ContextRingControl target={{ workspaceId: 'w' }} store={store} />
      </I18nProvider>,
    )
    await expect.poll(() => store.getState().status).toBe('error')
    expect(ring().getAttribute('aria-label')).toBe('Context usage')
    expect(ring().textContent).toBe('')
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

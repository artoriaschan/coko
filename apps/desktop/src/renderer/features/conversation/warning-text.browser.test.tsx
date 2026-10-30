// 作文字的警告色（ui-design-system.md：--warning 用于图标与填充，作文字时用 --warning-text）：回退对话框的两条警告与上下文卡的
// 截断标注、诊断码，在明暗两种主题下按计算样式断言对比度 ≥ 4.5:1；警告图标仍为 --warning。
import '../../styles.css'
import type { ContextUsageResponse, RewindResponse } from '@coko/protocol'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { createContextStore } from '../../stores/context-store.ts'
import { ContextRingControl } from './context-ring.tsx'
import { RewindDialog } from './rewind-dialog.tsx'

const rgb = (value: string) =>
  value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number) as [number, number, number]
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const transparent = (color: string) => color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color)
/** 文字颜色对其最近的不透明背景（向上找祖先，最后是根元素）的对比度。 */
function contrastOf(el: Element): number {
  let node: Element | null = el
  let background = ''
  while (node) {
    const color = getComputedStyle(node).backgroundColor
    if (!transparent(color)) {
      background = color
      break
    }
    node = node.parentElement
  }
  if (background === '') background = getComputedStyle(document.documentElement).backgroundColor
  const [x, y] = [luminance(rgb(getComputedStyle(el).color)), luminance(rgb(background))].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

const colorOf = (className: string) => {
  const probe = document.createElement('span')
  probe.className = className
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

const preview: RewindResponse = {
  targetSeq: 3,
  mode: 'both',
  dryRun: true,
  text: 'hi',
  restored: ['/w/a.ts'],
  deleted: [],
  diverged: ['/w/a.ts'],
  untracked: [],
  outside: ['/elsewhere/b.ts'],
  skipped: [],
}

const usage: ContextUsageResponse = {
  contextWindow: 40_000,
  threshold: 23_000,
  warning: 3_000,
  tokens: 1_000,
  estimated: false,
  breakdown: { system: 1, instructions: 1, skills: 1, memory: 1, tools: 1, messages: 1 },
  instructions: [{ path: '/w/AGENTS.md', scope: 'project', chars: 40_000, truncated: true }],
  diagnostics: [{ source: 'skills', code: 'name-mismatch', path: '/w/.coko/skills/x/SKILL.md', message: 'Name does not match' }],
  autoCompact: { enabled: true, paused: false },
}

for (const theme of ['light', 'dark'] as const) {
  it(`回退对话框的警告文字对比度 ≥ 4.5:1（${theme}），图标为 warning 色`, async () => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    await render(
      <I18nProvider locale="en">
        <RewindDialog target={{ seq: 3, text: 'hi' }} workspacePath="/w" onPreview={async () => preview} onConfirm={async () => false} onClose={() => {}} />
      </I18nProvider>,
    )
    await expect.poll(() => document.querySelector('[data-slot="rewind-outside"]')).not.toBeNull()
    for (const slot of ['rewind-diverged', 'rewind-outside']) {
      const el = document.querySelector(`[data-slot="${slot}"]`)!
      expect({ slot, ok: contrastOf(el) >= 4.5 }).toEqual({ slot, ok: true })
      expect(getComputedStyle(el.querySelector('svg')!).color).toBe(colorOf('text-warning'))
    }
  })

  it(`上下文卡的截断标注与诊断码对比度 ≥ 4.5:1（${theme}）`, async () => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    await render(
      <I18nProvider locale="en">
        <div style={{ padding: 200 }}>
          <ContextRingControl target={{ sessionId: 's1' }} store={createContextStore(async () => usage)} />
        </div>
      </I18nProvider>,
    )
    await expect.poll(() => document.querySelector('[data-context-ring]')?.textContent).toBe('2%')
    document.querySelector<HTMLButtonElement>('[data-context-ring]')!.click()
    await expect.poll(() => document.querySelector('[data-diagnostic="name-mismatch"]')).not.toBeNull()
    const truncated = [...document.querySelectorAll('[data-instruction-file] span span')].find((s) => s.textContent?.includes('Truncated'))!
    const code = document.querySelector('[data-diagnostic="name-mismatch"] > span')!
    expect(code.textContent).toBe('name-mismatch')
    expect([contrastOf(truncated) >= 4.5, contrastOf(code) >= 4.5]).toEqual([true, true])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

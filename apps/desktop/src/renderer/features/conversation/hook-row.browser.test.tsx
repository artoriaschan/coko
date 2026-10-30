import '../../styles.css'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type { HookRunPayload } from '@coko/protocol'
import { I18nProvider } from '../../app/i18n.tsx'
import { HookRow } from './hook-row.tsx'

const renderRow = (hook: HookRunPayload, locale: 'zh' | 'en' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <div style={{ width: 480 }}>
        <HookRow item={{ kind: 'hook', key: '1', hook }} />
      </div>
    </I18nProvider>,
  )

describe('时间线的 Hook 行', () => {
  it('紧凑行：事件、结论（阻断为警示色）、来源与退出码、命令（单行截断，title 为全文）与 message', async () => {
    const command = './scripts/guard.sh --very-long-option '.repeat(6).trim()
    await renderRow({
      event: 'PreToolUse',
      hookId: 'global:PreToolUse:0:0',
      source: 'global',
      command,
      outcome: 'blocked',
      exitCode: 2,
      durationMs: 12,
      message: 'no rm\nplease',
    })
    const row = document.querySelector('[data-slot="hook-row"]') as HTMLElement
    expect([row.dataset.event, row.dataset.outcome, row.dataset.source]).toEqual(['PreToolUse', 'blocked', 'global'])
    expect(row.textContent).toContain('PreToolUse')
    expect(row.textContent).toContain('Blocked')
    expect(row.textContent).toContain('Global · exit 2')
    const code = row.querySelector('[data-slot="hook-command"]') as HTMLElement
    expect(code.title).toBe(command)
    // 单行截断：内容比可见宽度长。
    expect(code.scrollWidth).toBeGreaterThan(code.clientWidth)
    expect(row.querySelector('[data-slot="hook-message"]')?.textContent).toBe('no rm\nplease')
    const outcome = row.querySelector('[data-slot="hook-outcome"]')!
    expect(outcome.className).toContain('text-destructive')
  })

  it('非阻断结论为常规色；没有 message 与退出码时不显示；中文文案', async () => {
    await renderRow({ event: 'PostToolUse', hookId: 'project:PostToolUse:0:0', source: 'project', command: 'lint.sh', outcome: 'context', durationMs: 3 }, 'zh')
    const row = document.querySelector('[data-slot="hook-row"]') as HTMLElement
    expect(row.textContent).toContain('已追加上下文')
    expect(row.textContent).toContain('项目')
    expect(row.textContent).not.toContain('退出码')
    expect(row.querySelector('[data-slot="hook-message"]')).toBeNull()
    expect(row.querySelector('[data-slot="hook-outcome"]')!.className).not.toContain('text-destructive')
  })
})

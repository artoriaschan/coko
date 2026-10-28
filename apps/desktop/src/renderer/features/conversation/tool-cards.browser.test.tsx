import '../../styles.css'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import { I18nProvider } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import { ToolCardView } from './tool-cards.tsx'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

const renderCard = (item: ToolItem, locale: 'zh' | 'en' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <div style={{ width: 600 }}>
          <ToolCardView item={item} />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )

describe('工具卡', () => {
  it('未知工具：以工具名为摘要，展开后原样显示参数与结果', async () => {
    await renderCard({
      kind: 'tool',
      key: 'tool:x',
      call: { id: 'x', name: 'mcp__github__create_issue', arguments: { repo: 'coko/coko', labels: ['bug'], draft: false } },
      result: { isError: false, text: 'Created issue #42', details: undefined },
      status: 'done',
      live: null,
    })
    const card = document.querySelector('[data-slot="tool-card"]')!
    expect(card.getAttribute('data-tool')).toBe('mcp__github__create_issue')
    const header = page.getByRole('button', { name: /Tool call/ })
    await expect.element(header).toBeVisible()
    expect(header.element().textContent).toContain('mcp__github__create_issue')
    await expect.element(page.getByRole('img', { name: 'Done' })).toBeVisible()
    await header.click()
    const body = card.querySelector('[data-slot="tool-card-body"]')!
    expect(body.textContent).toContain('Arguments')
    expect(body.textContent).toContain('"repo": "coko/coko"')
    expect(body.textContent).toContain('"bug"')
    expect(body.textContent).toContain('Result')
    expect(body.textContent).toContain('Created issue #42')
  })

  it('未知工具结果只有 details 时显示其 JSON；无结果时只显示参数', async () => {
    const screen = await renderCard({
      kind: 'tool',
      key: 'tool:y',
      call: { id: 'y', name: 'custom', arguments: { q: 1 } },
      result: { isError: true, text: '', details: { reason: 'nope' } },
      status: 'error',
      live: null,
    })
    // 出错的工具卡默认展开。
    const body = document.querySelector('[data-slot="tool-card-body"]')!
    expect(body.textContent).toContain('"reason": "nope"')
    expect(document.querySelector('[data-slot="tool-card"]')?.getAttribute('data-status')).toBe('error')
    await screen.rerender(
      <I18nProvider locale="en">
        <ToolCardView
          item={{ kind: 'tool', key: 'tool:y', call: { id: 'y', name: 'custom', arguments: { q: 1 } }, result: null, status: 'running', live: null }}
        />
      </I18nProvider>,
    )
    await page.getByRole('button', { name: /Tool call/ }).click()
    expect(document.querySelector('[data-slot="tool-card-body"]')?.textContent).not.toContain('Result')
    await expect.element(page.getByRole('img', { name: 'Running' })).toBeVisible()
  })

  it('edit 显示行号 diff，增删行使用 diff 语义色', async () => {
    await renderCard({
      kind: 'tool',
      key: 'tool:e',
      call: { id: 'e', name: 'edit', arguments: { path: 'src/a.ts' } },
      result: { isError: false, text: 'ok', details: { diff: ' 1 keep\n-2 old\n+2 new' } },
      status: 'done',
      live: null,
    })
    const added = document.querySelector<HTMLElement>('[data-diff="added"]')!
    const deleted = document.querySelector<HTMLElement>('[data-diff="deleted"]')!
    expect(added.textContent).toBe('+2 new')
    expect(deleted.textContent).toBe('-2 old')
    expect(getComputedStyle(added).backgroundColor).not.toBe(getComputedStyle(deleted).backgroundColor)
    expect(getComputedStyle(added).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('bash 被沙箱拒绝：标题行显示沙箱拒绝；提权批准后显示以目标档位允许一次', async () => {
    const call = { id: 'b', name: 'bash', arguments: { command: 'echo x > /etc/f' } }
    const screen = await renderCard({
      kind: 'tool',
      key: 'tool:b',
      call,
      result: { isError: true, text: 'denied', details: { sandbox: { mode: 'workspace-write', denied: true } } },
      status: 'error',
      live: null,
    })
    expect(document.querySelector('[data-sandbox-denied]')?.textContent).toBe('Blocked by the sandbox (Workspace write)')
    const request = {
      requestId: 'r',
      toolCallId: 'b',
      toolName: 'bash',
      kind: 'escalation' as const,
      subject: 'x',
      targetMode: 'danger-full-access' as const,
      suggestions: [],
    }
    await screen.rerender(
      <I18nProvider locale="en">
        <ToolCardView
          item={{
            kind: 'tool',
            key: 'tool:b',
            call,
            result: { isError: false, text: '', details: undefined },
            status: 'done',
            live: null,
            approval: { request, decision: { requestId: 'r', outcome: 'allowed', scope: 'once' } },
          }}
        />
      </I18nProvider>,
    )
    expect(document.querySelector('[data-sandbox-denied]')).toBeNull()
    expect(document.querySelector('[data-approval-outcome]')?.textContent).toBe('Allowed once with Full access')
  })

  it('bash 运行中显示实时输出，命令为摘要', async () => {
    await renderCard(
      {
        kind: 'tool',
        key: 'tool:b',
        call: { id: 'b', name: 'bash', arguments: { command: 'ls -la' } },
        result: null,
        status: 'running',
        live: {
          toolCallId: 'b',
          toolName: 'bash',
          args: { command: 'ls -la' },
          status: 'running',
          partialResult: { content: [{ type: 'text', text: 'total 0' }] },
        },
      },
      'zh',
    )
    const header = page.getByRole('button', { name: /运行命令/ })
    await expect.element(header).toBeVisible()
    expect(header.element().textContent).toContain('ls -la')
    expect(document.querySelector('[data-slot="tool-card-body"]')?.textContent).toBe('total 0')
  })
})

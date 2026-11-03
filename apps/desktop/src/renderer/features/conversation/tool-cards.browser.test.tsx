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
    expect(card.querySelector('[role="status"]')?.textContent).toBe('Done')
    await header.click()
    const body = card.querySelector('[data-slot="tool-card-body"]')!
    expect(body.textContent).toContain('IN')
    expect(body.textContent).toContain('"repo": "coko/coko"')
    expect(body.textContent).toContain('"bug"')
    expect(body.textContent).toContain('OUT')
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
    // 失败同样手动展开，保留检查真实输入/输出的入口。
    await page.getByRole('button', { name: /Tool call/ }).click()
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
    expect(document.querySelector('[data-slot="tool-card-body"]')?.textContent).not.toContain('OUT')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Running')
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
    await page.getByRole('button', { name: /Edit/ }).click()
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
    await header.click()
    expect(document.querySelector('[data-terminal-output]')?.textContent).toBe('total 0')
  })
  it('Memory 工具卡：按结果显示"已记住 / 已更新记忆 / 已删除记忆"，失败与等待时为动作名', async () => {
    const memory = { id: 'm1', scope: 'workspace', content: 'Uses pnpm', updatedAt: 1 }
    const write = (status: ToolItem['status'], details: unknown, isError = false, id?: string): ToolItem => ({
      kind: 'tool',
      key: 'tool:w',
      call: { id: 'w', name: 'memory_write', arguments: { content: 'Uses pnpm', scope: 'workspace', ...(id ? { id } : {}) } },
      result: status === 'done' || status === 'error' ? { isError, text: isError ? 'Memory entry m9 not found' : 'ok', details } : null,
      status,
      live: null,
    })
    const title = () => document.querySelector('[data-slot="tool-card"]')!.querySelector('button')!.textContent
    const screen = await renderCard(write('done', { action: 'created', memory }))
    expect(title()).toContain('Remembered')
    expect(title()).toContain('Uses pnpm')
    const again = (item: ToolItem, locale: 'en' | 'zh' = 'en') =>
      screen.rerender(
        <I18nProvider locale={locale}>
          <ToolCardView item={item} />
        </I18nProvider>,
      )
    await again(write('done', { action: 'updated', memory }, false, 'm1'))
    expect(title()).toContain('Updated memory')
    await again(write('done', { action: 'created', memory }), 'zh')
    expect(title()).toContain('已记住')
    await again(write('error', undefined, true, 'm9'))
    expect(title()).toContain('Save memory')
    await again(write('awaiting', undefined))
    expect(title()).toContain('Save memory')
    await again({
      kind: 'tool',
      key: 'tool:d',
      call: { id: 'd', name: 'memory_delete', arguments: { id: 'm1' } },
      result: { isError: false, text: 'Deleted memory m1.', details: { action: 'deleted', memory } },
      status: 'done',
      live: null,
    })
    expect(title()).toContain('Deleted memory')
    expect(title()).toContain('m1')
    expect(document.querySelector('[data-slot="tool-card"]')!.getAttribute('data-tool')).toBe('memory_delete')
  })
})

describe('工具卡：外部 Hook', () => {
  const blocked: ToolItem = {
    kind: 'tool',
    key: 'tool:b1',
    call: { id: 'b1', name: 'bash', arguments: { command: 'rm -rf build' } },
    result: {
      isError: true,
      text: 'Blocked by hook: no rm',
      details: { hostBlock: { by: 'hook', hookId: 'global:PreToolUse:0:0', command: './guard.sh --strict' } },
    },
    status: 'error',
    live: null,
  }

  it('被 Hook 阻止：标题行标注"被 Hook 阻止"（title 带命令），明细开头显示命令与原因（中英文）', async () => {
    const screen = await renderCard(blocked, 'zh')
    const mark = document.querySelector('[data-hook-blocked]')!
    expect(mark.textContent).toBe('被 Hook 阻止')
    expect(mark.getAttribute('title')).toBe('被 Hook 阻止：./guard.sh --strict')
    await page.getByRole('button', { name: /运行命令/ }).click()
    const note = document.querySelector('[data-slot="hook-block"]')!
    expect(note.textContent).toBe('被 Hook 阻止./guard.sh --strict')
    expect(document.querySelector('[data-slot="tool-card-body"]')?.textContent).toContain('Blocked by hook: no rm')
    await screen.unmount()
    await renderCard(blocked, 'en')
    expect(document.querySelector('[data-hook-blocked]')?.textContent).toBe('Blocked by hook')
  })

  it('工具自身 details 中的 hostBlock 不是 Hook 标注的来源之外的形状时不显示（只认 by: hook 与字符串命令）', async () => {
    await renderCard({ ...blocked, result: { ...blocked.result!, details: { hostBlock: { by: 'goal-budget', dimension: 'tool-calls' } } } })
    expect(document.querySelector('[data-hook-blocked]')).toBeNull()
    expect(document.querySelector('[data-slot="hook-block"]')).toBeNull()
  })

  it('PermissionRequest Hook 允许的审批：标题行显示"由 Hook 允许"', async () => {
    await renderCard({
      kind: 'tool',
      key: 'tool:a1',
      call: { id: 'a1', name: 'bash', arguments: { command: 'make' } },
      result: { isError: false, text: 'ok', details: undefined },
      status: 'done',
      live: null,
      approval: {
        request: { requestId: 'r1', toolCallId: 'a1', toolName: 'bash', kind: 'tool', subject: 'make', suggestions: [] },
        decision: { requestId: 'r1', outcome: 'allowed', scope: 'once', by: 'hook' },
      },
    })
    expect(document.querySelector('[data-approval-outcome="allowed"]')?.textContent).toBe('Allowed by hook')
  })

  it('lsp：标题为操作，摘要为文件与位置，明细先显示结果计数；截断时注明总数；诊断超时注明没有收到', async () => {
    const lsp = (id: string, args: Record<string, unknown>, text: string, details: Record<string, unknown>): ToolItem => ({
      kind: 'tool',
      key: `tool:${id}`,
      call: { id, name: 'lsp', arguments: args },
      result: { isError: false, text, details },
      status: 'done',
      live: null,
    })
    const refs = await renderCard(
      lsp('r', { operation: 'references', file_path: 'src/a.ts', line: 3, character: 7 }, 'src/a.ts:3:7 foo()\nsrc/b.ts:1:1 foo', {
        operation: 'references',
        count: 2,
        total: 2,
        truncated: false,
      }),
    )
    const header = page.getByRole('button', { name: /Find references/ })
    await expect.element(header).toBeVisible()
    expect(header.element().textContent).toContain('src/a.ts:3:7')
    await header.click()
    const body = () => document.querySelector('[data-slot="tool-card-body"]')!
    expect(body().querySelector('[data-lsp-count]')!.textContent).toBe('2 items')
    expect(body().textContent).toContain('src/b.ts:1:1 foo')
    await refs.unmount()

    const truncated = await renderCard(
      lsp('d', { operation: 'diagnostics', file_path: 'src/a.ts' }, 'x', { operation: 'diagnostics', count: 200, total: 250, truncated: true }),
      'zh',
    )
    await page.getByRole('button', { name: /查询诊断/ }).click()
    expect(body().querySelector('[data-lsp-count]')!.textContent).toBe('显示 200 项，共 250 项')
    await truncated.unmount()

    const timeout = await renderCard(
      lsp('t', { operation: 'diagnostics', file_path: 'a.ts' }, 'No diagnostics received', { count: 0, total: 0, received: false }),
    )
    await page.getByRole('button', { name: /Diagnostics/ }).click()
    expect(body().querySelector('[data-lsp-count]')!.textContent).toBe('No diagnostics received')
    await timeout.unmount()
  })
})

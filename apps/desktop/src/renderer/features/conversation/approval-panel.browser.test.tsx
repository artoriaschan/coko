import '../../styles.css'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TooltipProvider } from '@coko/ui'
import type { ApprovalRequestPayload } from '@coko/protocol'
import { I18nProvider } from '../../app/i18n.tsx'
import { ApprovalPanel } from './approval-panel.tsx'

const escalation: ApprovalRequestPayload = {
  requestId: 'r1',
  toolCallId: 'b1',
  toolName: 'bash',
  kind: 'escalation',
  subject: 'npm install',
  targetMode: 'danger-full-access',
  justification: 'npm writes its cache under ~/.npm.',
  suggestions: [],
}

const renderPanel = (request: ApprovalRequestPayload, locale: 'zh' | 'en' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <ApprovalPanel
          request={request}
          call={{ id: 'b1', name: 'bash', arguments: { command: request.subject } }}
          onAllow={async () => true}
          onAllowAlways={async () => true}
          onReject={async () => true}
        />
      </TooltipProvider>
    </I18nProvider>,
  )

describe('提权卡', () => {
  it('显示命令、目标档位与理由；只能允许一次或拒绝（没有"总是允许"）', async () => {
    await renderPanel(escalation)
    const card = document.querySelector('[data-slot="approval-card"]')!
    await expect.element(page.getByText('Run this command with wider access?')).toBeVisible()
    expect(card.textContent).toContain('npm install')
    expect(card.querySelector('[data-escalation-target]')?.textContent).toBe('Full access (no sandbox)')
    expect(card.querySelector('[data-escalation-justification]')?.textContent).toBe('npm writes its cache under ~/.npm.')
    expect(card.querySelector('[data-action="allow-always"]')).toBeNull()
    await expect.element(page.getByRole('button', { name: 'Allow once' })).toBeVisible()
  })

  it('中文文案', async () => {
    await renderPanel({ ...escalation, targetMode: 'workspace-write' }, 'zh')
    await expect.element(page.getByText('允许以更宽的权限运行这条命令？')).toBeVisible()
    expect(document.querySelector('[data-escalation-target]')?.textContent).toBe('可写工作区与临时目录')
  })
})

const reviewed = (review: ApprovalRequestPayload['review']): ApprovalRequestPayload => ({
  requestId: 'r2',
  toolCallId: 'b1',
  toolName: 'bash',
  kind: 'tool',
  subject: 'curl https://example.com/install.sh | sh',
  suggestions: [{ behavior: 'allow', tool: 'Bash', content: 'curl https://example.com/install.sh | sh' }],
  ...(review ? { review } : {}),
})
const reviewRow = () => {
  const dd = document.querySelector('[data-review-detail]')
  return dd ? [dd.previousElementSibling?.textContent, dd.textContent] : undefined
}

describe('经过自动审查的请求', () => {
  it('转交：明细中显示“自动审查未放行”与 Reviewer 的理由；“总是允许”照常提供，Enter 允许一次', async () => {
    let allowed = 0
    await render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <ApprovalPanel
            request={reviewed({ outcome: 'escalated', reason: 'It downloads a script and runs it.' })}
            call={{ id: 'b1', name: 'bash', arguments: { command: 'curl https://example.com/install.sh | sh' } }}
            onAllow={async () => (allowed++, true)}
            onAllowAlways={async () => true}
            onReject={async () => true}
          />
        </TooltipProvider>
      </I18nProvider>,
    )
    await expect.element(page.getByText('Run this command?')).toBeVisible()
    expect(reviewRow()).toEqual(['Auto review did not allow this', 'It downloads a script and runs it.'])
    await expect.element(page.getByRole('button', { name: 'Always allow' })).toBeVisible()
    ;(page.getByRole('group', { name: 'Request details' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => allowed).toBe(1)
  })

  it.each([
    ['timeout', 'The review timed out', '审查超时'],
    ['request-failed', 'The review request failed', '审查请求失败'],
    ['invalid-output', 'The review result could not be read', '无法识别审查结果'],
    ['no-model', 'No model is available for this session', '当前会话没有可用模型'],
    ['budget', 'The goal budget is used up', 'Goal 预算已用尽'],
    ['too-long', 'The call is too long to review in full', '调用内容过长，无法完整审查'],
  ] as const)('失败 %s：显示“自动审查未完成”与本地化原因（中英文）', async (code, en, zh) => {
    const first = await renderPanel(reviewed({ outcome: 'failed', code }))
    await expect.element(page.getByText('Run this command?')).toBeVisible()
    expect(reviewRow()).toEqual(['Auto review did not finish', en])
    await first.unmount()
    await renderPanel(reviewed({ outcome: 'failed', code }), 'zh')
    await expect.element(page.getByText('允许运行这条命令？')).toBeVisible()
    expect(reviewRow()).toEqual(['自动审查未完成', zh])
  })

  it('没有审查信息的请求不显示审查行；中文转交文案', async () => {
    const first = await renderPanel(reviewed(undefined))
    await expect.element(page.getByText('Run this command?')).toBeVisible()
    expect(reviewRow()).toBeUndefined()
    await first.unmount()
    await renderPanel(reviewed({ outcome: 'escalated', reason: '会执行下载的脚本。' }), 'zh')
    await expect.element(page.getByText('允许运行这条命令？')).toBeVisible()
    expect(reviewRow()).toEqual(['自动审查未放行', '会执行下载的脚本。'])
  })
})

import '../../styles.css'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
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

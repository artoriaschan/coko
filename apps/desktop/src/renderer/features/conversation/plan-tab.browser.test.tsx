// Plan Mode 的界面：审阅卡（批准并执行、批准并允许编辑、继续规划、右栏中的编辑随批准提交、新计划自动打开一次）、右栏 Plan tab（修订、状态、编辑）、
// Plan chip（plan 模式时显示，点击回到进入前的模式）与模式菜单的"规划"项。
import '../../styles.css'
import type { ApprovalRequestPayload, SessionEntry } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { PlanTab } from '../right-panel/plan-tab.tsx'
import { RIGHT_PANEL_TABS } from '../right-panel/tabs.ts'
import { planDraftStore } from './plan-review-panel.tsx'

const PLAN = '# Fix the parser\n\n1. Read the code\n2. Add a test'
let seq = 0
/** 协议形状的条目（测试数据，按 kind 的 payload 由调用处保证）。 */
const entry = (kind: string, payload: unknown, runId: string | null = 'run-1') =>
  ({
    sessionId: 's-1',
    seq: ++seq,
    kind,
    payloadVersion: 1,
    payload,
    runId,
    createdAt: seq,
  }) as unknown as SessionEntry
const request: ApprovalRequestPayload = {
  requestId: 'r1',
  toolCallId: 'e1',
  toolName: 'exit_plan_mode',
  kind: 'plan',
  subject: 'Fix the parser',
  suggestions: [],
  planId: 'p1',
  revision: 1,
}
/** 菜单关闭后才结束用例（关闭中卸载会留下 Radix 对其余节点的 aria-hidden）。 */
async function menuClosed() {
  await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
}

afterEach(() => planDraftStore.setState({ drafts: {} }))

function wrap(node: React.ReactNode, chat = createFixtureChat().chat) {
  return render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={chat}>
        <TooltipProvider>{node}</TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

describe('右栏 Plan tab', () => {
  it('已交付：注册表中 plan 可用', () => {
    expect(RIGHT_PANEL_TABS.find((t) => t.id === 'plan')?.available).toBe(true)
  })

  it('显示最新修订与状态；审阅中可编辑（编辑进入共享草稿）；修订下拉切到旧修订', async () => {
    const { chat, sendServer } = createFixtureChat({ entries: { 's-1': [] } })
    await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
    const screen = await wrap(<PlanTab sessionId="s-1" />, chat)
    await expect.element(screen.getByText('No plan yet', { exact: false })).toBeVisible()
    seq = 0
    const rows = [
      entry('permission_mode', { mode: 'plan', prior: 'default' }, null),
      entry('run_start', { trigger: 'submit' }),
      entry('plan', { planId: 'p1', revision: 1, markdown: '# First idea', status: 'proposed' }, null),
      entry('plan', { planId: 'p1', revision: 1, markdown: '# First idea', status: 'rejected', feedback: 'too vague' }, null),
      entry('plan', { planId: 'p1', revision: 2, markdown: PLAN, status: 'proposed' }, null),
      entry('approval_request', { ...request, revision: 2 }),
    ]
    sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
    for (const e of rows) sendServer({ type: 'entry', sessionId: 's-1', entry: e })
    await expect.poll(() => chat.getState().conversations['s-1']?.running).toBe(true)
    const tab = () => screen.container.querySelector('[data-slot="plan-tab"]')
    await expect.poll(() => tab()?.getAttribute('data-revision')).toBe('2')
    expect(tab()?.getAttribute('data-status')).toBe('proposed')
    await expect.element(screen.getByText('Fix the parser')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.fill(screen.getByRole('textbox', { name: 'Edit plan' }), '# Fix the parser\n\nEdited')
    expect(planDraftStore.getState().drafts['s-1:p1:2']).toBe('# Fix the parser\n\nEdited')

    await userEvent.click(screen.getByRole('button', { name: 'Revisions' }))
    await userEvent.click(page.getByRole('menuitemradio', { name: /Revision 1/ }))
    await menuClosed()
    await expect.poll(() => tab()?.getAttribute('data-revision')).toBe('1')
    expect(tab()?.getAttribute('data-status')).toBe('rejected')
    await expect.element(screen.getByText('too vague')).toBeVisible()
    // 旧修订不在审阅中：没有编辑。
    expect(screen.container.querySelector('[data-action="plan-edit"]')).toBeNull()
  })
})

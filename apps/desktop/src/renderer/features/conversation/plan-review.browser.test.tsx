// 每个文件一个界面（Browser Mode 中同一文件里先后渲染多个含 Radix 菜单的界面时，后续用例的 getByRole 查询偶发失效，原因未定位）。
// Plan Mode 的界面：审阅卡（批准并执行、批准并允许编辑、继续规划、右栏中的编辑随批准提交、新计划自动打开一次）、右栏 Plan tab（修订、状态、编辑）、
// Plan chip（plan 模式时显示，点击回到进入前的模式）与模式菜单的"规划"项。
import '../../styles.css'
import type { AnswerApprovalRequest, ApprovalRequestPayload, SessionEntry } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { planDraftStore, PlanReviewPanel, restoredMode, setPlanDraft } from './plan-review-panel.tsx'

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
function planEntries(prior = 'accept-edits'): SessionEntry[] {
  seq = 100
  return [
    entry('permission_mode', { mode: 'plan', prior }, null),
    entry('run_start', { trigger: 'submit' }),
    entry('plan', { planId: 'p1', revision: 1, markdown: PLAN, status: 'proposed' }, null),
    entry('approval_request', request),
  ]
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

describe('审阅卡', () => {
  const panel = (answers: AnswerApprovalRequest[], opened: string[], entries = planEntries()) => (
    <PlanReviewPanel
      sessionId="s-1"
      request={request}
      entries={entries}
      answer={async (a) => {
        answers.push(a)
        return true
      }}
      onOpenPanel={() => opened.push('plan')}
    />
  )

  it('标出将恢复的模式；"批准并执行"不带 mode（缺省 prior）；新计划自动打开右栏一次', async () => {
    const answers: AnswerApprovalRequest[] = []
    const opened: string[] = []
    const screen = await wrap(panel(answers, opened))
    await expect.element(screen.getByRole('region', { name: 'Review plan' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: /Approve and run/ })).toHaveAttribute('data-restores', 'accept-edits')
    expect(screen.container.textContent).toContain('Accept edits')
    expect(opened).toEqual(['plan'])
    await userEvent.click(screen.getByRole('button', { name: /Approve and run/ }))
    expect(answers).toEqual([{ decision: 'allow' }])
    // 重新挂载同一请求：不再自动打开。
    screen.unmount()
    await wrap(panel([], opened))
    expect(opened).toEqual(['plan'])
  })

  it('编辑后的计划不合格（没有 # 标题）时不能批准', async () => {
    setPlanDraft('s-1', 'p1', 1, 'no heading')
    const screen = await wrap(panel([], []))
    await expect.element(screen.getByRole('alert')).toHaveTextContent('The plan must start with a # heading and be at most 64000 characters')
    await expect.element(screen.getByRole('button', { name: /Approve and run/ })).toBeDisabled()
  })

  it('继续规划：带反馈拒绝；空反馈不能发送', async () => {
    const answers: AnswerApprovalRequest[] = []
    const screen = await wrap(panel(answers, []))
    await userEvent.click(screen.getByRole('button', { name: 'Keep planning' }))
    await expect.element(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
    await userEvent.fill(screen.getByRole('textbox', { name: 'Tell the agent what to change' }), 'add tests first')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(answers).toEqual([{ decision: 'deny', feedback: 'add tests first' }])
  })

  it('restoredMode：plan 时为 prior（没有时 default），否则为当前模式', () => {
    expect(restoredMode(planEntries('read-only'))).toBe('read-only')
    expect(restoredMode([entry('permission_mode', { mode: 'plan' })])).toBe('default')
    expect(restoredMode([entry('permission_mode', { mode: 'full-access' })])).toBe('full-access')
  })
})

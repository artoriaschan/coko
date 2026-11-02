// Plan Mode 的界面：审阅卡（批准并执行、只在更窄时给出"批准并允许编辑"、继续规划、右栏中的编辑随批准提交、新计划自动打开一次）、右栏 Plan tab
// （修订、状态、编辑）、Plan chip（plan 模式时显示，点击回到进入前的模式）与三项权限快捷菜单。多个含 Radix 菜单的界面在同一文件中依次渲染：
// 每个用例等菜单关闭后才结束，共用 setup 断言没有遗留的 aria-hidden 与 pointer-events（testing/browser-setup.ts）。
import '../../styles.css'
import type { AnswerApprovalRequest, ApprovalRequestPayload, SessionEntry } from '@coko/protocol'
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
import { ModePicker } from './mode-picker.tsx'
import { PlanChip } from './plan-chip.tsx'
import { planDraftStore, PlanReviewPanel, restoredMode, setPlanDraft } from './plan-review-panel.tsx'

afterEach(() => planDraftStore.setState({ drafts: {} }))

describe('plan-review', () => {
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
      // 重新挂载同一请求：不再自动打开。unmount 是异步的（act），等它完成再渲染，否则之后的用例渲染为空。
      await screen.unmount()
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
})

describe('plan-approve-menu', () => {
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

  /** 菜单关闭后才结束用例（关闭中卸载会留下 Radix 对其余节点的 aria-hidden）。 */
  async function menuClosed() {
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
  }

  function wrap(node: React.ReactNode, chat = createFixtureChat().chat) {
    return render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <TooltipProvider>{node}</TooltipProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
  }

  describe('审阅卡：下拉批准', () => {
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

    it('批准并允许编辑（进入前为 full-access，accept-edits 更窄）：mode accept-edits；右栏中的编辑随批准提交（editedPlan）', async () => {
      const answers: AnswerApprovalRequest[] = []
      setPlanDraft('s-1', 'p1', 1, '# Fix the parser\n\nTests first')
      const screen = await wrap(panel(answers, [], planEntries('full-access')))
      await expect.element(screen.getByText('Edited')).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: 'More approval options' }))
      await userEvent.click(page.getByRole('menuitem', { name: 'Approve and allow edits' }))
      await menuClosed()
      expect(answers).toEqual([{ decision: 'allow', editedPlan: '# Fix the parser\n\nTests first', mode: 'accept-edits' }])
    })

    it.each(['read-only', 'default', 'accept-edits'])('进入前为 %s：不给出更宽的"批准并允许编辑"', async (prior) => {
      const screen = await wrap(panel([], [], planEntries(prior)))
      await expect.element(screen.getByRole('button', { name: /Approve/ })).toBeVisible()
      expect(screen.getByRole('button', { name: 'More approval options' }).query()).toBeNull()
    })
  })
})

describe('plan-tab', () => {
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
})

describe('plan-chip', () => {
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
  /** 菜单关闭后才结束用例（关闭中卸载会留下 Radix 对其余节点的 aria-hidden）。 */
  async function menuClosed() {
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
  }

  function wrap(node: React.ReactNode, chat = createFixtureChat().chat) {
    return render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <TooltipProvider>{node}</TooltipProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
  }

  describe('Plan chip 与模式菜单', () => {
    it.each(['', 'dark'])('权限按钮的图文字形居中、三项菜单可关闭并返回焦点（%s）', async (theme) => {
      const picked: string[] = []
      const screen = await wrap(
        <div className={theme}>
          <ModePicker value="default" onChange={(mode) => picked.push(mode)} />
        </div>,
      )
      const button = screen.getByRole('button', { name: /Ask for approval/ })
      const element = button.element()
      const before = element.getBoundingClientRect()
      expect(before.height).toBe(32)
      const icon = element.querySelector('svg')!.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(element.querySelector('span')!)
      const text = range.getBoundingClientRect()
      expect(Math.abs((icon.top + icon.bottom - text.top - text.bottom) / 2)).toBeLessThanOrEqual(1)
      await userEvent.click(button)
      expect(element.getBoundingClientRect().width).toBe(before.width)
      expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
      await expect.element(page.getByRole('menuitemradio', { name: /Ask for approval/ })).toHaveAttribute('aria-checked', 'true')
      await userEvent.keyboard('{Escape}')
      await menuClosed()
      expect(picked).toEqual([])
      await expect.poll(() => document.activeElement).toBe(element)
      await userEvent.click(button)
      await userEvent.click(page.getByRole('menuitemradio', { name: /Accept edits/ }))
      await menuClosed()
      expect(picked).toEqual(['accept-edits'])
      await expect.poll(() => document.activeElement).toBe(element)
    })
    it('plan 模式时显示 chip，点击回到 prior；其他模式不显示', async () => {
      seq = 0
      const { chat } = createFixtureChat({
        entries: { 's-1': [entry('permission_mode', { mode: 'accept-edits' }, null), entry('permission_mode', { mode: 'plan', prior: 'accept-edits' }, null)] },
      })
      await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
      const screen = await wrap(<PlanChip sessionId="s-1" />, chat)
      const chip = screen.getByRole('button', { name: /Exit planning/ })
      await expect.element(chip).toBeVisible()
      const before = chip.element().getBoundingClientRect()
      const label = chip.element().querySelector('[data-slot="plan-label"]')!
      const labelBefore = label.getBoundingClientRect()
      expect(before.height).toBe(28)
      expect(before.right - labelBefore.right).toBeGreaterThanOrEqual(12)
      await userEvent.hover(chip)
      expect(chip.element().getBoundingClientRect().width).toBe(before.width)
      expect(label.getBoundingClientRect().x).toBe(labelBefore.x)
      expect(getComputedStyle(chip.element().querySelector('.lucide-circle-x')!).display).not.toBe('none')
      await userEvent.click(chip)
      await expect.poll(() => chat.getState().conversations['s-1']?.pendingMode).toBe('accept-edits')
      await expect.poll(() => screen.container.querySelector('[data-slot="plan-chip"]')).toBeNull()
    })

    it('plan 按钮显示 prior，菜单只有三个选项且无勾选，选择可直接退出 plan', async () => {
      const picked: string[] = []
      const screen = await wrap(<ModePicker value="plan" prior="accept-edits" onChange={(m) => picked.push(m)} />)
      const button = screen.getByRole('button', { name: /Accept edits/ })
      await expect.element(button).toBeVisible()
      expect(button.element().querySelector('.lucide-chevron-down')).toBeNull()
      await userEvent.click(button)
      expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
      expect(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(0)
      await userEvent.click(page.getByRole('menuitemradio', { name: /Ask for approval/ }))
      await menuClosed()
      expect(picked).toEqual(['default'])
    })
  })
})

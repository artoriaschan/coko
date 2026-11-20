// Plan Mode 的界面（ADR 0028：规划是计划阶段，不是 Permission Mode）：审阅卡（只有"批准并执行"、继续规划、右栏中的编辑随批准提交、新计划自动
// 打开一次；卡上的执行权限即输入区同一个模式菜单，切换、风险确认与失败保留）、右栏 Plan tab（修订、状态、编辑）、Plan chip（计划阶段为规划中时显示，点击调用退出动作，失败时保留）与三项权限快捷菜单。多个含
// Radix 菜单的界面在同一文件中依次渲染：每个用例等菜单关闭后才结束，共用 setup 断言没有遗留的 aria-hidden 与 pointer-events（testing/browser-setup.ts）。
import '../../styles.css'
import type { AnswerApprovalRequest, ApprovalRequestPayload, PlanActionRequest, SessionEntry } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { ApiError } from '../../client/api.ts'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { PlanTab } from '../right-panel/plan-tab.tsx'
import { RIGHT_PANEL_TABS } from '../right-panel/tabs.ts'
import { ApprovalPanel } from './approval-panel.tsx'
import { ModePicker } from './mode-picker.tsx'
import { PlanChip } from './plan-chip.tsx'
import { planDraftStore, PlanReviewPanel, setPlanDraft } from './plan-review-panel.tsx'

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
  function planEntries(mode = 'accept-edits'): SessionEntry[] {
    seq = 100
    return [
      entry('permission_mode', { mode }, null),
      entry('plan_phase', { phase: 'planning' }, null),
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

    it('主按钮只有"批准并执行"：不带 mode，不标出恢复的模式，没有更多批准方式；新计划自动打开右栏一次', async () => {
      const answers: AnswerApprovalRequest[] = []
      const opened: string[] = []
      const screen = await wrap(panel(answers, opened))
      await expect.element(screen.getByRole('region', { name: 'Review plan' })).toBeVisible()
      const approve = screen.getByRole('button', { name: 'Approve and run', exact: true })
      await expect.element(approve).toBeVisible()
      expect(approve.element().hasAttribute('data-restores')).toBe(false)
      expect(screen.container.textContent).not.toContain('Accept edits')
      expect(screen.getByRole('button', { name: 'More approval options' }).query()).toBeNull()
      expect(opened).toEqual(['plan'])
      await userEvent.click(approve)
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
  })
})

describe('plan-approve-edited', () => {
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
  function planEntries(mode = 'accept-edits'): SessionEntry[] {
    seq = 100
    return [
      entry('permission_mode', { mode }, null),
      entry('plan_phase', { phase: 'planning' }, null),
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

  describe('审阅卡：编辑后批准', () => {
    const panel = (answers: AnswerApprovalRequest[], entries: SessionEntry[]) => (
      <PlanReviewPanel
        sessionId="s-1"
        request={request}
        entries={entries}
        answer={async (a) => {
          answers.push(a)
          return true
        }}
      />
    )

    // 票 04（ADR 0028）起批准不改变模式：原先“进入前为 full-access 时给出批准并允许编辑（mode accept-edits）”的用例改为断言任何模式下都没有该入口。
    it.each(['read-only', 'default', 'accept-edits', 'full-access'])(
      '%s 下：右栏中的编辑随批准提交（editedPlan），不带 mode；没有"批准并允许编辑"',
      async (mode) => {
        const answers: AnswerApprovalRequest[] = []
        setPlanDraft('s-1', 'p1', 1, '# Fix the parser\n\nTests first')
        const screen = await wrap(panel(answers, planEntries(mode)))
        await expect.element(screen.getByText('Edited')).toBeVisible()
        expect(screen.getByRole('button', { name: 'More approval options' }).query()).toBeNull()
        expect(screen.container.textContent).not.toContain('Approve and allow edits')
        await userEvent.click(screen.getByRole('button', { name: 'Approve and run', exact: true }))
        expect(answers).toEqual([{ decision: 'allow', editedPlan: '# Fix the parser\n\nTests first' }])
      },
    )
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
        entry('plan_phase', { phase: 'planning' }, null),
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
      expect(getComputedStyle(element).userSelect).toBe('none')
      await userEvent.click(button)
      expect(element.getBoundingClientRect().width).toBe(before.width)
      expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
      expect(getComputedStyle(document.querySelector('[role="menuitemradio"]')!).userSelect).toBe('none')
      await expect.element(page.getByRole('menuitemradio', { name: /Ask for approval/ })).toHaveAttribute('aria-checked', 'true')
      await userEvent.keyboard('{Escape}')
      await menuClosed()
      expect(picked).toEqual([])
      await expect.poll(() => document.activeElement).toBe(element)
      expect(element.matches(':focus-visible')).toBe(true)
      await userEvent.click(button)
      await userEvent.click(page.getByRole('menuitemradio', { name: /Accept edits/ }))
      await menuClosed()
      expect(picked).toEqual(['accept-edits'])
      await expect.poll(() => document.activeElement).toBe(element)
      // 指针点选关闭也归还焦点，但不留下键盘焦点环。
      expect(element.matches(':focus-visible')).toBe(false)
    })
    it('计划阶段为规划中时显示 chip（与 Permission Mode 无关），× 调用退出动作且不改变模式；退出条目到达后消失', async () => {
      seq = 0
      const { chat, api, sendServer } = createFixtureChat({
        entries: { 's-1': [entry('permission_mode', { mode: 'accept-edits' }, null), entry('plan_phase', { phase: 'planning' }, null)] },
      })
      const calls: string[] = []
      api.planAction = async (id: string, action: PlanActionRequest['action']) => {
        calls.push(`${id}:${action}`)
        return { phase: 'none' as const, plan: null }
      }
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
      expect(getComputedStyle(chip.element().querySelector('.tabler-icon-circle-x')!).display).not.toBe('none')
      await userEvent.click(chip)
      await expect.poll(() => calls).toEqual(['s-1:exit'])
      // 不乐观移除：chip 由条目派生，退出条目到达后才消失；模式不变。
      expect(screen.container.querySelector('[data-slot="plan-chip"]')).not.toBeNull()
      expect(chat.getState().conversations['s-1']?.pendingMode).toBeUndefined()
      sendServer({ type: 'entry', sessionId: 's-1', entry: entry('plan_phase', { phase: 'none' }, null) })
      await expect.poll(() => screen.container.querySelector('[data-slot="plan-chip"]')).toBeNull()
    })

    // 票 06：renderer 与服务端同用 planPhaseOf（有效条目），回退条目到达后 chip 与 Plan 页随之变化，与协议读回一致。
    it('回退后按有效条目派生：回退到批准之前 chip 重新出现、被回退的已批准修订不再显示；回退到进入规划之前 chip 消失、没有计划', async () => {
      seq = 0
      const user = (text: string) => entry('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 0 }, null)
      const rows = [
        entry('permission_mode', { mode: 'default' }, null),
        user('first'),
        entry('plan_phase', { phase: 'planning' }, null),
        user('research'),
        entry('plan', { planId: 'p1', revision: 1, markdown: '# First idea', status: 'proposed' }, null),
        entry('plan', { planId: 'p1', revision: 1, markdown: '# First idea', status: 'rejected', feedback: 'too vague' }, null),
        user('submit'),
        entry('plan', { planId: 'p1', revision: 2, markdown: '# Second idea', status: 'proposed' }, null),
        entry('plan', { planId: 'p1', revision: 2, markdown: '# Second idea', status: 'approved' }, null),
        entry('plan_phase', { phase: 'none' }, null),
      ]
      const { chat, sendServer } = createFixtureChat({ entries: { 's-1': rows } })
      await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
      const screen = await wrap(
        <>
          <PlanChip sessionId="s-1" />
          <PlanTab sessionId="s-1" />
        </>,
        chat,
      )
      const chip = () => screen.container.querySelector('[data-slot="plan-chip"]')
      const tab = () => screen.container.querySelector('[data-slot="plan-tab"]')
      await expect.poll(() => [tab()?.getAttribute('data-revision'), tab()?.getAttribute('data-status')]).toEqual(['2', 'approved'])
      expect(chip()).toBeNull()

      sendServer({ type: 'entry', sessionId: 's-1', entry: entry('rewind', { targetSeq: rows[6]!.seq }, null) })
      await expect.poll(() => chip()).not.toBeNull()
      await expect.poll(() => [tab()?.getAttribute('data-revision'), tab()?.getAttribute('data-status')]).toEqual(['1', 'rejected'])

      sendServer({ type: 'entry', sessionId: 's-1', entry: entry('rewind', { targetSeq: rows[1]!.seq }, null) })
      await expect.poll(() => chip()).toBeNull()
      await expect.element(screen.getByText('No plan yet', { exact: false })).toBeVisible()
    })

    it('退出失败：chip 保留且可再次点击；旧数据（plan 模式已读为 prior，没有阶段条目）与草稿都不显示 chip', async () => {
      seq = 0
      const { chat, api } = createFixtureChat({
        entries: {
          's-1': [entry('plan_phase', { phase: 'planning' }, null)],
          // 服务端读取时已把 permission_mode v2 的 plan 迁移为 prior（v3）。
          's-3': [entry('permission_mode', { mode: 'default' }, null)],
        },
      })
      let attempts = 0
      api.planAction = async () => {
        attempts++
        throw new ApiError('network', 'down', 0)
      }
      await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
      const screen = await wrap(
        <>
          <PlanChip sessionId="s-1" />
          <PlanChip sessionId="s-3" />
          <PlanChip sessionId={null} />
        </>,
        chat,
      )
      const chip = screen.getByRole('button', { name: /Exit planning/ })
      await userEvent.click(chip)
      await expect.poll(() => attempts).toBe(1)
      await expect.element(chip).toBeEnabled()
      expect(screen.container.querySelectorAll('[data-slot="plan-chip"]')).toHaveLength(1)
    })

    it('选择完全访问权限先显示风险提示，取消不改变，确认后才生效', async () => {
      const picked: string[] = []
      const screen = await wrap(<ModePicker value="default" onChange={(m) => picked.push(m)} />)
      const button = screen.getByRole('button', { name: /Ask for approval/ })
      await userEvent.click(button)
      await userEvent.click(page.getByRole('menuitemradio', { name: /Full access/ }))
      const dialog = page.getByRole('alertdialog', { name: /Turn on full access/ })
      await expect.element(dialog).toBeVisible()
      expect(picked).toEqual([])
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
      await expect.element(dialog).not.toBeInTheDocument()
      expect(picked).toEqual([])
      await userEvent.click(button)
      await userEvent.click(page.getByRole('menuitemradio', { name: /Full access/ }))
      await expect.element(dialog).toBeVisible()
      await userEvent.click(dialog.getByRole('button', { name: 'Turn on anyway' }))
      await expect.poll(() => picked).toEqual(['full-access'])
    })
  })
})

describe('plan-review-permission', () => {
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

  /** 当前会话 s-1 等待计划审阅（accept-edits）；审阅卡经 ApprovalPanel 读取会话的模式与切换动作。 */
  async function reviewing() {
    seq = 100
    const fixture = createFixtureChat({
      entries: {
        's-1': [
          entry('permission_mode', { mode: 'accept-edits' }, null),
          entry('plan_phase', { phase: 'planning' }, null),
          entry('run_start', { trigger: 'submit' }),
          entry('plan', { planId: 'p1', revision: 1, markdown: PLAN, status: 'proposed' }, null),
          entry('approval_request', request),
        ],
      },
    })
    const modes: string[] = []
    const answers: AnswerApprovalRequest[] = []
    fixture.api.setPermissionMode = async (id, mode) => {
      modes.push(`${id}:${mode}`)
      return { mode, rules: [] }
    }
    fixture.api.answerApproval = async (_id, _requestId, answer) => {
      answers.push(answer)
    }
    fixture.chat.getState().openSession('s-1')
    await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
    const screen = await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={fixture.chat}>
          <TooltipProvider>
            <ApprovalPanel request={request} call={undefined} onAllow={async () => true} onReject={async () => true} />
          </TooltipProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
    const card = screen.getByRole('region', { name: 'Review plan' })
    return { ...fixture, screen, card, modes, answers }
  }

  it('标出执行权限（当前 Permission Mode）；切换后显示新模式，模式条目到达后审阅仍在等待，批准不带 mode', async () => {
    const { card, modes, answers, sendServer } = await reviewing()
    const runsWith = card.getByRole('group', { name: 'Runs with' })
    await expect.element(runsWith).toBeVisible()
    const picker = runsWith.getByRole('button', { name: 'Permission mode: Accept edits' })
    await expect.element(picker).toBeVisible()
    await userEvent.click(picker)
    await expect.element(page.getByRole('menuitemradio', { name: /Accept edits/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(page.getByRole('menuitemradio', { name: /Ask for approval/ }))
    await menuClosed()
    await expect.poll(() => modes).toEqual(['s-1:default'])
    await expect.element(runsWith.getByRole('button', { name: 'Permission mode: Ask for approval' })).toBeVisible()
    sendServer({ type: 'entry', sessionId: 's-1', entry: entry('permission_mode', { mode: 'default' }, null) })
    await expect.element(runsWith.getByRole('button', { name: 'Permission mode: Ask for approval' })).toBeVisible()
    await userEvent.click(card.getByRole('button', { name: 'Approve and run', exact: true }))
    await expect.poll(() => answers).toEqual([{ decision: 'allow' }])
  })

  it('选择完全访问权限先确认风险：取消不切换，确认后才切换', async () => {
    const { card, modes } = await reviewing()
    const picker = card.getByRole('button', { name: 'Permission mode: Accept edits' })
    await userEvent.click(picker)
    await userEvent.click(page.getByRole('menuitemradio', { name: /Full access/ }))
    const dialog = page.getByRole('alertdialog', { name: /Turn on full access/ })
    await expect.element(dialog).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await expect.element(dialog).not.toBeInTheDocument()
    expect(modes).toEqual([])
    await expect.element(card.getByRole('button', { name: 'Permission mode: Accept edits' })).toBeVisible()
    await userEvent.click(picker)
    await userEvent.click(page.getByRole('menuitemradio', { name: /Full access/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Turn on anyway' }))
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.poll(() => modes).toEqual(['s-1:full-access'])
    await expect.element(card.getByRole('button', { name: 'Permission mode: Full access' })).toBeVisible()
  })

  it('切换失败：保留原显示，审批请求仍可回答', async () => {
    const { card, api, answers } = await reviewing()
    let attempts = 0
    api.setPermissionMode = async () => {
      attempts++
      throw new ApiError('network', 'down', 0)
    }
    await userEvent.click(card.getByRole('button', { name: 'Permission mode: Accept edits' }))
    await userEvent.click(page.getByRole('menuitemradio', { name: /Ask for approval/ }))
    await menuClosed()
    await expect.poll(() => attempts).toBe(1)
    await expect.element(card.getByRole('button', { name: 'Permission mode: Accept edits' })).toBeVisible()
    await userEvent.click(card.getByRole('button', { name: 'Approve and run', exact: true }))
    await expect.poll(() => answers).toEqual([{ decision: 'allow' }])
  })
})

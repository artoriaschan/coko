// Plan Mode 的界面：审阅卡（批准并执行、批准并允许编辑、继续规划、右栏中的编辑随批准提交、新计划自动打开一次）、右栏 Plan tab（修订、状态、编辑）、
// Plan chip（plan 模式时显示，点击回到进入前的模式）与模式菜单的"规划"项。
import '../../styles.css'
import type { SessionEntry } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { ModePicker } from './mode-picker.tsx'
import { PlanChip } from './plan-chip.tsx'
import { planDraftStore } from './plan-review-panel.tsx'

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

describe('Plan chip 与模式菜单', () => {
  it('plan 模式时显示 chip，点击回到 prior；其他模式不显示', async () => {
    seq = 0
    const { chat } = createFixtureChat({
      entries: { 's-1': [entry('permission_mode', { mode: 'accept-edits' }, null), entry('permission_mode', { mode: 'plan', prior: 'accept-edits' }, null)] },
    })
    await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
    const screen = await wrap(<PlanChip sessionId="s-1" />, chat)
    const chip = screen.getByRole('button', { name: /Exit planning/ })
    await expect.element(chip).toBeVisible()
    await expect.element(chip).toHaveAttribute('title', 'Back to Accept edits')
    await userEvent.click(chip)
    await expect.poll(() => chat.getState().conversations['s-1']?.pendingMode).toBe('accept-edits')
    await expect.poll(() => screen.container.querySelector('[data-slot="plan-chip"]')).toBeNull()
  })

  it('模式菜单另列"规划"，选中时回调 plan；当前为 plan 时按钮显示规划', async () => {
    const picked: string[] = []
    const screen = await wrap(<ModePicker value="plan" onChange={(m) => picked.push(m)} />)
    expect(screen.container.querySelector('[data-permission-mode="plan"]')?.textContent).toContain('Plan')
    await userEvent.click(screen.getByRole('button', { name: /Plan/ }))
    await expect.element(page.getByRole('menuitemradio', { name: /Plan/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(page.getByRole('menuitemradio', { name: /Default/ }))
    await menuClosed()
    expect(picked).toEqual(['default'])
  })
})

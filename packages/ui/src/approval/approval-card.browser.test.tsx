import '../styles/theme.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ApprovalCard, type ApprovalCardProps } from './approval-card.tsx'

afterEach(() => {
  document.body.innerHTML = ''
})

const labels = {
  status: 'Waiting for approval',
  detailLabel: 'Request details',
  allowOnce: 'Allow once',
  reject: 'Reject',
  rejectWithReason: 'Reject with a reason',
  feedbackLabel: 'Reason',
  feedbackPlaceholder: 'Tell Coko what to do instead',
}

function setup(overrides: Partial<ApprovalCardProps> = {}) {
  const onAllow = vi.fn<ApprovalCardProps['onAllow']>(async () => {})
  const onReject = vi.fn<ApprovalCardProps['onReject']>(async () => {})
  const props: ApprovalCardProps = { requestKey: 'r1', title: 'Run this command?', labels, onAllow, onReject, children: <code>printf hi</code>, ...overrides }
  return { onAllow, onReject, props }
}

const detail = () => page.getByRole('group', { name: 'Request details' })
const detailElement = () => detail().element() as HTMLElement

function keydown(target: HTMLElement, init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  target.dispatchEvent(event)
  return event
}

describe('ApprovalCard', () => {
  it('焦点在详情时 Enter 允许一次', async () => {
    const { onAllow, onReject, props } = setup()
    await render(<ApprovalCard {...props} />)
    detailElement().focus()
    await userEvent.keyboard('{Enter}')
    expect(onAllow).toHaveBeenCalledOnce()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('焦点在详情时 Esc 拒绝（无反馈），并阻止默认处理（不触发全局停止）', async () => {
    const { onAllow, onReject, props } = setup()
    await render(<ApprovalCard {...props} />)
    const event = keydown(detailElement(), { key: 'Escape' })
    expect(event.defaultPrevented).toBe(true)
    await expect.poll(() => onReject.mock.calls).toEqual([[]])
    expect(onAllow).not.toHaveBeenCalled()
  })

  it('焦点不在卡片内时 Enter 不回答', async () => {
    const { onAllow, props } = setup()
    await render(
      <>
        <input aria-label="outside" />
        <ApprovalCard {...props} />
      </>,
    )
    await page.getByRole('textbox', { name: 'outside' }).click()
    await userEvent.keyboard('{Enter}')
    expect(onAllow).not.toHaveBeenCalled()
  })

  it('同一请求点击两次只回答一次；回答期间按钮禁用', async () => {
    let finish!: () => void
    const onAllow = vi.fn<ApprovalCardProps['onAllow']>(() => new Promise<void>((resolve) => (finish = resolve)))
    const { props } = setup({ onAllow })
    await render(<ApprovalCard {...props} />)
    const allow = page.getByRole('button', { name: 'Allow once' })
    await allow.click()
    ;(allow.element() as HTMLButtonElement).click()
    keydown(detailElement(), { key: 'Enter' })
    await expect.element(allow).toBeDisabled()
    expect(onAllow).toHaveBeenCalledOnce()
    finish()
  })

  it('回答失败后可以再次回答；新请求（requestKey 变化）重置状态', async () => {
    const onAllow = vi.fn<ApprovalCardProps['onAllow']>().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
    const { props } = setup({ onAllow })
    const screen = await render(<ApprovalCard {...props} />)
    await page.getByRole('button', { name: 'Allow once' }).click()
    await expect.element(page.getByRole('button', { name: 'Allow once' })).toBeEnabled()
    await page.getByRole('button', { name: 'Allow once' }).click()
    expect(onAllow).toHaveBeenCalledTimes(2)
    await expect.element(page.getByRole('button', { name: 'Allow once' })).toBeDisabled()
    await screen.rerender(<ApprovalCard {...props} requestKey="r2" />)
    await expect.element(page.getByRole('button', { name: 'Allow once' })).toBeEnabled()
  })

  it('输入法组合中 Enter / Esc 不回答（Chrome 与 Safari 两种事件序列）', async () => {
    const { onAllow, onReject, props } = setup()
    await render(<ApprovalCard {...props} />)
    const root = detailElement()
    root.focus()
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    keydown(root, { key: 'Enter', isComposing: true, keyCode: 229 })
    keydown(root, { key: 'Escape', isComposing: true, keyCode: 229 })
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    keydown(root, { key: 'Enter', keyCode: 229 })
    expect(onAllow).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('带原因拒绝：展开输入框，输入中的 Enter 提交拒绝与反馈，不允许', async () => {
    const { onAllow, onReject, props } = setup()
    await render(<ApprovalCard {...props} />)
    await page.getByRole('button', { name: 'Reject with a reason' }).click()
    const reason = page.getByRole('textbox', { name: 'Reason' })
    await expect.element(reason).toHaveFocus()
    await reason.fill('use notes/ instead')
    await userEvent.keyboard('{Enter}')
    expect(onReject).toHaveBeenCalledExactlyOnceWith('use notes/ instead')
    expect(onAllow).not.toHaveBeenCalled()
  })

  it('没有反馈时 Esc 在原因输入框中收起输入框，不拒绝', async () => {
    const { onReject, props } = setup()
    await render(<ApprovalCard {...props} />)
    await page.getByRole('button', { name: 'Reject with a reason' }).click()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('textbox', { name: 'Reason' })).not.toBeInTheDocument()
    expect(onReject).not.toHaveBeenCalled()
  })
})

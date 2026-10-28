import '../styles/theme.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ConfirmationCard, type ConfirmationCardProps } from './confirmation-card.tsx'

afterEach(() => {
  document.body.innerHTML = ''
})

const labels = {
  status: 'Outcome unknown',
  detailLabel: 'Interrupted call',
  applied: 'It took effect',
  notApplied: 'It did not take effect',
  unknown: 'Not sure',
}

function setup(overrides: Partial<ConfirmationCardProps> = {}) {
  const onAnswer = vi.fn<ConfirmationCardProps['onAnswer']>(async () => {})
  const props: ConfirmationCardProps = {
    requestKey: 'c1',
    title: 'Did this command take effect?',
    labels,
    onAnswer,
    children: <code>touch done</code>,
    ...overrides,
  }
  return { onAnswer, props }
}

describe('ConfirmationCard', () => {
  it('三个回答各自对应 applied / not-applied / unknown', async () => {
    for (const [name, answer] of [
      ['It took effect', 'applied'],
      ['It did not take effect', 'not-applied'],
      ['Not sure', 'unknown'],
    ] as const) {
      const { onAnswer, props } = setup()
      const view = await render(<ConfirmationCard {...props} />)
      await page.getByRole('button', { name }).click()
      expect(onAnswer.mock.calls).toEqual([[answer]])
      await view.unmount()
    }
  })

  it('同一请求只回答一次；回答失败后解锁可重答', async () => {
    let fail = true
    const onAnswer = vi.fn<ConfirmationCardProps['onAnswer']>(async () => {
      if (fail) throw new Error('rejected')
    })
    const { props } = setup({ onAnswer })
    await render(<ConfirmationCard {...props} />)
    await page.getByRole('button', { name: 'Not sure' }).click()
    await expect.poll(() => (page.getByRole('button', { name: 'Not sure' }).element() as HTMLButtonElement).disabled).toBe(false)
    fail = false
    await page.getByRole('button', { name: 'It did not take effect' }).click()
    await expect.poll(() => (page.getByRole('button', { name: 'It took effect' }).element() as HTMLButtonElement).disabled).toBe(true)
    expect(onAnswer.mock.calls).toEqual([['unknown'], ['not-applied']])
  })

  it('没有默认回答：焦点在详情时 Enter 与 Esc 不代替用户作答', async () => {
    const { onAnswer, props } = setup()
    await render(<ConfirmationCard {...props} />)
    ;(page.getByRole('group', { name: 'Interrupted call' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Escape}')
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('autoFocus 时出现即聚焦卡片本身，Tab 进入详情', async () => {
    const { props } = setup({ autoFocus: true })
    await render(<ConfirmationCard {...props} />)
    expect(document.activeElement?.getAttribute('data-slot')).toBe('confirmation-card')
    await userEvent.tab()
    expect(document.activeElement?.getAttribute('data-slot')).toBe('confirmation-detail')
  })
})

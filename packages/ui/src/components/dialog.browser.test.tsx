import '../styles/theme.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog.tsx'
import { Toaster } from './sonner.tsx'

// vitest-browser-react 在每个用例之间卸载渲染结果；这里只清掉全局的 Toast 队列。
afterEach(() => {
  toast.dismiss()
})

/** 模态对话框与 Toast 宿主是兄弟节点（与应用中的装配一致）。 */
function Fixture({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <button type="button">Before</button>
      <Dialog>
        <DialogTrigger>Open settings</DialogTrigger>
        <DialogContent closeLabel="Close" aria-describedby={undefined}>
          <DialogTitle>Settings</DialogTitle>
          <input aria-label="Name" />
          <button type="button" onClick={() => toast.error('Save failed', { action: { label: 'Retry', onClick: onRetry } })}>
            Save
          </button>
        </DialogContent>
      </Dialog>
      <Toaster containerAriaLabel="Notifications" />
    </>
  )
}

const active = () => document.activeElement as HTMLElement | null
const inDialog = () => active()?.closest('[role="dialog"]') !== null
const inToaster = () => active()?.closest('[data-sonner-toaster]') !== null
const retry = () => document.querySelector<HTMLButtonElement>('[data-sonner-toast] [data-button]')

/** 按 Tab（或 Shift+Tab）直到焦点满足条件；每一步焦点都必须留在对话框或 Toast 内。 */
async function tabUntil(reached: () => boolean, { shift = false, max = 10 } = {}) {
  for (let i = 0; i < max; i++) {
    await userEvent.keyboard(shift ? '{Shift>}{Tab}{/Shift}' : '{Tab}')
    expect(inDialog() || inToaster(), `focus escaped to ${active()?.outerHTML.slice(0, 80)}`).toBe(true)
    if (reached()) return
  }
  throw new Error('focus never reached the target')
}

describe('模态对话框中的 Toast', () => {
  it('Tab 能从对话框到达 Toast 的动作按钮，Enter 触发动作，对话框保持打开', async () => {
    const onRetry = vi.fn<() => void>()
    await render(<Fixture onRetry={onRetry} />)
    await page.getByRole('button', { name: 'Open settings' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => retry()).not.toBeNull()

    await tabUntil(() => active() === retry())
    await userEvent.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledOnce()
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  })

  it('从 Toast 继续 Tab 回到对话框内；Shift+Tab 从对话框第一个元素也能到达 Toast', async () => {
    await render(<Fixture onRetry={() => {}} />)
    await page.getByRole('button', { name: 'Open settings' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => retry()).not.toBeNull()

    await tabUntil(() => active() === retry())
    await tabUntil(() => inDialog())
    ;(document.querySelector('[role="dialog"] input') as HTMLInputElement).focus()
    await tabUntil(() => inToaster(), { shift: true })
  })

  it('关闭对话框后焦点回到打开它的按钮', async () => {
    await render(<Fixture onRetry={() => {}} />)
    const trigger = page.getByRole('button', { name: 'Open settings' })
    await trigger.click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => retry()).not.toBeNull()
    await tabUntil(() => active() === retry())
    await userEvent.keyboard('{Enter}')
    // 动作之后焦点仍在对话框或 Toast 中，Escape 关闭对话框。
    ;(document.querySelector('[role="dialog"] input') as HTMLInputElement).focus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.poll(() => active()).toBe(trigger.element())
  })

  it('没有 Toast 时 Tab 仍在对话框内循环', async () => {
    await render(<Fixture onRetry={() => {}} />)
    await page.getByRole('button', { name: 'Open settings' }).click()
    for (let i = 0; i < 5; i++) {
      await userEvent.keyboard('{Tab}')
      expect(inDialog()).toBe(true)
    }
  })
})

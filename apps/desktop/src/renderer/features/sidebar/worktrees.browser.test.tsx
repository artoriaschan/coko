// 侧栏的 worktree 对话框（docs/subsystems/worktrees.md）：新建失败的提示在重新打开时清空；移除提交中关闭确认、再移除另一个 worktree 时
// 按钮为初始状态（对话框由父组件的 key 重新挂载，不用 effect 镜像重置）。
import '../../styles.css'
import type { Worktree } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createWorktreesStore, type WorktreesBackend } from '../../stores/worktrees-store.ts'
import { createFixtureChat, fixtureWorkspaces } from '../../testing/fixture-chat.ts'
import { WorkspaceWorktreeMenu, WorktreesStoreProvider } from './worktrees.tsx'

const workspace = fixtureWorkspaces[0]!
const worktree = (id: string): Worktree => ({
  id,
  workspaceId: workspace.id,
  name: `wt-${id}`,
  path: `${workspace.path}/.coko-worktrees/wt-${id}`,
  branch: `coko/wt-${id}`,
  baseCommit: '0000000',
  status: 'active',
  createdBy: 'user',
  sessionCount: 0,
})

function mount(backend: WorktreesBackend) {
  const { chat } = createFixtureChat()
  return render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={chat}>
        <WorktreesStoreProvider store={createWorktreesStore(backend)}>
          <TooltipProvider>
            <WorkspaceWorktreeMenu workspace={workspace} onOpened={() => {}} />
          </TooltipProvider>
        </WorktreesStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

const dialog = () => page.getByRole('dialog')
const closed = async () => {
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
}
async function menuItem(name: string) {
  await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
  await expect.poll(() => document.body.style.pointerEvents).toBe('')
  await userEvent.click(page.getByRole('button', { name: `More actions for ${workspace.name}` }))
  await userEvent.click(page.getByRole('menuitem', { name }))
}

describe('worktree 对话框', () => {
  it('新建失败后取消、再打开：名称与错误提示为初始状态', async () => {
    await mount({
      list: async () => [],
      create: async () => Promise.reject(new ApiError('invalid-name', 'bad name', 400)),
      createSession: async () => Promise.reject(new Error('unused')),
      remove: async () => {},
    })
    await menuItem('New session in a new worktree')
    await page.getByRole('textbox', { name: /Name/ }).fill('bad name')
    await userEvent.click(dialog().getByRole('button', { name: 'Create' }))
    await expect.element(dialog().getByRole('alert')).toBeVisible()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await closed()
    await menuItem('New session in a new worktree')
    await expect.element(page.getByRole('textbox', { name: /Name/ })).toHaveValue('')
    expect(document.querySelector('[data-slot="worktree-error"]')).toBeNull()
    await expect.element(dialog().getByRole('button', { name: 'Create' })).toBeEnabled()
    await userEvent.keyboard('{Escape}')
    await closed()
  })

  it('移除提交中关闭确认、再移除另一个：确认按钮为初始状态', async () => {
    let finish!: () => void
    await mount({
      list: async () => [worktree('a'), worktree('b')],
      create: async () => Promise.reject(new Error('unused')),
      createSession: async () => Promise.reject(new Error('unused')),
      remove: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    await menuItem('Worktrees…')
    const remove = (id: string) => document.querySelector<HTMLElement>(`li[data-worktree-id="${id}"] [data-action="remove-worktree"]`)
    await expect.poll(() => remove('a')).not.toBeNull()
    await userEvent.click(remove('a')!)
    await userEvent.click(dialog().getByRole('button', { name: 'Remove', exact: true }))
    await expect.element(dialog().getByRole('button', { name: 'Removing…' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    // 确认关闭后回到列表。
    await expect.poll(() => remove('b')).not.toBeNull()
    await userEvent.click(remove('b')!)
    await expect.poll(() => document.querySelector('[data-slot="remove-worktree-dialog"]')?.textContent).toContain('wt-b')
    await expect.element(dialog().getByRole('button', { name: 'Remove', exact: true })).toBeEnabled()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await expect.poll(() => remove('b')).not.toBeNull()
    await userEvent.click(dialog().getByRole('button', { name: 'Close' }).last())
    await closed()
    finish()
  })
})

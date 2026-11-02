import '../../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { createBranchesStore } from '../../stores/branches-store.ts'
import { BranchesProvider } from './project-git-menu.tsx'
import { ApiError } from '../../client/api.ts'

it.each(['light', 'dark'] as const)(
  'CW-36/38/39/40 (%s): pending project, layered overlapping submenu and focus return, stable validation, pending and failed create keeps form and branch',
  async (theme) => {
    await page.viewport(1280, 960)
    const fixture = createFixtureChat()
    let release!: () => void
    let requests = 0
    const branches = createBranchesStore({
      list: async () => ({
        available: true,
        current: 'main',
        branches: [
          { name: 'main', committedAt: 2 },
          { name: 'feature', committedAt: 1 },
        ],
      }),
      checkout: async () => {
        requests++
        await new Promise<void>((resolve) => {
          release = resolve
        })
        throw new ApiError('git-dirty', 'dirty', 409)
      },
    })
    const appearance = createAppearanceStore({ locale: 'zh', theme })
    const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
    const screen = await render(
      <div style={{ width: 1200, height: 900 }}>
        <BranchesProvider store={branches}>
          <App
            store={appearance}
            connection={createConnectionStore()}
            chat={fixture.chat}
            settings={fixture.settings}
            preferences={preferences}
            settingsPage={createSettingsPageStore()}
            pickDirectory={async () => null}
          />
        </BranchesProvider>
      </div>,
    )
    await page.getByRole('button', { name: '新对话', exact: true }).click()
    await page.getByRole('button', { name: '项目配置', exact: true }).click()
    await expect.element(page.getByText('选择项目后可配置分支')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    fixture.chat.newChat.getState().selectProject('project-w-coko')
    await page.getByRole('button', { name: '项目配置', exact: true }).click()
    const parent = page.getByRole('menu', { name: '项目配置' })
    const trigger = page.getByRole('menuitem', { name: '分支 main', exact: true })
    await trigger.click()
    const sub = page.getByRole('menu', { name: '搜索本地分支' })
    await expect.element(page.getByRole('textbox', { name: '搜索本地分支' })).toHaveFocus()
    await expect
      .poll(() => {
        const a = parent.element().getBoundingClientRect(),
          b = sub.element().getBoundingClientRect()
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0
      })
      .toBe(true)
    expect(Number(getComputedStyle(sub.element()).zIndex)).toBeGreaterThan(Number(getComputedStyle(parent.element()).zIndex))
    await page.screenshot({
      element: document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!,
      path: `../../../../../../.vitest/cw20-submenu-${theme}.png`,
    })
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
    await expect.element(parent).toBeVisible()
    await trigger.click()
    await page.getByRole('menuitem', { name: '创建并检出新分支…' }).click()
    const dialog = page.getByRole('dialog', { name: '创建并检出新分支' })
    const name = page.getByRole('textbox', { name: '分支名称', exact: true })
    await expect.element(name).toHaveFocus()
    await expect.element(parent).not.toBeInTheDocument()
    await Promise.all(
      dialog
        .element()
        .getAnimations()
        .map((animation) => animation.finished),
    )
    const bounds = dialog.element().getBoundingClientRect()
    await name.fill('team/')
    await expect.element(page.getByText('分支名不能以“/”结尾')).toBeVisible()
    const invalidBounds = dialog.element().getBoundingClientRect()
    expect([invalidBounds.y, invalidBounds.height]).toEqual([bounds.y, bounds.height])
    const submit = page.getByRole('button', { name: '创建并检出', exact: true })
    await expect.element(submit).toBeDisabled()
    await name.fill('team/feature')
    await submit.click()
    await expect.element(page.getByRole('button', { name: '正在创建…' })).toBeDisabled()
    expect(requests).toBe(1)
    release()
    await expect.element(page.getByText('主要文件夹有未提交的改动，提交或处理改动后重试')).toBeVisible()
    await expect.element(name).toHaveValue('team/feature')
    expect(branches.getState().projects['project-w-coko']?.current).toBe('main')
    await page.screenshot({ element: dialog.element() as HTMLElement, path: `../../../../../../.vitest/cw20-create-error-${theme}.png` })
    await page.getByRole('button', { name: '关闭', exact: true }).last().click()
    await screen.unmount()
  },
)

it('local branch search, busy refusal preserves selection, successful checkout echoes in parent; base-branch selection never checks out', async () => {
  await page.viewport(1280, 960)
  const fixture = createFixtureChat({ sessions: [] })
  let current = 'main',
    refused = true,
    calls = 0
  const result = () => ({
    available: true,
    current,
    branches: [
      { name: current, committedAt: 2 },
      { name: current === 'main' ? 'feature' : 'main', committedAt: 1 },
    ],
  })
  const branches = createBranchesStore({
    list: async () => result(),
    checkout: async (_id, input) => {
      calls++
      if (refused) throw new ApiError('session-busy', 'busy', 409)
      current = input.name
      return result()
    },
  })
  const appearance = createAppearanceStore({ locale: 'zh', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = await render(
    <div style={{ width: 1200, height: 900 }}>
      <BranchesProvider store={branches}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </BranchesProvider>
    </div>,
  )
  fixture.chat.newChat.getState().selectProject('project-w-coko')
  const configuration = page.getByRole('button', { name: '项目配置', exact: true })
  await configuration.click()
  await page.getByRole('menuitem', { name: '分支 main', exact: true }).click()
  const search = page.getByRole('textbox', { name: '搜索本地分支' })
  await expect.element(page.getByRole('menuitemradio', { name: 'main', exact: true })).toHaveAttribute('aria-checked', 'true')
  await search.fill('absent')
  await expect.element(page.getByText('没有匹配的本地分支')).toBeVisible()
  await search.fill('feature')
  await page.getByRole('menuitemradio', { name: 'feature', exact: true }).click()
  await expect.element(page.getByText('主要文件夹中的会话还有进行中的工作，请等待结束后重试')).toBeVisible()
  expect(current).toBe('main')
  expect(fixture.chat.newChat.getState().branch).toBe(null)
  refused = false
  await page.getByRole('menuitem', { name: '分支 main', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'feature', exact: true }).click()
  const parentItem = page.getByRole('menuitem', { name: '分支 feature', exact: true })
  await expect.element(parentItem).toBeVisible()
  await expect.element(parentItem).toHaveFocus()
  expect(current).toBe('feature')
  expect(fixture.chat.newChat.getState().branch).toBe('feature')
  await userEvent.keyboard('{Escape}')
  fixture.chat.newChat.getState().configure({ newWorktree: true, branch: null })
  await configuration.click()
  await page.getByRole('menuitem', { name: '分支 feature', exact: true }).click()
  await expect.element(page.getByRole('menuitem', { name: '创建并检出新分支…' })).not.toBeInTheDocument()
  await page.getByRole('menuitemradio', { name: 'main', exact: true }).click()
  await expect.element(page.getByRole('menuitem', { name: '分支 main', exact: true })).toHaveFocus()
  expect(current).toBe('feature')
  expect(calls).toBe(2)
  expect(fixture.chat.newChat.getState().branch).toBe('main')
  await userEvent.keyboard('{Escape}')
  await screen.unmount()
})

it('CW-37: worktree toggle is draft-only, hides branch creation, echoes base, and clears on off/ownership reset/category entry', async () => {
  const fixture = createFixtureChat({ sessions: [] })
  let mutations = 0
  const branches = createBranchesStore({
    list: async () => ({
      available: true,
      current: 'main',
      branches: [
        { name: 'main', committedAt: 2 },
        { name: 'feature', committedAt: 1 },
      ],
    }),
    checkout: async () => {
      mutations++
      throw new Error('must not checkout')
    },
  })
  fixture.api.firstSend = async () => {
    mutations++
    throw new Error('must not send')
  }
  const appearance = createAppearanceStore({ locale: 'zh', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = await render(
    <div style={{ width: 1200, height: 900 }}>
      <BranchesProvider store={branches}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </BranchesProvider>
    </div>,
  )
  await page.getByRole('button', { name: '项目配置', exact: true }).click()
  await expect.element(page.getByRole('switch', { name: '新建工作树' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  fixture.chat.newChat.getState().selectProject('project-w-coko')
  const configuration = page.getByRole('button', { name: '项目配置', exact: true })
  await configuration.click()
  const toggle = page.getByRole('switch', { name: '新建工作树' })
  await toggle.click()
  await expect.element(toggle).toBeChecked()
  await page.getByRole('menuitem', { name: '分支 main', exact: true }).click()
  await expect.element(page.getByRole('menuitem', { name: '创建并检出新分支…' })).not.toBeInTheDocument()
  await page.getByRole('menuitemradio', { name: 'feature', exact: true }).click()
  await expect.element(page.getByRole('menuitem', { name: '分支 feature', exact: true })).toBeVisible()
  expect(fixture.chat.newChat.getState()).toMatchObject({ newWorktree: true, branch: 'feature' })
  expect(mutations).toBe(0)
  await page.screenshot({ element: page.getByRole('menu', { name: '项目配置' }).element() as HTMLElement, path: '../../../../../../.vitest/cw21-toggle.png' })
  await toggle.click()
  expect(fixture.chat.newChat.getState()).toMatchObject({ newWorktree: false, branch: null })
  await toggle.click()
  await userEvent.keyboard('{Escape}')
  await page.getByRole('button', { name: '清除项目归属' }).click()
  expect(fixture.chat.newChat.getState()).toMatchObject({ projectId: null, newWorktree: false, branch: null })
  fixture.chat.newChat.getState().selectProject('project-w-coko')
  fixture.chat.newChat.getState().configure({ newWorktree: true, branch: 'feature' })
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  expect(fixture.chat.newChat.getState()).toMatchObject({ projectId: null, newWorktree: false, branch: null })
  expect(mutations).toBe(0)
  await screen.unmount()
})

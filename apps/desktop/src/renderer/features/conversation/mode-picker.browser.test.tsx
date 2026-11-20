// Permission Mode 的选择入口（ADR 0029，票 02）：输入区菜单四项与勾选、说明文字、"自动审查"的图标与普通档位颜色（选择不确认）、
// Shift+Tab 的四档循环（full-access 回到 read-only）、设置页的默认模式选项与新会话的起始模式。菜单关闭后才结束用例（共用 setup 断言没有遗留的
// aria-hidden 与 pointer-events）。
import '../../styles.css'
import { TooltipProvider } from '@coko/ui'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { I18nProvider } from '../../app/i18n.tsx'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'
import { ModePicker } from './mode-picker.tsx'

async function menuClosed() {
  await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
}

const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]

it('菜单四项（请求批准、帮我批准、自动审查、完全访问权限）带说明；勾选当前模式；自动审查有自己的图标、普通档位颜色，选择不确认', async () => {
  const picked: string[] = []
  const screen = await render(
    <I18nProvider locale="zh">
      <TooltipProvider>
        <ModePicker value="auto-review" onChange={(mode) => picked.push(mode)} />
      </TooltipProvider>
    </I18nProvider>,
  )
  // 输入区按钮：名称与图标，不是警示态。
  const trigger = screen.getByRole('button', { name: '权限模式：自动审查' })
  await expect.element(trigger).toHaveTextContent('自动审查')
  expect(trigger.element().querySelector('svg.tabler-icon-shield-search')).not.toBeNull()
  expect(trigger.element().hasAttribute('data-warning')).toBe(false)

  await userEvent.click(trigger)
  await expect.poll(() => items().length).toBe(4)
  expect(items().map((item) => item.dataset.mode)).toEqual(['default', 'accept-edits', 'auto-review', 'full-access'])
  expect(items().map((item) => item.textContent)).toEqual([
    '请求批准编辑文件和执行命令通常需要批准，读取工作区无需批准',
    '帮我批准只自动批准工作区内的文件编辑，命令等其他操作仍会询问',
    '自动审查由模型判断其余操作，拿不准或高危时问你；可能误判，命令仍受沙箱限制',
    '完全访问权限可访问外部文件并执行命令，仍遵循拒绝规则、询问规则与受保护路径',
  ])
  await expect.element(page.getByRole('menuitemradio', { name: /自动审查/ })).toHaveAttribute('aria-checked', 'true')
  expect(items().filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  const [normal, acceptEdits, autoReview, fullAccess] = items()
  // 图标各不相同；自动审查与普通档位同色，完全访问权限为警示色。
  expect(autoReview!.querySelector('svg.tabler-icon-shield-search')).not.toBeNull()
  expect(acceptEdits!.querySelector('svg.tabler-icon-shield-search')).toBeNull()
  expect(getComputedStyle(autoReview!).color).toBe(getComputedStyle(normal!).color)
  expect(getComputedStyle(fullAccess!).color).not.toBe(getComputedStyle(normal!).color)
  await userEvent.keyboard('{Escape}')
  await menuClosed()

  // 从请求批准选到自动审查：立即生效，没有风险确认。
  await screen.rerender(
    <I18nProvider locale="zh">
      <TooltipProvider>
        <ModePicker value="default" onChange={(mode) => picked.push(mode)} />
      </TooltipProvider>
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: '权限模式：请求批准' }))
  await userEvent.click(page.getByRole('menuitemradio', { name: /自动审查/ }))
  await menuClosed()
  expect(picked).toEqual(['auto-review'])
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await screen.unmount()
})

it('英文：名称与两项说明取自设计稿', async () => {
  const screen = await render(
    <I18nProvider locale="en">
      <TooltipProvider>
        <ModePicker value="accept-edits" onChange={() => {}} />
      </TooltipProvider>
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Permission mode: Accept edits' }))
  await expect.poll(() => items().length).toBe(4)
  expect(items().map((item) => item.textContent)).toEqual([
    expect.stringMatching(/^Ask for approval/),
    'Accept editsAccepts file edits in the workspace automatically. Commands and other actions still ask you.',
    'Auto reviewA model decides on other actions and asks you when unsure or risky. It can be wrong; commands stay sandboxed.',
    expect.stringMatching(/^Full access/),
  ])
  await userEvent.keyboard('{Escape}')
  await menuClosed()
  await screen.unmount()
})

function renderApp() {
  const fixture = createFixtureChat()
  const store = createAppearanceStore({ locale: 'zh', theme: 'light' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = render(
    <div style={{ width: 1200, height: 900 }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  return { ...fixture, screen }
}

const modeButton = () => page.getByRole('button', { name: /^权限模式：/ })

it('Shift+Tab 循环 read-only → default → accept-edits → auto-review，从 full-access 回到 read-only', async () => {
  const { screen } = renderApp()
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '向 Coko 布置任务' })
  await expect.element(editor).toHaveFocus()
  await expect.element(modeButton()).toHaveAccessibleName('权限模式：请求批准')
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(editor).toHaveFocus()
    seen.push(modeButton().element().getAttribute('data-permission-mode')!)
  }
  expect(seen).toEqual(['accept-edits', 'auto-review', 'read-only', 'default'])

  await userEvent.click(modeButton())
  await userEvent.click(page.getByRole('menuitemradio', { name: /完全访问权限/ }))
  await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: '仍要开启' }))
  await expect.element(modeButton()).toHaveAccessibleName('权限模式：完全访问权限')
  await userEvent.click(editor)
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(modeButton()).toHaveAccessibleName('权限模式：只读')
  await (await screen).unmount()
})

it('设置页默认模式可选"自动审查"（五项）；保存后新会话以它开始', async () => {
  await page.viewport(1280, 900)
  const { screen, settings } = renderApp()
  await expect.element(page.getByRole('button', { name: '新对话', exact: true })).toBeVisible()
  await userEvent.keyboard('{Meta>},{/Meta}')
  const region = settingsRegion()
  await region.getByRole('button', { name: '权限', exact: true }).click()
  await userEvent.click(region.getByRole('button', { name: '新会话的默认模式: 请求批准' }))
  await expect.poll(() => items().length).toBe(5)
  expect(items().map((item) => item.dataset.mode)).toEqual(['read-only', 'default', 'accept-edits', 'auto-review', 'full-access'])
  await userEvent.click(page.getByRole('menuitemradio', { name: /自动审查/ }))
  await menuClosed()
  await expect.element(region.getByRole('button', { name: '新会话的默认模式: 自动审查' })).toBeVisible()
  expect(settings.getState().permissions?.defaultMode.value).toBe('auto-review')
  await userEvent.keyboard('{Escape}')
  await expect.element(settingsRegion()).not.toBeInTheDocument()
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(modeButton()).toHaveAccessibleName('权限模式：自动审查')
  await (await screen).unmount()
})

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

it('新对话显示品牌欢迎页，所有入口保留同份文字草稿，输入区聚焦且上下文只有轨道', async () => {
  const fixture = createFixtureChat()
  const store = createAppearanceStore({ locale: 'zh', theme: 'light' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const screen = await render(
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
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(page.getByText('今天我们来做些什么？')).toBeVisible()
  await expect.element(page.getByText('从一个想法开始，一起完成工作')).toBeVisible()
  const editor = page.getByRole('textbox', { name: '向 Coko 布置任务' })
  await expect.element(editor).toHaveFocus()
  await userEvent.type(editor, '保留这份草稿')
  fixture.chat.getState().openSession('s-1')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect.element(editor).toHaveTextContent('保留这份草稿')
  await expect.element(page.getByRole('img', { name: 'Coko' })).toBeVisible()
  expect(document.querySelector('[data-context-ring]')).not.toBeNull()
  expect(document.querySelector('[data-context-ring]')?.textContent).not.toContain('%')
  await screen.unmount()
})

it.each(['light', 'dark'] as const)('单份草稿在 %s 窄主区重新挂载后恢复，旧 Workspace 草稿清除，品牌与主要操作可达', async (theme) => {
  await page.viewport(446, 800)
  localStorage.setItem('coko.draft.workspace.obsolete', 'old draft')
  const mount = async () => {
    const fixture = createFixtureChat({ sessions: [] })
    const store = createAppearanceStore({ locale: 'zh', theme })
    const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
    const screen = await render(
      <div style={{ width: '100vw', height: '100vh' }}>
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
    await expect.poll(() => document.querySelector('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(390)
    return { fixture, screen }
  }
  const first = await mount()
  const editor = page.getByRole('textbox', { name: '向 Coko 布置任务' })
  await expect.element(editor).toBeEnabled()
  await userEvent.type(editor, '恢复文字与附件 @src/example.ts')
  await page.getByRole('button', { name: '权限模式：请求批准' }).click()
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).click()
  await first.screen.unmount()
  const second = await mount()
  await expect.element(editor).toHaveTextContent('恢复文字与附件 @src/example.ts')
  await expect.element(page.getByRole('button', { name: '权限模式：帮我批准' })).toBeVisible()
  expect(localStorage.getItem('coko.draft.workspace.obsolete')).toBeNull()
  const image = page.getByRole('img', { name: 'Coko' }).element() as HTMLImageElement
  await expect.poll(() => image.naturalWidth).toBeGreaterThan(0)
  const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
  expect(main.getBoundingClientRect().width).toBeGreaterThanOrEqual(390)
  expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth + 1)
  const welcome = document.querySelector<HTMLElement>('[data-slot="new-chat-welcome"]')!.getBoundingClientRect()
  const composer =
    document.querySelector<HTMLElement>('form[data-slot="composer"]')?.getBoundingClientRect() ?? document.querySelector('form')!.getBoundingClientRect()
  expect(welcome.bottom).toBeLessThanOrEqual(composer.top + 1)
  await page.screenshot({ element: main, path: `../../../../../../.vitest/cw11-${theme}.png` })
  await second.screen.unmount()
})

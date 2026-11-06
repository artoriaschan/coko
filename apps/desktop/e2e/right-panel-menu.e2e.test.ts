// 原生菜单 → preload → renderer：真实 Electron / Sidecar，模型由 faux 脚本替换。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

async function closeFromMenu(app: LaunchedApp) {
  await app.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('coko-close')
    if (!item) throw new Error('File Close is missing')
    item.click()
  })
}

it('File Close closes pages continuously, delegates to dialogs and IME, then closes the window from the timeline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-right-menu-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Menu fixture completed.' }] }))
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  const win = app.window
  await createProjectDraft(app, workspace)
  const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('MENU-FIXTURE')
  await composer.press('Enter')
  await waitConnected(win)
  await expect.poll(() => win.locator('[data-slot="assistant-message-body"]').last().textContent()).toBe('Menu fixture completed.')
  const panel = win.locator('[data-slot="app-frame-right"]')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+Alt+B`)
  await panel.getByRole('button', { name: /^(Tasks|后台任务)$/ }).click()
  await panel.getByRole('button', { name: /^(New tab|新标签页)$/ }).click()
  await panel.getByRole('button', { name: /^(Plan|计划)$/ }).click()
  await panel.getByRole('button', { name: /^(New tab|新标签页)$/ }).click()
  await panel.getByRole('tab', { name: /^(Tasks|后台任务)$/ }).click()
  await closeFromMenu(app)
  await expect.poll(() => panel.getByRole('tab').count()).toBe(2)
  await expect.poll(() => win.locator('#right-panel-tabpanel').evaluate((element) => document.activeElement === element)).toBe(true)
  await closeFromMenu(app)
  await expect.poll(() => panel.getByRole('tab').count()).toBe(1)
  await expect.poll(() => win.locator('#right-panel-tabpanel').evaluate((element) => document.activeElement === element)).toBe(true)
  await closeFromMenu(app)
  await expect.poll(() => panel.isVisible()).toBe(false)
  await expect.poll(() => win.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).evaluate((element) => document.activeElement === element)).toBe(true)
  await win.keyboard.press(`${mod}+Alt+B`)
  await panel.getByRole('button', { name: /^(Tasks|后台任务)$/ }).click()
  await win.locator('[data-permission-mode]').click()
  await win.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  const dialog = win.getByRole('alertdialog')
  await dialog.waitFor()
  await closeFromMenu(app)
  await dialog.waitFor({ state: 'detached' })
  expect(await panel.getByRole('tab', { name: /^(Tasks|后台任务)$/ }).count()).toBe(1)
  expect(app.app.windows()).toHaveLength(1)
  await panel.locator('#right-panel-tabpanel').focus()
  await win.evaluate(() => document.activeElement!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await closeFromMenu(app)
  expect(await panel.getByRole('tab', { name: /^(Tasks|后台任务)$/ }).count()).toBe(1)
  await win.evaluate(() => document.activeElement!.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await composer.focus()
  await closeFromMenu(app)
  await expect.poll(() => app.app.windows().length).toBe(0)
})

it('File Close retains native window closing when the renderer document has no listener', async () => {
  const app = await launchApp()
  onTestFinished(() => app.dispose())
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  await app.app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0]!.loadURL('about:blank')
  })
  await closeFromMenu(app)
  await expect.poll(() => app.app.windows().length).toBe(0)
})

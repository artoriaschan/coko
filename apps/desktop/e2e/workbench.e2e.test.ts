// 工作台外壳与导航：真实 Electron、Sidecar 与本次构建产物。
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('CW-01/02：四角裁剪、会话与页面历史、设置返回保留草稿和列表', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-workbench-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'workspace')
  await mkdir(path)
  const app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const window = app.window
  await waitConnected(window)
  const ids = await window.evaluate(async (workspacePath) => {
    const workspace = (await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path: workspacePath }) })).json()) as { id: string }
    const ids: string[] = []
    for (const title of ['Workbench one', 'Workbench two']) {
      const response = await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title }) })
      if (!response.ok) throw new Error(`Session fixture failed: ${response.status}`)
      ids.push(((await response.json()) as { id: string }).id)
    }
    return ids
  }, path)
  await window.reload()
  await waitConnected(window)
  const row = (id: string) => window.locator(`[data-session-id="${id}"]`)
  await row(ids[0]!).click()
  const currentTitle = () => window.locator('[data-slot="app-frame-main"] h1').textContent()
  await expect.poll(currentTitle).toBe('Workbench one')
  await row(ids[1]!).click()
  await expect.poll(currentTitle).toBe('Workbench two')
  const navigation = window.getByRole('navigation', { name: /^(主导航|Main navigation)$/ })
  await navigation.getByRole('button', { name: /^(插件|Plugins)$/ }).click()
  await window.locator('[data-workbench-page="plugins"]').waitFor()
  await navigation.getByRole('button', { name: /^(定时任务|Scheduled tasks)$/ }).click()
  await window.locator('[data-workbench-page="schedules"]').waitFor()
  const back = window.getByRole('button', { name: /^(后退|Go back)$/ })
  const forward = window.getByRole('button', { name: /^(前进|Go forward)$/ })
  await back.click()
  await window.locator('[data-workbench-page="plugins"]').waitFor()
  await back.click()
  await expect.poll(currentTitle).toBe('Workbench two')
  await back.click()
  await expect.poll(currentTitle).toBe('Workbench one')
  await forward.click()
  await expect.poll(currentTitle).toBe('Workbench two')
  await navigation.getByRole('button', { name: /^(新对话|New chat)$/ }).click()
  const editor = window.getByRole('textbox', { name: /^(向 Coko 布置任务|Give Coko a task)$/ })
  await editor.fill('keep the workbench draft')
  const listBefore = await window.locator('[data-session-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id')))
  await window.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await window.locator('[data-settings-page]').waitFor()
  await window.keyboard.press('Escape')
  await window.locator('[data-settings-page]').waitFor({ state: 'detached' })
  await expect.poll(() => editor.textContent()).toBe('keep the workbench draft')
  expect(await window.locator('[data-session-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id')))).toEqual(listBefore)
  const geometry = await window.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-slot="app-frame"]')!
    const style = getComputedStyle(frame)
    const rect = frame.getBoundingClientRect()
    return {
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
      overflow: style.overflow,
      corners: [
        [1, 1],
        [rect.width - 1, 1],
        [1, rect.height - 1],
        [rect.width - 1, rect.height - 1],
      ].map(([x, y]) => {
        const hit = document.elementFromPoint(rect.left + x!, rect.top + y!)
        return hit === frame || !frame.contains(hit)
      }),
    }
  })
  expect(geometry).toEqual({ radii: ['28px', '28px', '28px', '28px'], overflow: 'hidden', corners: [true, true, true, true] })
})

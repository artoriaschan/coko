import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('Electron: developer diagnostics persists across restart and disabling removes the diagnostics page and card', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-developer-diagnostics-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspacePath = join(root, 'workspace')
  await mkdir(workspacePath)
  let app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const response = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`seed ${route}: ${response.status}`)
      return response.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Developer settings' })
    await post('/api/sessions', { workspaceId: workspace.id, title: 'Diagnostic preference' })
  }, workspacePath)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Diagnostic preference', exact: true }).click()
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  let settings = page.getByRole('region', { name: /^(设置|Settings)$/ })
  let toggle = settings.getByRole('switch', { name: /^(会话数据诊断|Session diagnostics)$/ })
  expect(await toggle.isChecked()).toBe(false)
  await toggle.click()
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch('/api/settings')
        const { settings: values } = (await response.json()) as { settings: { key: string; value: unknown }[] }
        return values.find((value) => value.key === 'developer')?.value
      }),
    )
    .toEqual({ sessionDiagnostics: true })
  await settings.getByRole('button', { name: /^(返回应用|Back to app)$/ }).click()
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  let panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  expect(await panel.getByRole('tab', { name: /^(开始|Start)$/ }).getAttribute('aria-selected')).toBe('true')
  expect(await panel.getByRole('tab', { name: /^(会话数据诊断|Session diagnostics)$/ }).count()).toBe(0)
  await panel.getByRole('button', { name: /^(会话数据诊断|Session diagnostics)$/ }).click()
  await panel.getByRole('heading', { name: /^(会话数据诊断|Session diagnostics)$/ }).waitFor()
  await app.dispose()

  app = await launchApp({}, { dir: root })
  page = app.window
  await waitConnected(page)
  await page.getByRole('button', { name: 'Diagnostic preference', exact: true }).click()
  panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('tab', { name: /^(会话数据诊断|Session diagnostics)$/ }).waitFor()
  expect(await panel.getByRole('tab', { name: /^(会话数据诊断|Session diagnostics)$/ }).getAttribute('aria-selected')).toBe('true')
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  settings = page.getByRole('region', { name: /^(设置|Settings)$/ })
  toggle = settings.getByRole('switch', { name: /^(会话数据诊断|Session diagnostics)$/ })
  expect(await toggle.isChecked()).toBe(true)
  await toggle.click()
  await expect.poll(async () => toggle.isChecked()).toBe(false)
  await settings.getByRole('button', { name: /^(返回应用|Back to app)$/ }).click()
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  expect(await panel.getByRole('button', { name: /^(会话数据诊断|Session diagnostics)$/ }).count()).toBe(0)
  expect(await panel.getByRole('tab', { name: /^(开始|Start)$/ }).getAttribute('aria-selected')).toBe('true')
})

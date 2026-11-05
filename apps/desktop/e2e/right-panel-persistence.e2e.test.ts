import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { desktopLogPath, launchApp, waitConnected } from './harness.ts'

it('Electron: restores per-Session tabs and fullscreen after restart and isolates a corrupt layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-right-panel-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  let app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  const ids = await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const result = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) throw new Error(`seed ${route}: ${result.status}`)
      return result.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Layout persistence' })
    const first = await post('/api/sessions', { workspaceId: workspace.id, title: 'Saved layout' })
    const second = await post('/api/sessions', { workspaceId: workspace.id, title: 'Other layout' })
    return [first.id, second.id] as [string, string]
  }, workspace)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Saved layout', exact: true }).click()
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  let panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('button', { name: /^(计划|Plan)$/ }).click()
  await panel.getByRole('button', { name: /^(新标签页|New tab)$/ }).click()
  await panel.getByRole('button', { name: /^(追踪|Trace)$/ }).click()
  await panel.getByRole('tab', { name: /^(追踪|Trace)$/ }).press('ControlOrMeta+Shift+ArrowLeft')
  await panel.getByRole('button', { name: /^(全屏|Fullscreen)$/ }).click()
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`coko.right-panel.v1.${id}`)!), ids[0])).toEqual({
    tabs: ['trace', 'plan'],
    active: 'trace',
    expanded: true,
    mode: 'fullscreen',
  })

  await app.dispose()
  app = await launchApp({}, { dir: root })
  page = app.window
  await waitConnected(page)
  panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('button', { name: /^(退出全屏|Exit fullscreen)$/ }).waitFor()
  expect(await panel.getByRole('tab').allTextContents()).toEqual([expect.stringMatching(/^(追踪|Trace)$/), expect.stringMatching(/^(计划|Plan)$/)])
  expect(await panel.getByRole('tab', { name: /^(追踪|Trace)$/ }).getAttribute('aria-selected')).toBe('true')
  await panel.getByRole('button', { name: /^(退出全屏|Exit fullscreen)$/ }).click()
  await page.getByRole('button', { name: 'Other layout', exact: true }).click()
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  await panel.getByRole('button', { name: /^(后台任务|Tasks)$/ }).click()
  await page.evaluate((id) => localStorage.setItem(`coko.right-panel.v1.${id}`, '{invalid'), ids[0])
  await app.dispose()
  app = await launchApp({}, { dir: root })
  page = app.window
  await waitConnected(page)
  panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('tab', { name: /^(后台任务|Tasks)$/ }).waitFor()
  await page.getByRole('button', { name: 'Saved layout', exact: true }).click()
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).waitFor()
  expect(await page.evaluate((id) => localStorage.getItem(`coko.right-panel.v1.${id}`), ids[0])).toBeNull()
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`coko.right-panel.v1.${id}`)!), ids[1])).toEqual({
    tabs: ['jobs'],
    active: 'jobs',
    expanded: true,
    mode: 'normal',
  })
})

it('Electron: a full localStorage keeps page operations usable and writes one diagnostic log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-right-panel-quota-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const result = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) throw new Error(`seed ${route}: ${result.status}`)
      return result.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Quota' })
    await post('/api/sessions', { workspaceId: workspace.id, title: 'Quota layout' })
  }, workspace)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Quota layout', exact: true }).click()
  await page.evaluate(() => {
    let index = 0
    for (let size = 262_144; size >= 1; size /= 16) {
      while (true) {
        try {
          localStorage.setItem(`quota-${index++}`, 'x'.repeat(size))
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
          break
        }
      }
    }
  })
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  const panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('button', { name: /^(计划|Plan)$/ }).click()
  await panel.getByRole('tab', { name: /^(计划|Plan)$/ }).waitFor()
  await app.dispose()
  const records = (await readFile(desktopLogPath(root), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string })
  expect(records.filter((record) => record.message === 'layout persistence failed')).toHaveLength(1)
})

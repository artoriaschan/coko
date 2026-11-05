import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('Electron Artifacts shows live standalone deliveries and invokes native file actions through the bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-artifacts-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Ready.' }] }))
  const launched = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => launched.dispose())
  const page = launched.window
  await waitConnected(page)
  await launched.app.evaluate(({ shell }) => {
    shell.openPath = async (path) => {
      process.env.COKO_ARTIFACT_OPENED = path
      return ''
    }
    shell.showItemInFolder = (path) => {
      process.env.COKO_ARTIFACT_REVEALED = path
    }
  })
  const editor = page.getByRole('textbox', { name: /^(Give Coko a task|向 Coko 布置任务)$/ })
  await editor.fill('Prepare a report')
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Ready.' }).waitFor()
  const session = await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions[0])
  await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).click()
  const panel = page.getByRole('region', { name: /^(侧边栏|Sidebar)$/ })
  await panel.getByRole('button', { name: 'Artifacts', exact: true }).click()
  await panel.getByText(/还没有交付文件|No delivery files yet/).waitFor()
  const outputs = join(session.directory, 'outputs')
  await mkdir(join(outputs, 'chapters'))
  const report = join(outputs, 'chapters', 'report.txt')
  await writeFile(report, 'report')
  await writeFile(join(outputs, '.private'), 'hidden')
  await writeFile(join(root, 'outside.txt'), 'private')
  await symlink(join(root, 'outside.txt'), join(outputs, 'outside.txt'))
  const file = panel.getByRole('button', { name: /^(打开 report.txt|Open report.txt)$/ })
  await file.waitFor()
  expect(await panel.getByText('chapters/report.txt', { exact: true }).count()).toBe(1)
  expect(await panel.locator('[data-artifact-path="outside.txt"]').count()).toBe(0)
  expect(await panel.locator('[data-artifact-path=".private"]').count()).toBe(0)
  await file.click()
  await expect.poll(() => launched.app.evaluate(() => process.env.COKO_ARTIFACT_OPENED)).toBe(report)
  await panel.getByRole('button', { name: /^(在 Finder 中显示 report.txt|Show report.txt in Finder)$/ }).click()
  await expect.poll(() => launched.app.evaluate(() => process.env.COKO_ARTIFACT_REVEALED)).toBe(report)
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.screenshot({ path: '/tmp/coko-sdr-05-artifacts-light.png' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: '/tmp/coko-sdr-05-artifacts-dark.png' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await rm(report)
  await file.waitFor({ state: 'detached' })
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  await page.evaluate(
    async ({ projectRoot, sessionId }) => {
      await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path: projectRoot, name: 'Project' }) })
      const project = (await (await fetch('/api/projects')).json()).projects[0]
      const response = await fetch(`/api/sessions/${sessionId}/project`, { method: 'PUT', body: JSON.stringify({ projectId: project.id }) })
      if (!response.ok) throw new Error('move failed')
    },
    { projectRoot, sessionId: session.id },
  )
  await page.reload()
  await waitConnected(page)
  await panel.getByRole('button', { name: /^(计划|Plan)$/ }).waitFor()
  expect(await panel.getByRole('button', { name: 'Artifacts', exact: true }).count()).toBe(0)
})

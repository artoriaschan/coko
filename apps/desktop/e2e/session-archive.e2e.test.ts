import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('archives, opens read-only from Settings, restores to the project, then restarts archived current as a new conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-archive-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'project')
  await mkdir(folder)
  await writeFile(join(folder, 'source.txt'), 'retained source')
  const first = await launchApp({}, { dir: root })
  onTestFinished(() => first.dispose())
  const page = first.window
  await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  const seeded = await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const response = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`seed failed ${response.status}`)
      return response.json()
    }
    const { project } = await post('/api/projects', { name: 'Archive project', folders: [{ path, primary: true }] })
    const session = await post('/api/sessions', { workspaceId: project.primaryWorkspaceId, title: 'Archive current' })
    return { project, session }
  }, folder)
  await page.reload()
  await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  const row = () => page.locator(`[data-session-id="${seeded.session.id}"]`)
  await row().click()
  await waitConnected(page)
  await row().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^(归档|Archive conversation)$/ }).click()
  await page.getByText(/恢复后可继续|Restore this conversation to continue/).waitFor()
  expect(await row().count()).toBe(0)
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await page.getByRole('button', { name: /^(已归档对话|Archived conversations)$/ }).click()
  const archived = page.locator(`[data-archived-session="${seeded.session.id}"]`)
  await archived.getByText('Archive project', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/coko-archive-settings-e2e.png' })
  await archived.getByRole('button', { name: /^(打开对话|Open conversation)$/ }).click()
  await page.getByRole('heading', { name: 'Archive current', exact: true }).waitFor()
  expect(await page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ }).isVisible()).toBe(false)
  await page.screenshot({ path: '/tmp/coko-archive-readonly-e2e.png' })
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await page
    .locator(`[data-archived-session="${seeded.session.id}"]`)
    .getByRole('button', { name: /^(恢复|Restore)$/ })
    .click()
  await page.getByRole('button', { name: /^(返回应用|Back to app)$/ }).click()
  await expect.poll(() => page.locator(`[data-project-id="${seeded.project.id}"] [data-session-id="${seeded.session.id}"]`).count()).toBe(1)
  await row().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^(归档|Archive conversation)$/ }).click()
  await page.getByText(/恢复后可继续|Restore this conversation to continue/).waitFor()
  await first.dispose()
  const second = await launchApp({}, { dir: root })
  onTestFinished(() => second.dispose())
  await second.window.getByRole('heading', { name: /^(新对话|New chat)$/ }).waitFor()
  expect(await second.window.locator('[data-session-id]').count()).toBe(0)
  expect(await second.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session.archivedAt, seeded.session.id)).toEqual(
    expect.any(Number),
  )
  expect(await readFile(join(folder, 'source.txt'), 'utf8')).toBe('retained source')
})

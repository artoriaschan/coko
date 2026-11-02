import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected } from './harness.ts'

it('choosing a folder moves the original standalone conversation into a new project across Electron restart and preserves its dedicated cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-move-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'target')
  await mkdir(folder)
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Ready to organize.' }] }))
  const first = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => first.dispose())
  const page = first.window
  await waitConnected(page)
  const editor = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await editor.fill('Organize this standalone conversation')
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Ready to organize.' }).waitFor()
  const before = await page.evaluate(async () => {
    const sessions = (await (await fetch('/api/sessions')).json()).sessions
    const workspaces = (await (await fetch('/api/workspaces')).json()).workspaces
    return { session: sessions[0], cwd: workspaces.find((workspace: { id: string }) => workspace.id === sessions[0].workspaceId).path }
  })
  expect(before.session.projectId).toBeNull()
  expect(before.cwd.startsWith(await realpath(join(root, 'chats')))).toBe(true)
  await stubDirectoryPicker(first.app, [folder])
  await page.locator(`[data-session-id="${before.session.id}"]`).hover()
  await page.getByRole('button', { name: /More conversation actions|查看更多/ }).click()
  await page.getByRole('menuitem', { name: /^(Move to project|移到项目)$/ }).click()
  await page.getByRole('menuitem', { name: /Choose folder|选择文件夹/ }).click()
  const dialog = page.getByRole('dialog', { name: /Create project|创建项目/ })
  await dialog.getByRole('textbox', { name: /Project name|项目名称/ }).fill('Moved project')
  await dialog.getByRole('button', { name: /Add folder|添加文件夹/ }).click()
  await dialog.getByRole('button', { name: /Create project|创建项目/, exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await expect.poll(() => page.locator(`[data-project-id] [data-session-id="${before.session.id}"]`).count()).toBe(1)
  const moved = await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)
  expect(moved).toHaveLength(1)
  expect(moved[0]).toEqual({ ...before.session, projectId: moved[0].projectId })
  expect(moved[0].projectId).not.toBeNull()
  await first.dispose()
  const second = await launchApp({}, { dir: root })
  onTestFinished(() => second.dispose())
  await waitConnected(second.window)
  await expect.poll(() => second.window.locator(`[data-project-id="${moved[0].projectId}"] [data-session-id="${before.session.id}"]`).count()).toBe(1)
  const after = await second.window.evaluate(async (id) => {
    const session = (await (await fetch(`/api/sessions/${id}`)).json()).session
    const workspaces = (await (await fetch('/api/workspaces')).json()).workspaces
    return { session, cwd: workspaces.find((workspace: { id: string }) => workspace.id === session.workspaceId).path }
  }, before.session.id)
  expect(after).toEqual({ session: moved[0], cwd: before.cwd })
})

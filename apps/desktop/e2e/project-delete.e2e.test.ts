import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('Electron: removing a project keeps the open conversation under Conversations and it continues after a native restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-project-remove-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'source')
  await mkdir(folder)
  await writeFile(join(folder, 'source.txt'), 'preserved source')
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        { match: 'BEFORE-REMOVE', content: 'Original conversation retained.' },
        { match: 'AFTER-REMOVE', content: 'Continued after project removal.' },
      ],
    }),
  )
  const env = { COKO_FAUX_SCRIPT: script }
  let app = await launchApp(env, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  const id = await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const result = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) throw new Error(`seed ${route}: ${result.status}`)
      return result.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Remove project' })
    const session = await post('/api/sessions', { workspaceId: workspace.id, title: 'Keep conversation' })
    await post(`/api/sessions/${session.id}/messages`, { text: 'BEFORE-REMOVE' })
    return session.id as string
  }, folder)
  await expect.poll(() => page.evaluate(async (sessionId) => (await (await fetch(`/api/sessions/${sessionId}`)).json()).session.running, id)).toBe(false)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Keep conversation', exact: true }).click()
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Original conversation retained.' }).waitFor()
  await page.getByRole('button', { name: /^(更多项目操作|More project actions)$/ }).click()
  await page.getByRole('menuitem', { name: /^(删除项目|Delete project)$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: /^(删除项目？|Delete project\?)$/ })
  await expect.poll(() => dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).evaluate((element) => document.activeElement === element)).toBe(true)
  await dialog.getByRole('button', { name: /^(删除|Delete)$/ }).click()
  await expect.poll(() => page.locator('[data-project-id]').count()).toBe(0)
  await page.getByRole('button', { name: 'Keep conversation', exact: true }).hover()
  await page
    .getByRole('region', { name: /^(对话详情|Conversation details)$/ })
    .getByText(/^(对话|Conversations)$/)
    .waitFor()
  await page.mouse.move(600, 400)
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Original conversation retained.' }).waitFor()
  expect(await page.locator('[data-category="conversations"] [data-session-id]').getAttribute('data-session-id')).toBe(id)
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await waitConnected(page)
  expect(await page.locator('[data-project-id]').count()).toBe(0)
  await page.getByRole('button', { name: 'Keep conversation', exact: true }).click()
  const editor = page.getByRole('textbox', { name: /^(Give Coko a task|向 Coko 布置任务)$/ })
  await editor.fill('AFTER-REMOVE')
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Continued after project removal.' }).waitFor()
  const detail = await page.evaluate(async (sessionId) => await (await fetch(`/api/sessions/${sessionId}`)).json(), id)
  expect(detail.session).toMatchObject({ id, projectId: null })
  expect(detail.entries.filter((entry: { kind: string }) => entry.kind === 'run_end')).toHaveLength(2)
  expect(await readFile(join(folder, 'source.txt'), 'utf8')).toBe('preserved source')
})

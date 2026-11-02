import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('项目编辑保存、主要冲突保留、置顶和改名重启，真实 preload 将 Finder 交给 main 验证的目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-project-edit-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const paths = ['original', 'replacement', 'conflict'].map((name) => join(root, name))
  await Promise.all(paths.map((path) => mkdir(path)))
  const app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  const seeded = await page.evaluate(async (paths) => {
    const create = async (name: string, folders: { path: string; primary: boolean }[]) =>
      (await (await fetch('/api/projects', { method: 'POST', body: JSON.stringify({ name, folders }) })).json()).project
    const project = await create('Editable project', [
      { path: paths[0]!, primary: true },
      { path: paths[1]!, primary: false },
      { path: paths[2]!, primary: false },
    ])
    const other = await create('Conflict owner', [{ path: paths[2]!, primary: true }])
    const session = await (
      await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: project.primaryWorkspaceId, title: 'Stable session' }) })
    ).json()
    return { project, other, session }
  }, paths)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Editable project', exact: true }).hover()
  await page.getByRole('button', { name: /Edit project|编辑项目/, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Edit project|编辑项目/, exact: true })
  await expect.poll(() => dialog.getByRole('textbox', { name: /Project name|项目名称/ }).inputValue()).toBe('Editable project')
  // Explicit primary conflict; the draft and all folders remain after rejection.
  await dialog.locator('[data-project-folder]').nth(2).hover()
  await dialog
    .locator('[data-project-folder]')
    .nth(2)
    .getByRole('button', { name: /Set as primary|设为主要/ })
    .click()
  await dialog.getByRole('button', { name: /Save|保存/, exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Conflict owner' }).waitFor()
  expect(await dialog.locator('[data-project-folder]').count()).toBe(3)
  // Removing that primary picks its predecessor and saves the original project identity.
  await dialog
    .locator('[data-project-folder]')
    .nth(2)
    .getByRole('button', { name: /Remove conflict|移除 conflict/ })
    .click()
  await dialog.getByRole('textbox', { name: /Project name|项目名称/ }).fill('Edited project')
  await dialog.getByRole('button', { name: /Save|保存/, exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  const updated = await page.evaluate(async () => (await (await fetch('/api/projects')).json()).projects)
  expect(updated).toHaveLength(2)
  expect(updated.find((project: { id: string }) => project.id === seeded.project.id)).toMatchObject({
    name: 'Edited project',
    folders: [
      { path: await realpath(paths[0]!), primary: false },
      { path: await realpath(paths[1]!), primary: true },
    ],
  })
  const session = await page.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session, seeded.session.id)
  expect(session.workspaceId).toBe(seeded.project.primaryWorkspaceId)
  await app.app.evaluate(({ shell }) => {
    shell.openPath = async (path: string) => {
      process.env.COKO_TEST_OPENED_DIRECTORY = path
      return ''
    }
  })
  await page.getByRole('button', { name: 'Edited project', exact: true }).hover()
  await page
    .getByRole('button', { name: /More project actions|更多项目操作/ })
    .first()
    .click()
  await page.getByRole('menuitem', { name: /Open in Finder|在 Finder 中打开/ }).click()
  expect(await app.app.evaluate(() => process.env.COKO_TEST_OPENED_DIRECTORY)).toBe(await realpath(paths[1]!))
  expect(await page.evaluate(async () => window.coko!.openDirectory('/path/that/does/not/exist'))).toBe(false)
  await page.getByRole('button', { name: 'Edited project', exact: true }).hover()
  await page.getByRole('button', { name: /Pin project|置顶项目/, exact: true }).click()
  await page.locator('[data-category="pinned"] [data-project-id]').waitFor()
  await page.getByRole('button', { name: 'Edited project', exact: true }).hover()
  await page
    .getByRole('button', { name: /More project actions|更多项目操作/ })
    .first()
    .click()
  await page.getByRole('menuitem', { name: /Rename|重命名/, exact: true }).click()
  await page.getByRole('textbox', { name: /Project name|项目名称/ }).fill('Renamed project')
  await page.getByRole('textbox', { name: /Project name|项目名称/ }).press('Enter')
  await page.getByRole('button', { name: 'Renamed project', exact: true }).waitFor()
  await app.dispose()
  const restarted = await launchApp({}, { dir: root })
  onTestFinished(() => restarted.dispose())
  await waitConnected(restarted.window)
  await restarted.window.locator('[data-category="pinned"]').getByRole('button', { name: 'Renamed project', exact: true }).waitFor()
  await restarted.window.getByRole('button', { name: 'Renamed project', exact: true }).hover()
  await restarted.window
    .getByRole('button', { name: /More project actions|更多项目操作/ })
    .first()
    .click()
  await restarted.window.getByRole('menuitem', { name: /New session in Renamed project|在 Renamed project 中新建会话/ }).click()
  await restarted.window.getByRole('button', { name: /Choose chat destination: Renamed project|选择对话归属：Renamed project/ }).waitFor()
  const editor = restarted.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await expect.poll(() => editor.evaluate((element) => element === document.activeElement)).toBe(true)
})

it('recent project sorting follows an old moved Session rather than its newer destination creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-project-sort-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const paths = ['source', 'recent', 'destination'].map((name) => join(root, name))
  await Promise.all(paths.map((path) => mkdir(path)))
  const app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  const facts = await page.evaluate(async (paths) => {
    const post = async (route: string, body: unknown) => {
      const response = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`${route}: ${response.status}`)
      return response.json()
    }
    const project = async (name: string, path: string) => (await post('/api/projects', { name, folders: [{ path, primary: true }] })).project
    const source = await project('Source', paths[0]!)
    const createdOld = await post('/api/sessions', { workspaceId: source.primaryWorkspaceId, title: 'Old moved Session' })
    const old = (await (await fetch(`/api/sessions/${createdOld.id}`)).json()).session
    const recent = await project('Recently active', paths[1]!)
    const createdRecent = await post('/api/sessions', { workspaceId: recent.primaryWorkspaceId, title: 'Recent Session' })
    const newer = (await (await fetch(`/api/sessions/${createdRecent.id}`)).json()).session
    const destination = await project('New destination', paths[2]!)
    const move = await fetch(`/api/sessions/${old.id}/project`, { method: 'PUT', body: JSON.stringify({ projectId: destination.id }) })
    if (!move.ok) throw new Error(`move: ${move.status}`)
    const moved = await move.json()
    const projects = (await (await fetch('/api/projects')).json()).projects
    return { source, recent, destination, old, newer, moved, projects }
  }, paths)
  expect(facts.moved.updatedAt).toBe(facts.old.updatedAt)
  expect(facts.projects.find((p: { id: string }) => p.id === facts.destination.id).lastUsedAt).toBe(facts.old.updatedAt)
  expect(facts.newer.updatedAt).toBeGreaterThan(facts.old.updatedAt)
  expect(facts.destination.createdAt).toBeGreaterThan(facts.old.updatedAt)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: /^(Sort projects|项目排序)$/ }).click()
  await page.getByRole('menuitemradio', { name: /By recent use|按最近使用/ }).click()
  await expect.poll(() => page.locator('[data-category="projects"] [data-project-id]').first().getAttribute('data-project-id')).toBe(facts.recent.id)
  await page.getByRole('button', { name: /^(Sort projects|项目排序)$/ }).click()
  await page.getByRole('menuitemradio', { name: /By creation time|按创建时间/ }).click()
  await expect.poll(() => page.locator('[data-category="projects"] [data-project-id]').first().getAttribute('data-project-id')).toBe(facts.destination.id)
})

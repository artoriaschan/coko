import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('CW-16/34：项目行新对话预选主要文件夹，重启恢复归属与文字；发送后出现在项目下并在主要目录执行', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-destination-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'project')
  await mkdir(folder)
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          content: [
            { type: 'toolCall', id: 'write-project', name: 'write', arguments: { path: 'project-result.txt', content: 'Written in primary workspace.' } },
          ],
          stopReason: 'toolUse',
        },
        { content: 'Project complete.' },
      ],
    }),
  )
  let app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  const workspace = await page.evaluate(
    async (path) => await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Destination project' }) })).json(),
    folder,
  )
  await page.reload()
  await waitConnected(page)
  const row = page.getByRole('button', { name: 'Destination project', exact: true })
  await row.click()
  expect(await row.getAttribute('aria-expanded')).toBe('false')
  await row.hover()
  const contextRequest = page.waitForRequest((request) => request.url().includes(`/api/workspaces/${workspace.id}/context`))
  await page.getByRole('button', { name: /New session in Destination project|在 Destination project 中新建会话/ }).click()
  await contextRequest
  const destination = () => page.getByRole('button', { name: /Choose chat destination: Destination project|选择对话归属：Destination project/ })
  await destination().waitFor()
  expect(await row.getAttribute('aria-expanded')).toBe('false')
  const editor = () => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  expect(await editor().evaluate((element) => element === document.activeElement)).toBe(true)
  await editor().fill('Create project result')
  await page.getByRole('button', { name: /Permission mode:|权限模式：/ }).click()
  await page.getByRole('menuitemradio', { name: /Accept edits|帮我批准/ }).click()
  await app.dispose()
  app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  page = app.window
  await waitConnected(page)
  await destination().waitFor()
  await expect.poll(() => editor().textContent()).toBe('Create project result')
  await editor().press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Project complete.' }).waitFor()
  const facts = await page.evaluate(async () => ({
    sessions: (await (await fetch('/api/sessions')).json()).sessions,
    projects: (await (await fetch('/api/projects')).json()).projects,
    workspaces: (await (await fetch('/api/workspaces')).json()).workspaces,
  }))
  expect(facts.sessions).toHaveLength(1)
  const project = facts.projects[0]
  expect(facts.sessions[0]).toMatchObject({ projectId: project.id, workspaceId: project.primaryWorkspaceId })
  expect(facts.workspaces.find((item: { id: string }) => item.id === project.primaryWorkspaceId).path).toBe(await realpath(folder))
  expect(await readFile(join(folder, 'project-result.txt'), 'utf8')).toBe('Written in primary workspace.')
  expect(await page.locator('[data-slot="destination-bar"]').count()).toBe(0)
  await page.getByRole('button', { name: 'Destination project', exact: true }).click()
  await page.locator(`[data-project-id="${project.id}"] [data-session-id="${facts.sessions[0].id}"]`).waitFor()
})

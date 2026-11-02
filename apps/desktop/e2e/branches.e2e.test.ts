import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('CW-77: real Electron saves global prefix, prefills branch name and creates/checks out primary folder branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-branch-native-'))
  const home = join(root, 'home'),
    repo = join(root, 'repo')
  await mkdir(home)
  await mkdir(repo)
  const env = {
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@coko.test',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@coko.test',
  }
  const run = promisify(execFile)
  const git = async (...args: string[]) => (await run('git', args, { cwd: repo, env: { PATH: process.env.PATH, ...env } })).stdout
  await git('init', '-q', '-b', 'main')
  await writeFile(join(repo, 'README.md'), 'Fixture')
  await git('add', '-A')
  await git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
  const fixture = { home, root: repo, env, git, dispose: () => rm(root, { recursive: true, force: true }) }
  onTestFinished(() => fixture.dispose())
  const script = join(fixture.home, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [] }))
  const app = await launchApp({ ...fixture.env, COKO_FAUX_SCRIPT: script })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  await page.evaluate(async (path) => {
    await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Branch fixture' }) })
  }, fixture.root)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Branch fixture', exact: true }).hover()
  await page.getByRole('button', { name: /New session in Branch fixture|在 Branch fixture 中新建会话/ }).click()
  const configuration = page.getByRole('button', { name: /Project configuration|项目配置/, exact: true })
  await configuration.hover()
  await page.getByRole('tooltip', { name: /^(Project configuration|项目配置)$/ }).waitFor()
  await configuration.click()
  const parentMenu = page.getByRole('menu', { name: /^(Project configuration|项目配置)$/ })
  await parentMenu.waitFor()
  await page.keyboard.press('Escape')
  await parentMenu.waitFor({ state: 'detached' })
  await expect.poll(() => configuration.evaluate((element) => document.activeElement === element)).toBe(true)
  await configuration.click()
  const branchItem = page.getByRole('menuitem', { name: /Branch main|分支 main/ })
  await branchItem.click()
  const search = page.getByRole('textbox', { name: /^(Search local branches|搜索本地分支)$/ })
  await expect.poll(() => search.evaluate((element) => document.activeElement === element)).toBe(true)
  await search.dispatchEvent('compositionstart')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => search.evaluate((element) => document.activeElement === element)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => search.evaluate((element) => document.activeElement === element)).toBe(true)
  await search.dispatchEvent('compositionend')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.getByRole('menuitemradio', { name: 'main', exact: true }).evaluate((element) => document.activeElement === element)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => branchItem.evaluate((element) => document.activeElement === element)).toBe(true)
  await page.keyboard.press('Escape')
  await parentMenu.waitFor({ state: 'detached' })
  const openCreate = async () => {
    await configuration.click()
    await page.getByRole('menuitem', { name: /Branch main|分支 main/ }).click()
    await page.getByRole('menuitem', { name: /Create and check out a new branch…|创建并检出新分支…/ }).click()
  }
  await openCreate()
  await page.getByRole('button', { name: /Set prefix|设置前缀/, exact: true }).click()
  await page.getByRole('textbox', { name: /Set prefix|设置前缀/, exact: true }).fill('team/')
  await page.getByRole('button', { name: /Save prefix|保存前缀/, exact: true }).click()
  await page.getByText(/Prefix saved|前缀已保存/, { exact: true }).waitFor()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Close|关闭/, exact: true })
    .last()
    .click()
  await openCreate()
  const name = page.getByRole('textbox', { name: /Branch name|分支名称/, exact: true })
  expect(await name.inputValue()).toBe('team/')
  expect(await name.evaluate((element) => element === document.activeElement)).toBe(true)
  await name.fill('team/native-branch')
  await page.getByRole('button', { name: /Create and check out|^创建并检出$/, exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  expect((await fixture.git('branch', '--show-current')).trim()).toBe('team/native-branch')
  const saved = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).settings)
  expect(saved).toContainEqual(expect.objectContaining({ key: 'git.branchPrefix', value: 'team/' }))
})

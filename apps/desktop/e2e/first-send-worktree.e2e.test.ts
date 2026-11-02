import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected } from './harness.ts'

it('CW-65: real Electron sends its first project message in a new worktree from the selected base branch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-worktree-native-')))
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
  await writeFile(join(repo, 'README.md'), 'source checkout')
  await git('add', '-A')
  await git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
  await git('checkout', '-qb', 'feature')
  await writeFile(join(repo, 'feature.txt'), 'base branch')
  await git('add', '-A')
  await git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'feature')
  const base = (await git('rev-parse', 'HEAD')).trim()
  await git('checkout', '-q', 'main')
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const script = join(home, 'faux.json')
  const requestLog = join(home, 'requests.jsonl')
  await writeFile(
    script,
    JSON.stringify({
      requestLog,
      responses: [
        { content: [{ type: 'toolCall', id: 'native-cwd', name: 'bash', arguments: { command: 'pwd -P > native-cwd.txt' } }] },
        { content: 'Native worktree ready.' },
        { content: 'Worktree attachment expanded.' },
      ],
    }),
  )
  const app = await launchApp({ ...env, COKO_FAUX_SCRIPT: script })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  await page.evaluate(async (path) => {
    await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Worktree fixture' }) })
  }, repo)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Worktree fixture', exact: true }).hover()
  await page.getByRole('button', { name: /New session in Worktree fixture|在 Worktree fixture 中新建会话/ }).click()
  await page.getByRole('button', { name: /Project configuration|项目配置/, exact: true }).click()
  await page.getByRole('switch', { name: /New worktree|新建工作树/ }).click()
  await page.getByRole('menuitem', { name: /Branch main|分支 main/ }).click()
  await page.getByRole('menuitemradio', { name: 'feature', exact: true }).click()
  await page.keyboard.press('Escape')
  expect((await git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
  await page.getByRole('button', { name: /^(Permission mode:|权限模式：)/ }).click()
  await page.getByRole('menuitemradio', { name: /Full access|全权处理/ }).click()
  const editor = page.getByRole('textbox', { name: /^(Give Coko a task|向 Coko 布置任务)$/ })
  await editor.fill('Native worktree task')
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Native worktree ready.' }).waitFor()
  const facts = await page.evaluate(async () => {
    const sessions = (await (await fetch('/api/sessions')).json()).sessions
    const trees = await (await fetch(`/api/workspaces/${sessions[0].workspaceId}/worktrees`)).json()
    return { sessions, trees }
  })
  expect(facts.sessions).toHaveLength(1)
  const tree = facts.trees[0]
  expect(tree).toMatchObject({ name: expect.stringMatching(/^wt-[0-9a-f]{6}$/), baseCommit: base })
  expect(facts.sessions[0].worktree.id).toBe(tree.id)
  expect((await stat(tree.path)).isDirectory()).toBe(true)
  expect((await readFile(join(tree.path, 'native-cwd.txt'), 'utf8')).trim()).toBe(tree.path)
  expect(await readFile(join(tree.path, 'feature.txt'), 'utf8')).toBe('base branch')
  expect((await git('branch', '--show-current')).trim()).toBe('main')
  expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('source checkout')
  expect(facts.sessions[0].cwd).toBe(tree.path)
  await writeFile(join(tree.path, 'README.md'), 'WORKTREE_SELECTED_CONTENT')
  await stubDirectoryPicker(app.app, [join(repo, 'README.md'), join(tree.path, 'README.md')])
  await page.getByRole('button', { name: /^(Add attachment|添加附件)$/ }).click()
  await expect.poll(() => editor.textContent()).toContain(join(repo, 'README.md'))
  await page.getByRole('button', { name: /^(Add attachment|添加附件)$/ }).click()
  await editor.locator('[data-file-reference="README.md"]').waitFor()
  expect(await editor.locator('[data-file-reference]').count()).toBe(1)
  expect(await editor.textContent()).toContain(join(repo, 'README.md'))
  expect(await editor.textContent()).not.toContain('@.coko-worktrees/')
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Worktree attachment expanded.' }).waitFor()
  const sent = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .at(-1)
  expect(JSON.stringify(sent)).toContain('WORKTREE_SELECTED_CONTENT')
  expect(JSON.stringify(sent)).toContain('<file_reference path=')
  expect(JSON.stringify(sent)).not.toContain('source checkout')
  expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('source checkout')
})

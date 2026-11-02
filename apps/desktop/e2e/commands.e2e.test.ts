// / 命令菜单与时间线的命令 chip：真实 Electron + 真实 Sidecar（faux 模型）。夹具 tests/fixtures/commands 复制到临时
// Workspace 与临时 COKO_HOME；断言窗口中实际渲染的菜单（分组、argument-hint、几何）、键盘与指针选择、发送后的 chip 与展开全文。
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cokoHomeOf, createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/commands/', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'coko-commands-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await cp(join(fixtures, 'workspace'), workspace, { recursive: true })
  await cp(join(fixtures, 'coko-home'), cokoHomeOf(root), { recursive: true })
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  await writeFile(join(root, 'faux.json'), JSON.stringify({ requestLog, responses: [{ content: 'reviewed' }, { content: 'hi' }] }))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  return { app, requestLog }
}

describe('/ 命令菜单', () => {
  it('输入 / 看到按来源分组的菜单与 argument-hint；键盘选择后发送，时间线显示命令 chip 并可展开全文', async () => {
    const { app, requestLog } = await setup()
    const page = app.window
    const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: /^(Commands|命令)$/ })
    await menu.waitFor()
    const groups = menu.getByRole('group')
    expect(await groups.evaluateAll((items) => items.map((g) => g.getAttribute('data-group')))).toEqual(['builtin', 'project', 'user'])
    expect(
      await menu
        .getByRole('group', { name: /^(Project|项目)$/ })
        .getByRole('option')
        .allTextContents(),
    ).toEqual([expect.stringMatching(/^\/git:commit/), expect.stringMatching(/^\/review<path> \[focus\]Review a path for bugs$/)])
    expect(
      await menu
        .getByRole('group', { name: /^(User|用户)$/ })
        .getByRole('option')
        .allTextContents(),
    ).toEqual([expect.stringMatching(/^\/hello<name>Greet someone$/)])
    // 焦点留在编辑区，选中项经 aria-activedescendant 指出。
    expect(await composer.evaluate((el) => el === document.activeElement)).toBe(true)
    // 菜单不越出窗口，在输入区上方。
    const box = (await page.locator('[data-slot="composer-typeahead"]').boundingBox())!
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const editorBox = (await composer.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(editorBox.y)

    await page.keyboard.type('rev')
    await expect.poll(() => menu.getByRole('option').count()).toBe(1)
    await page.keyboard.press('Enter')
    await expect.poll(() => composer.textContent()).toBe('/review ')
    await page.keyboard.type('src')
    await page.keyboard.press('Enter')

    const chip = page.locator('[data-slot="command-message"][data-command="review"]')
    await chip.waitFor()
    await expect.poll(() => chip.locator('summary').textContent()).toBe('/reviewsrc')
    const expanded = chip.locator('[data-slot="command-expanded"]')
    expect(await expanded.isVisible()).toBe(false)
    await chip.locator('summary').click()
    await expect.poll(() => expanded.textContent()).toBe('Review the code under src and report bugs. Focus: correctness.')
    expect(await expanded.isVisible()).toBe(true)
    await page.getByRole('article', { name: 'Coko' }).first().waitFor()
    const sent = (await readFile(requestLog, 'utf8')).trim().split('\n')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Review the code under src')
    expect(sent[0]).not.toContain('/review')
  })

  it('可用指针选择；Esc 关闭菜单且草稿不变', async () => {
    const { app } = await setup()
    const page = app.window
    const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: /^(Commands|命令)$/ })
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    expect(await composer.textContent()).toBe('/')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('/he')
    await menu.waitFor()
    await menu.getByRole('option', { name: /\/hello/ }).click()
    await expect.poll(() => composer.textContent()).toBe('/hello ')
    expect(await composer.evaluate((el) => el === document.activeElement)).toBe(true)
    expect(await menu.count()).toBe(0)
  })
})

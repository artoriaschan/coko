// @ 文件引用与草稿持久化（票 06）：真实 Electron + 真实 Sidecar（faux 模型）。断言窗口中实际渲染的 @ 菜单与引用 chip、faux requestLog
// 中的 <file_reference> 块，以及草稿在切换会话、重启应用后的保留、提交后的清除与损坏时的处理（localStorage 中实际的键）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function prepare(responses: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'coko-refs-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(join(workspace, 'README.md'), '# Readme\n')
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  await writeFile(join(root, 'faux.json'), JSON.stringify({ requestLog, responses }))
  return { root, workspace, requestLog }
}

async function start(root: string) {
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  return app
}

async function addWorkspace(app: LaunchedApp, workspace: string) {
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
}

const composerOf = (page: Page) => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const filesMenu = (page: Page) => page.getByRole('listbox', { name: /^(Files|文件)$/ })
const drafts = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith('coko.draft.'))
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  )

/** 在 composer 中输入 @query，等菜单出现 option 后按 Enter 插入引用。 */
async function insertReference(page: Page, query: string, option: string) {
  await page.keyboard.type(`@${query}`)
  const menu = filesMenu(page)
  await menu.waitFor()
  await expect.poll(() => menu.getByRole('option').first().textContent()).toBe(option)
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'detached' })
}

async function sendAndWait(page: Page, text: string, replies: number) {
  await composerOf(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 15_000 }).toBe(replies)
}

describe('@ 文件引用', () => {
  it('@ 菜单搜索并插入文件（chip），发送后时间线显示引用 chip，模型收到 <file_reference> 块', async () => {
    const { root, workspace, requestLog } = await prepare([{ content: 'seen' }])
    const app = await start(root)
    await addWorkspace(app, workspace)
    const page = app.window
    const composer = composerOf(page)
    await composer.click()
    await page.keyboard.type('look at ')
    await insertReference(page, 'a.t', 'src/a.ts')
    // 编辑区内是一个原子引用节点，焦点留在编辑区。
    expect(await composer.locator('[data-file-reference]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fileReference))).toEqual(['src/a.ts'])
    expect(await composer.evaluate((el) => el === document.activeElement)).toBe(true)
    await page.keyboard.type('now')
    expect(await composer.textContent()).toBe('look at @src/a.ts now')
    await page.keyboard.press('Enter')

    const chip = page.locator('[data-slot="file-reference-chip"][data-path="src/a.ts"]')
    await chip.waitFor()
    expect(await chip.textContent()).toBe('src/a.ts')
    // 气泡只显示用户的原文，不显示文件内容。
    expect(
      await page
        .getByRole('article', { name: /^(You|你)$/ })
        .locator('[data-user-content]')
        .first()
        .textContent(),
    ).toBe('look at @src/a.ts now')
    await page.getByRole('article', { name: 'Coko' }).first().waitFor()
    const sent = (await readFile(requestLog, 'utf8')).trim()
    expect(sent).toContain('<file_reference path=\\"src/a.ts\\">\\nexport const a = 1')
    // 提交后草稿被清除。
    await expect.poll(() => drafts(page)).toEqual({})
  })
})

describe('草稿持久化', () => {
  it('写一半的草稿（含引用）切换会话后保留、重启应用后保留，提交后清除；localStorage 中的损坏 JSON 使输入区为空且不报错', async () => {
    const { root, workspace, requestLog } = await prepare([{ content: 'one' }, { content: 'two' }, { content: 'three' }])
    let app = await start(root)
    await addWorkspace(app, workspace)
    let page = app.window
    await sendAndWait(page, 'first session', 1)
    const sessions = page.locator('[data-session-id]')
    await expect.poll(() => sessions.count()).toBe(1)
    const first = (await sessions.first().getAttribute('data-session-id'))!
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
    await page.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
    await sendAndWait(page, 'second session', 1)
    await expect.poll(() => sessions.count()).toBe(2)
    const second = (await page.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id'))!
    expect(second).not.toBe(first)

    // 在第二个会话中写一半（含引用）。
    const composer = composerOf(page)
    await composer.click()
    await page.keyboard.type('half ')
    await insertReference(page, 'READ', 'README.md')
    await page.keyboard.type('done')
    const key = `coko.draft.${second}`
    await expect.poll(async () => Object.keys(await drafts(page))).toEqual([key])
    expect((await drafts(page))[key]).toContain('"type":"file-reference"')

    // 切换到第一个会话：输入区为空；切回来：草稿与引用节点仍在。
    await page.locator(`[data-session-id="${first}"]`).click()
    await expect.poll(() => composer.textContent()).toBe('')
    await page.locator(`[data-session-id="${second}"]`).click()
    await expect.poll(() => composer.textContent()).toBe('half @README.md done')
    expect(await composer.locator('[data-file-reference="README.md"]').count()).toBe(1)

    // 重启应用：草稿仍在。
    await app.dispose()
    apps.splice(apps.indexOf(app), 1)
    app = await start(root)
    page = app.window
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator(`[data-session-id="${second}"]`).click()
    const restored = composerOf(page)
    await expect.poll(() => restored.textContent()).toBe('half @README.md done')
    expect(await restored.locator('[data-file-reference="README.md"]').count()).toBe(1)

    // 提交后清除：时间线显示引用 chip，localStorage 中没有该会话的草稿。
    await restored.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.locator('[data-slot="file-reference-chip"][data-path="README.md"]').waitFor()
    await expect.poll(() => restored.textContent()).toBe('')
    await expect.poll(() => drafts(page)).toEqual({})
    await expect.poll(async () => (await readFile(requestLog, 'utf8')).includes('<file_reference path=\\"README.md\\">')).toBe(true)

    // 损坏的草稿：输入区为空、不报错，坏值被删除。
    await page.evaluate((k) => localStorage.setItem(k, '{"root": broken'), `coko.draft.${first}`)
    await page.locator(`[data-session-id="${first}"]`).click()
    await page
      .getByRole('article', { name: /^(You|你)$/ })
      .first()
      .waitFor()
    expect(await restored.textContent()).toBe('')
    await expect.poll(() => drafts(page)).toEqual({})
    await restored.click()
    await page.keyboard.type('still works')
    expect(await restored.textContent()).toBe('still works')
    expect(errors).toEqual([])
  })
})

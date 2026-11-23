// @ 文件引用、会话引用与草稿持久化：真实 Electron + 真实 Sidecar（faux 模型）。断言窗口中实际渲染的 @ 菜单与引用 chip、faux requestLog
// 中的 <file_reference> 与 <session_reference> 块，以及草稿在切换会话、重启应用后的保留、提交后的清除与损坏时的处理（localStorage 中实际的键）。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function prepare(responses: unknown[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-refs-')))
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
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  return app
}

async function addWorkspace(app: LaunchedApp, workspace: string) {
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
}

const composerOf = (page: Page) => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const filesMenu = (page: Page) => page.getByRole('listbox', { name: /^(Files and sessions|文件与会话)$/ })
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
  await waitConnected(page)
  await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 15_000 }).toBe(replies)
}

describe('@ 文件引用', () => {
  it('主输入框的系统附件选择插入 Workspace 引用，发送后协议记录与模型均收到引用', async () => {
    const { root, workspace, requestLog } = await prepare([{ content: 'ready' }, { content: 'attached' }])
    const app = await start(root)
    await addWorkspace(app, workspace)
    const page = app.window
    await sendAndWait(page, 'start', 1)
    await stubDirectoryPicker(app.app, [join(workspace, 'src/a.ts')])
    await page.getByRole('button', { name: /^(Add attachment|添加附件)$/ }).click()
    await composerOf(page).locator('[data-file-reference="src/a.ts"]').waitFor()
    expect(await composerOf(page).evaluate((element) => document.activeElement === element)).toBe(true)
    // 真实磁盘 File，经 preload 的 webUtils 解析路径；不在 renderer 伪造 path 属性。
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.dataset.attachmentFixture = ''
      document.body.append(input)
    })
    await page.locator('input[data-attachment-fixture]').setInputFiles(join(workspace, 'README.md'))
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[data-attachment-fixture]')!
      const clipboardData = new DataTransfer()
      clipboardData.items.add(input.files![0]!)
      document.querySelector('[contenteditable="true"]')!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
      input.remove()
    })
    await composerOf(page).locator('[data-file-reference="README.md"]').waitFor()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 15_000 }).toBe(2)
    const entries = await page.evaluate(async () => {
      const { sessions } = (await (await fetch('/api/sessions')).json()) as { sessions: { id: string }[] }
      const detail = (await (await fetch(`/api/sessions/${sessions[0]!.id}`)).json()) as { entries: { kind: string; payload: { role?: string } }[] }
      return detail.entries.filter((entry) => entry.kind === 'message' && entry.payload.role === 'user')
    })
    expect(JSON.stringify(entries.at(-1))).toContain('@src/a.ts')
    expect(JSON.stringify(entries.at(-1))).toContain('@README.md')
    expect(await readFile(requestLog, 'utf8')).toContain('export const a = 1')
  })
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

describe('@ 会话引用', () => {
  it('@ 菜单选择同一 Project 的另一个会话并提交：模型收到那次会话的文字记录，时间线显示会话 chip，点击回到那次会话', async () => {
    const { root, workspace, requestLog } = await prepare([{ content: 'PLAN-REPLY' }, { content: 'seen' }])
    const app = await start(root)
    await addWorkspace(app, workspace)
    const page = app.window
    await sendAndWait(page, 'plan PLAN-USER', 1)
    const current = page.locator('[data-session-id][aria-current="page"]')
    const first = (await current.getAttribute('data-session-id'))!

    // 同一 Project 的新对话（还没有 Session）：@ 菜单文件组在前、会话组在后。
    await page.getByRole('button', { name: 'Example project', exact: true }).hover()
    await page.getByRole('button', { name: /^(New session in Example project|在 Example project 中新建会话)$/ }).click()
    await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    const composer = composerOf(page)
    await composer.click()
    await page.keyboard.type('continue @')
    const menu = filesMenu(page)
    await menu.waitFor()
    const groups = () => menu.getByRole('group').evaluateAll((items) => items.map((g) => g.getAttribute('data-group')))
    await expect.poll(groups).toEqual(['files', 'sessions'])
    // 继续打字按标题过滤：没有匹配的文件，只剩会话组里的那一个。
    await page.keyboard.type('plan')
    await expect.poll(groups).toEqual(['sessions'])
    expect(await menu.getByRole('option').allTextContents()).toEqual([expect.stringMatching(/^plan PLAN-USER/)])
    await page.keyboard.press('Enter')
    await menu.waitFor({ state: 'detached' })
    // 编辑区内是显示标题的 chip，焦点留在编辑区。
    expect(await composer.locator(`[data-session-reference="${first}"]`).textContent()).toBe('@plan PLAN-USER')
    expect(await composer.evaluate((el) => el === document.activeElement)).toBe(true)
    await page.keyboard.type('now')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 15_000 }).toBe(1)

    // 模型收到的是 @session:<id> 原文与那次会话的文字记录。
    const sent = await readFile(requestLog, 'utf8')
    expect(sent).toContain(`continue @session:${first} now`)
    expect(sent).toContain(`<session_reference id=\\"${first}\\" title=\\"plan PLAN-USER\\">`)
    expect(sent).toContain('[User]: plan PLAN-USER')
    expect(sent).toContain('[Assistant]: PLAN-REPLY')

    // 时间线：气泡显示 @标题，记录不进入气泡；侧栏的占位标题（截到 20 个字符）以标题显示引用，不含 id。
    const bubble = page.getByRole('article', { name: /^(You|你)$/ }).locator('[data-user-content]')
    expect(await bubble.first().textContent()).toBe('continue @plan PLAN-USER now')
    const second = (await current.getAttribute('data-session-id'))!
    expect(second).not.toBe(first)
    const row = await page.locator(`[data-session-id="${second}"]`).textContent()
    expect(row).toContain('continue @plan')
    expect(row).not.toContain('session:')
    const chip = page.locator(`[data-slot="session-reference-chip"][data-session-id="${first}"]`)
    expect(await chip.textContent()).toBe('plan PLAN-USER')

    // 点击 chip 回到被引用的会话。
    await chip.click()
    await expect.poll(() => current.getAttribute('data-session-id')).toBe(first)
    await expect.poll(() => bubble.first().textContent()).toBe('plan PLAN-USER')
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
    // 新对话快捷键创建独立对话；本例需要同一项目中的 README.md。
    await page.getByRole('button', { name: 'Example project', exact: true }).hover()
    await page.getByRole('button', { name: /^(New session in Example project|在 Example project 中新建会话)$/ }).click()
    await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
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

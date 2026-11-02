// 回退与分叉：真实 Electron + 真实 Sidecar（faux）。悬停用户消息出现回退动作，确认对话框列出将恢复与删除的文件和
// bash 不追踪说明；执行后输入区为原消息文本、时间线折叠、文件回到之前的内容。分叉后侧栏出现新会话并打开。键盘可达。
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const write = (id: string, path: string, content: string) => ({ type: 'toolCall', name: 'write', id, arguments: { path, content } })

/** 两条消息：第一条改 notes.txt，第二条再改它并新建 extra.txt（accept-edits，不经审批）。 */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'coko-rewind-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'original\n')
  const script = {
    responses: [
      { content: [write('w1', 'notes.txt', 'after one\n')] },
      { content: 'First done.' },
      { content: [write('w2', 'notes.txt', 'after two\n'), write('w3', 'extra.txt', 'extra\n')] },
      { content: 'Second done.' },
    ],
  }
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="accept-edits"]').click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('accept-edits')
  await send(app, 'first change')
  await send(app, 'second change')
  expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const replies = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' })
async function send(app: LaunchedApp, text: string) {
  const before = await replies(app).count()
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
  await expect.poll(() => replies(app).count(), { timeout: 30_000 }).toBe(before + 1)
  await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
}
const userMessage = (app: LaunchedApp, text: string) => app.window.locator('article[data-seq]', { hasText: text })
const opacity = (locator: ReturnType<LaunchedApp['window']['locator']>) => locator.evaluate((el) => getComputedStyle(el).opacity)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe('回退与分叉', () => {
  it('悬停用户消息出现回退动作；确认对话框列出文件与 bash 说明；执行后输入区为原消息、时间线折叠、文件恢复', async () => {
    const { app, workspace } = await setup()
    const second = userMessage(app, 'second change')
    const actions = second.locator('[data-slot="message-actions"]')
    // 未悬停时动作不可见（支持 hover 的窗口），悬停后出现。
    await app.window.mouse.move(0, 0)
    await expect.poll(() => opacity(actions)).toBe('0')
    await second.hover()
    await expect.poll(() => opacity(actions)).toBe('1')
    await actions.locator('[data-action="rewind"]').click()

    const dialog = app.window.locator('[data-slot="rewind-dialog"]')
    await dialog.waitFor()
    expect(await dialog.locator('[data-rewind-mode="both"]').getAttribute('data-state')).toBe('on')
    const restored = dialog.locator('[data-slot="rewind-restored"] li')
    await restored.first().waitFor({ timeout: 15_000 })
    expect(await restored.allTextContents()).toEqual(['notes.txt'])
    expect(await dialog.locator('[data-slot="rewind-deleted"] li').allTextContents()).toEqual(['extra.txt'])
    expect(await dialog.locator('[data-slot="rewind-diverged"]').count()).toBe(0)
    expect(await dialog.locator('[data-slot="rewind-bash-note"]').textContent()).toMatch(/bash/)
    // 对话框打开期间文件未变（dry-run）。
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')

    await dialog.locator('[data-action="confirm-rewind"]').click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => composer(app).textContent(), { timeout: 15_000 }).toBe('second change')
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after one\n')
    expect(await exists(join(workspace, 'extra.txt'))).toBe(false)
    // 被回退的区间折叠：第二条消息与回复收进 rewound，默认收起；第一条仍可回退。
    const rewound = app.window.locator('[data-slot="rewound"]')
    await rewound.waitFor()
    expect(await rewound.getAttribute('open')).toBeNull()
    expect(await rewound.locator('article[data-seq]').allTextContents()).toEqual(['second change'])
    expect(await rewound.locator('[data-action="rewind"]').count()).toBe(0)
    expect(await replies(app).filter({ visible: true }).allTextContents()).toEqual(['First done.'])
    await rewound.locator('summary').click()
    expect(await rewound.getByRole('article', { name: 'Coko' }).allTextContents()).toEqual(['Second done.'])
  })

  it('键盘：Tab 到消息后动作出现并可触发；Esc 关闭对话框不回退', async () => {
    const { app, workspace } = await setup()
    const first = userMessage(app, 'first change')
    await app.window.mouse.move(0, 0)
    await first.focus()
    const actions = first.locator('[data-slot="message-actions"]')
    await expect.poll(() => opacity(actions)).toBe('1')
    await app.window.keyboard.press('Tab')
    expect(await app.window.evaluate(() => document.activeElement?.getAttribute('data-action'))).toBe('rewind')
    await app.window.keyboard.press('Enter')
    const dialog = app.window.locator('[data-slot="rewind-dialog"]')
    await dialog.waitFor()
    await dialog.locator('[data-slot="rewind-restored"] li').first().waitFor({ timeout: 15_000 })
    await app.window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')
    expect(await app.window.locator('[data-slot="rewound"]').count()).toBe(0)
  })

  it('从这里分叉 → 侧栏出现新会话并打开，输入区为原消息；原会话不变', async () => {
    const { app } = await setup()
    const sessions = app.window.locator('[data-session-id]')
    expect(await sessions.count()).toBe(1)
    const original = await sessions.first().getAttribute('data-session-id')
    const second = userMessage(app, 'second change')
    await second.hover()
    await second.locator('[data-action="fork"]').click()

    await expect.poll(() => sessions.count(), { timeout: 15_000 }).toBe(2)
    const active = app.window.locator('[data-session-id][aria-current="page"]')
    await expect.poll(() => active.getAttribute('data-session-id')).not.toBe(original)
    // 标题由界面按当前语言生成。
    expect(await active.textContent()).toMatch(/\(fork\)|（分叉）/)
    await expect.poll(() => composer(app).textContent(), { timeout: 15_000 }).toBe('second change')
    // 新会话只有分叉前的消息。
    await expect.poll(() => app.window.locator('article[data-seq]').allTextContents()).toEqual(['first change'])
    expect(await replies(app).allTextContents()).toEqual(['First done.'])

    await app.window.locator(`[data-session-id="${original}"]`).click()
    await expect.poll(() => app.window.locator('article[data-seq]').allTextContents()).toEqual(['first change', 'second change'])
  })
})

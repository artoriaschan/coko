// Worktree 的侧栏入口（docs/subsystems/worktrees.md）：真实 Electron + 真实 Sidecar（faux）与临时 git 仓库。键盘打开 Workspace 菜单并在新
// worktree 中新建会话 → 分支 chip 出现在会话行与标题栏 → 有未提交文件时移除被拒绝并列出文件 → 干净后移除 → 会话只读提示；明暗主题下
// chip 与提示的文字对比度。git 用临时 HOME 与 GIT_CONFIG_GLOBAL=/dev/null，不读真实的全局配置；worktree 只在临时仓库中创建。
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const run = promisify(execFile)
const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

async function gitRepo(root: string, home: string): Promise<{ repo: string; env: Record<string, string> }> {
  const repo = join(root, 'repo')
  await mkdir(repo)
  const env = {
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Coko E2E',
    GIT_AUTHOR_EMAIL: 'e2e@coko.test',
    GIT_COMMITTER_NAME: 'Coko E2E',
    GIT_COMMITTER_EMAIL: 'e2e@coko.test',
  }
  const git = (...args: string[]) => run('git', args, { cwd: repo, env: { PATH: process.env.PATH ?? '', ...env } })
  await git('init', '-q', '-b', 'main')
  await writeFile(join(repo, 'README.md'), '# e2e\n')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'initial')
  return { repo, env }
}

/**
 * 菜单项打开模态对话框：等菜单节点移除。body 的 pointer-events 此时由对话框（模态）设为 none，不能作为菜单已关闭的信号；
 * 之后的交互都在对话框内。
 */
async function menuClosed(win: Page) {
  await win.locator('[role="menu"]').waitFor({ state: 'detached' })
}

/** 文字与其所在元素背景的对比度（颜色经 canvas 转为 sRGB，支持 oklch 等任意 CSS 颜色）。 */
async function contrast(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }
    // 背景取元素自身或最近的不透明祖先；半透明背景叠在其上。
    const layers: number[][] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const value = rgb(getComputedStyle(node).backgroundColor)
      if (value[3]! > 0) layers.unshift(value)
      if (value[3] === 255) break
    }
    const base = layers.reduce(
      (acc, [r, g, b, a]) => {
        const alpha = a! / 255
        return [acc[0]! * (1 - alpha) + r! * alpha, acc[1]! * (1 - alpha) + g! * alpha, acc[2]! * (1 - alpha) + b! * alpha]
      },
      [255, 255, 255],
    )
    const [fr, fg, fb, fa] = rgb(getComputedStyle(el).color)
    const fore = [fr!, fg!, fb!].map((c, i) => c * (fa! / 255) + base[i]! * (1 - fa! / 255))
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const [a, b] = [lum(fore), lum(base)].sort((x, y) => y - x)
    return (a! + 0.05) / (b! + 0.05)
  })
}

async function setTheme(win: Page, theme: 'dark' | 'light') {
  await win.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  await win.locator(`[data-settings-page] [data-theme-option="${theme}"]`).click()
  await expect.poll(() => win.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
  await win.keyboard.press('Escape')
  await win.locator('[data-settings-page]').waitFor({ state: 'detached' })
}

describe('Worktree 侧栏入口', () => {
  it('键盘在新 worktree 中新建会话；分支 chip；dirty 时移除被拒绝并列出文件；移除后只读提示；明暗主题对比度', { timeout: 180_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-worktrees-e2e-')))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const home = join(root, 'git-home')
    await mkdir(home)
    const { repo, env } = await gitRepo(root, home)
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [{ content: 'Working in the worktree.' }] }))
    const app = await launchApp(
      { COKO_FAUX_SCRIPT: join(root, 'faux.json'), GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' },
      { dir: root },
    )
    apps.push(app)
    const win = app.window
    await waitConnected(win)
    await stubDirectoryPicker(app.app, [repo])
    await win
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await win.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()

    // 键盘：聚焦 Workspace 菜单按钮，Enter 打开，第一项获得焦点，Enter 打开新建对话框；输入名称后 Enter 提交。
    const trigger = win.locator('[data-action="workspace-menu"]')
    await trigger.focus()
    await win.keyboard.press('Enter')
    const item = win.locator('[role="menuitem"][data-action="new-worktree-session"]')
    await expect.poll(() => item.evaluate((el) => el === document.activeElement)).toBe(true)
    await win.keyboard.press('Enter')
    await menuClosed(win)
    const createDialog = win.locator('[data-slot="create-worktree-dialog"]')
    const nameInput = createDialog.locator('input[name="worktree-name"]')
    await expect.poll(() => nameInput.evaluate((el) => el === document.activeElement)).toBe(true)
    // 非法名称：对话框内显示错误，不关闭。
    await win.keyboard.type('Bad/Name')
    await win.keyboard.press('Enter')
    await createDialog.locator('[data-slot="worktree-error"]').waitFor()
    await nameInput.fill('e2e-wt')
    await win.keyboard.press('Enter')
    await createDialog.waitFor({ state: 'detached' })
    const worktreePath = join(repo, '.coko-worktrees', 'e2e-wt')
    expect(await exists(join(worktreePath, 'README.md'))).toBe(true)

    const headerChip = win.locator('header [data-slot="worktree-chip"]')
    await expect.poll(() => headerChip.textContent()).toBe('coko/e2e-wt')
    const rowChip = win.locator('nav [data-session-id] [data-slot="worktree-chip"]')
    await expect.poll(() => rowChip.textContent()).toBe('coko/e2e-wt')

    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('hello from the worktree')
    await composer.press('Enter')
    await win.getByRole('article', { name: 'Coko' }).waitFor({ timeout: 30_000 })
    await win.locator('[data-action="send"]').waitFor({ timeout: 30_000 })

    // 有未提交文件：确认移除后显示 dirty 原因与文件，文件不变。
    await writeFile(join(worktreePath, 'dirty.txt'), 'keep me\n')
    await win.locator('[data-action="workspace-menu"]').click()
    await win.locator('[role="menuitem"][data-action="manage-worktrees"]').click()
    await menuClosed(win)
    const list = win.locator('[data-slot="worktree-list-dialog"]')
    const row = list.locator('li[data-worktree-status="active"]')
    await row.waitFor()
    await row.locator('[data-action="remove-worktree"]').click()
    const confirm = win.locator('[data-slot="remove-worktree-dialog"]')
    await confirm.locator('[data-action="confirm-remove-worktree"]').click()
    const block = confirm.locator('[data-slot="worktree-block"][data-block="dirty"]')
    await block.waitFor()
    expect(await block.locator('li').allTextContents()).toEqual(['dirty.txt'])
    expect(await exists(join(worktreePath, 'dirty.txt'))).toBe(true)

    await rm(join(worktreePath, 'dirty.txt'))
    await confirm.locator('[data-action="confirm-remove-worktree"]').click()
    await confirm.waitFor({ state: 'detached' })
    await list.locator('li[data-worktree-status="removed"]').waitFor()
    await win.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    expect(await exists(worktreePath)).toBe(false)

    const notice = win.locator('[data-slot="worktree-read-only"]')
    await notice.waitFor()
    await expect.poll(() => composer.isVisible()).toBe(false)
    await expect.poll(() => headerChip.getAttribute('data-worktree-status')).toBe('removed')

    for (const theme of ['dark', 'light'] as const) {
      await setTheme(win, theme)
      for (const locator of [headerChip, rowChip, notice.locator('p')]) expect(await contrast(locator)).toBeGreaterThanOrEqual(4.5)
      const shots = process.env.COKO_E2E_SCREENSHOT_DIR
      if (shots) await win.screenshot({ path: join(shots, `worktrees-removed-${theme}.png`) })
    }
  })
})

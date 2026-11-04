// 交接：真实 Electron + Sidecar，通过 /handoff 交接到当前目录；摘要草稿与时间线跳转、明暗主题对比度。
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const run = promisify(execFile)
const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function gitRepo(root: string): Promise<{ repo: string; env: Record<string, string> }> {
  const repo = join(root, 'repo')
  const home = join(root, 'git-home')
  await mkdir(repo)
  await mkdir(home)
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

/** 文字与其所在元素背景的对比度（与 worktrees.e2e 相同的计算）。 */
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

describe('交接', () => {
  it('/handoff → 当前目录 → 目标会话的草稿为摘要（未发送）→ 两边的交接行互相跳转；明暗主题对比度', { timeout: 180_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-handoff-e2e-')))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const { repo, env } = await gitRepo(root)
    // 摘要较长并以每秒 100 token 流出：提交之后能看到进行中。
    const summary = [
      '## Context',
      'Login form uses zod.',
      '## Files',
      '- src/login.tsx',
      '## Open items',
      'None',
      '## Task',
      'Build the login page.',
      'x'.repeat(1600),
    ].join('\n')
    await writeFile(join(root, 'faux.json'), JSON.stringify({ tokensPerSecond: 100, responses: [{ content: 'Form drafted.' }, { content: summary }] }))
    const app = await launchApp(
      { COKO_FAUX_SCRIPT: join(root, 'faux.json'), GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL!, GIT_CONFIG_NOSYSTEM: '1' },
      { dir: root },
    )
    apps.push(app)
    const win = app.window
    await win.getByRole('button', { name: /^(Settings|设置)$/ }).waitFor()
    await createProjectDraft(app, repo)
    await win.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('draft the login form')
    await composer.press('Enter')
    await waitConnected(win)
    await win.getByRole('article', { name: 'Coko' }).waitFor({ timeout: 30_000 })
    await win.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    const sourceTitle = (await win.getByRole('heading', { level: 1 }).textContent())!.trim()
    await writeFile(join(repo, 'notes.txt'), 'uncommitted\n')

    // 唯一 UI 入口为 slash 命令，目标固定为当前目录；没有标题栏按钮或对话框。
    expect(await win.locator('[data-action="open-handoff"]').count()).toBe(0)
    await composer.fill('/handoff continue with the login page')
    await composer.press('Enter')
    expect(await win.locator('[data-slot="handoff-dialog"]').count()).toBe(0)

    // 完成：切到目标会话，标题为下一步目标，目录保持不变；输入区草稿为摘要，没有发送。
    const heading = win.locator('header h1')
    await expect.poll(() => heading.textContent(), { timeout: 60_000 }).toBe('continue with the login page')
    expect(await win.locator('header [data-slot="worktree-chip"]').count()).toBe(0)
    const cwd = await win.evaluate(async () => {
      const sessions = (await fetch('/api/sessions').then((r) => r.json())) as { sessions: { id: string; title: string }[] }
      const target = sessions.sessions.find((s) => s.title === 'continue with the login page')!
      const detail = (await fetch(`/api/sessions/${target.id}`).then((r) => r.json())) as { session: { cwd: string } }
      return detail.session.cwd
    })
    expect(cwd).toBe(repo)
    await expect.poll(async () => (await composer.innerText()).includes('## Task\nBuild the login page.')).toBe(true)
    expect(await composer.innerText()).toContain('## Context\nLogin form uses zod.')
    expect(await win.getByRole('article', { name: /^(You|你)$/ }).count()).toBe(0)

    // 目标时间线：交接自源会话，跳回；源时间线：已交接到目标（当前目录），再打开目标。
    const origin = win.locator('[data-slot="handoff-row"][data-handoff="origin"]')
    await expect.poll(() => origin.textContent()).toContain(sourceTitle)
    await origin.locator('[data-action="open-handoff-source"]').click()
    await expect.poll(() => heading.textContent()).toBe(sourceTitle)
    const source = win.locator('[data-slot="handoff-row"][data-handoff="source"]')
    await expect.poll(() => source.textContent()).toContain('continue with the login page')
    expect(await source.textContent()).not.toMatch(/worktree/)
    await source.locator('.conversation-collaboration-trigger').click()
    expect(JSON.parse((await source.locator('pre').textContent())!).summary).toBe(summary)
    expect(await source.locator('pre').textContent()).toContain('continue with the login page')

    for (const theme of ['dark', 'light'] as const) {
      await setTheme(win, theme)
      expect(await contrast(source.locator('p'))).toBeGreaterThanOrEqual(4.5)
      const shots = process.env.COKO_E2E_SCREENSHOT_DIR
      if (shots) await win.screenshot({ path: join(shots, `handoff-${theme}.png`) })
    }

    await source.locator('[data-action="open-handoff-target"]').click()
    await expect.poll(() => heading.textContent()).toBe('continue with the login page')
    await expect.poll(async () => (await composer.innerText()).includes('## Task')).toBe(true)
  })
})

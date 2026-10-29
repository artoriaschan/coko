// 上下文环（票 10）：真实 Electron + 真实 Sidecar（faux 模型，40k 窗口）。底栏显示百分比；faux 回复使用量越过预警线后环为 warning 色；
// 点击打开 HoverCard 看到分项与 COKO_HOME 的指令文件，Esc 关闭且焦点回到环；窗口最窄时环不挤压模式与模型选择。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, writeCokoHome, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const ring = (page: Page) => page.locator('[data-context-ring]')
const composerOf = (page: Page) => page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const colorOf = (page: Page, className: string) =>
  page.evaluate((cls) => {
    const probe = document.createElement('span')
    probe.className = cls
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, className)

describe('上下文环', () => {
  it('百分比、越过预警线变色、HoverCard 的分项与指令文件、Esc 关闭回到环、最窄窗口不挤压选择器', { timeout: 120_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-context-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const agents = await writeCokoHome(root, 'AGENTS.md', 'Prefer short answers.\n')
    // 回复约 3500 output tokens：越过预警线（3 000），低于阈值（23 000）。
    await writeFile(join(root, 'faux.json'), JSON.stringify({ contextWindow: 40_000, maxTokens: 4_000, responses: [{ content: 'R'.repeat(14_000) }] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const page = app.window
    await waitConnected(page)
    await stubDirectoryPicker(app.app, [workspace])
    await page
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await page.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()

    // 草稿：底栏显示百分比，低于预警线。
    await expect.poll(() => ring(page).textContent(), { timeout: 15_000 }).toMatch(/^\d+%$/)
    expect(await ring(page).getAttribute('data-level')).toBe('normal')
    expect(await ring(page).getAttribute('aria-label')).toMatch(/^(Context \d+% used|上下文已使用 \d+%)$/)

    await composerOf(page).click()
    await page.keyboard.type('hello')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByRole('article', { name: 'Coko' }).count(), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => ring(page).getAttribute('data-level'), { timeout: 15_000 }).toBe('warning')
    // 颜色有过渡动画：等其停在 warning 色。
    const warning = await colorOf(page, 'text-warning')
    await expect.poll(() => ring(page).evaluate((el) => getComputedStyle(el).color)).toBe(warning)
    expect(warning).not.toBe(await colorOf(page, 'text-muted-foreground'))
    expect(Number((await ring(page).textContent())!.replace('%', ''))).toBeGreaterThanOrEqual(8)

    // 点击打开 HoverCard：分项与指令文件。
    await ring(page).click()
    const card = page.getByRole('dialog', { name: /^(Context|上下文)$/ })
    await card.waitFor()
    expect(await card.locator('dt').allTextContents()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^(System prompt|系统提示)$/), expect.stringMatching(/^(Messages|消息)$/)]),
    )
    expect(await card.locator('dt').count()).toBe(6)
    await expect.poll(() => card.locator(`[data-instruction-file="${agents}"]`).count()).toBe(1)
    await page.keyboard.press('Escape')
    await card.waitFor({ state: 'detached' })
    expect(await ring(page).evaluate((el) => el === document.activeElement)).toBe(true)

    // 窗口最窄（minWidth 520）：环、模式与模型选择、发送按钮都在输入区内且互不重叠，模型名只截断。
    await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(520, 820))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(520)
    const geometry = await page.evaluate(() => {
      const form = document.querySelector('form')!
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
      }
      return {
        form: rect('form'),
        overflow: form.scrollWidth - form.clientWidth,
        boxes: ['[data-permission-mode]', '[data-model-picker]', '[data-context-ring]', '[data-action="send"]'].map(rect),
      }
    })
    expect(geometry.overflow).toBeLessThanOrEqual(0)
    for (const box of geometry.boxes) {
      expect(box.width).toBeGreaterThan(20)
      expect(box.left).toBeGreaterThanOrEqual(geometry.form.left)
      expect(box.right).toBeLessThanOrEqual(geometry.form.right + 0.5)
    }
    const [a, b, c, d] = geometry.boxes
    for (const [x, y] of [
      [a, b],
      [a, c],
      [a, d],
      [b, c],
      [b, d],
      [c, d],
    ] as const)
      expect(x!.left < y!.right - 0.5 && y!.left < x!.right - 0.5 && x!.top < y!.bottom - 0.5 && y!.top < x!.bottom - 0.5).toBe(false)
  })
})

// Trace tab（docs/subsystems/tracing.md#界面）：真实 Electron + 真实 Sidecar（faux）。Run 结束后右栏的 Trace tab 列出它（触发、状态、Token），
// 键盘展开为模型请求与工具行；新 Run 结束后自动出现；"导出"经 Electron 的下载保存 .ndjson（接收侧：main 的 will-download 与写出的文件，
// 第一行为 header）；明暗主题下 Run 摘要与请求行的对比度 ≥ 4.5；390 px 窗口下导出按钮可达、不出现整页横向滚动。bash 在 full-access 下运行。
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 文字与其所在元素背景的对比度（与 handoff.e2e 相同的计算）。 */
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

const call = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })

describe('Trace tab', () => {
  it('列出 Run → 键盘展开请求与工具行 → 新 Run 自动出现 → 导出 .ndjson；明暗主题对比度；390 px', { timeout: 180_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-trace-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const downloads = join(root, 'downloads')
    await mkdir(downloads)
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          { content: [call('b1', 'echo traced')], usage: { input: 120, output: 8 } },
          { content: 'First done.', usage: { input: 140, output: 6 } },
          { content: 'Second done.', usage: { input: 160, output: 4 } },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const win = app.window
    await waitConnected(win)
    await stubDirectoryPicker(app.app, [workspace])
    await win
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await win.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await win.locator('[data-permission-mode]').click()
    await win.locator('[role="menuitemradio"][data-mode="full-access"]').click()
    await expect.poll(() => win.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    const send = async (text: string) => {
      await composer.click()
      await composer.fill(text)
      await composer.press('Enter')
    }
    const lastReply = () => win.getByRole('article', { name: 'Coko' }).last().textContent()
    await send('run something')
    await expect.poll(lastReply, { timeout: 30_000 }).toBe('First done.')

    // 右栏 → Trace tab：一个 Run（提交、已完成、两次请求的 Token）。
    await win.getByRole('button', { name: /^(Open right panel|打开右栏)$/ }).click()
    await win.locator('[role="tab"][data-tab="trace"]').click()
    const runs = win.locator('[data-slot="trace-run"]')
    await expect.poll(() => runs.count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => runs.first().getAttribute('data-status')).toBe('completed')
    expect(await runs.first().textContent()).toContain('274 tokens')

    // 键盘展开：两次请求、一个 bash 工具行。之后按 runId 定位（新 Run 出现在最上面）。
    const firstRunId = (await runs.first().getAttribute('data-run-id'))!
    const firstRun = win.locator(`[data-slot="trace-run"][data-run-id="${firstRunId}"]`)
    const toggle = firstRun.locator('[data-action="toggle-run"]')
    await toggle.focus()
    await win.keyboard.press('Enter')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
    const details = firstRun.locator('[data-slot="trace-run-details"]')
    await expect.poll(() => details.locator('[data-slot="trace-request"]').count()).toBe(2)
    expect(await details.locator('[data-slot="trace-tool"]').getAttribute('data-tool')).toBe('bash')

    // 新 Run 结束后自动出现在最上面（不需要切换 tab）。
    await send('again')
    await expect.poll(lastReply, { timeout: 30_000 }).toBe('Second done.')
    await expect.poll(() => runs.count(), { timeout: 15_000 }).toBe(2)
    await expect.poll(() => runs.first().textContent()).toContain('164 tokens')
    expect(await runs.first().getAttribute('data-run-id')).not.toBe(firstRunId)
    // 重读不重挂载已有的 Run：展开状态保留。
    expect(await toggle.getAttribute('aria-expanded')).toBe('true')

    // 导出：main 的 will-download 把下载保存到临时目录（接收侧为写出的文件）。
    await app.app.evaluate(({ session }, dir) => {
      const g = globalThis as { __traceDownloads?: string[] }
      g.__traceDownloads = []
      session.defaultSession.on('will-download', (_event, item) => {
        const path = `${dir}/${item.getFilename()}`
        item.setSavePath(path)
        item.once('done', (_e, state) => g.__traceDownloads!.push(`${state}:${path}`))
      })
    }, downloads)
    const exportButton = win.locator('[data-action="export-session"]')
    await exportButton.focus()
    await win.keyboard.press('Enter')
    const saved = async () => (await app.app.evaluate(() => (globalThis as { __traceDownloads?: string[] }).__traceDownloads ?? []))[0]
    await expect.poll(saved, { timeout: 15_000 }).toMatch(/^completed:.*coko-session-.+\.ndjson$/)
    const file = (await saved())!.slice('completed:'.length)
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'header', format: 'coko-session-export', version: 1 })
    expect(lines.slice(1).map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(expect.arrayContaining(['run_start', 'model_request', 'run_end']))
    await expect.poll(() => win.getByText(/^(Exported|已导出) coko-session-/).count()).toBeGreaterThan(0)

    // 明暗主题：Run 摘要与请求行的文字对比度。
    const summary = firstRun.locator('[data-action="toggle-run"] span.text-ui-small')
    const requestLine = details.locator('[data-slot="trace-request"] span.text-ui-small').first()
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(win, theme)
      await win.locator('[role="tab"][data-tab="trace"]').click()
      expect(await contrast(summary)).toBeGreaterThanOrEqual(4.5)
      expect(await contrast(requestLine)).toBeGreaterThanOrEqual(4.5)
    }

    // 390 px：导出按钮在窗口内，没有整页横向滚动。
    await app.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setMinimumSize(390, 400)
      w.setContentSize(390, 820)
    })
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(390)
    const box = await exportButton.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

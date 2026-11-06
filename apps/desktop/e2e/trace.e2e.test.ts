// 真实 Electron + Sidecar（faux）：轨迹记录、键盘详情、Inspect 精确定位、实时追加与 NDJSON 下载。
// 同时验证明暗主题文字对比度及 390px 窗口，并保存实际渲染截图。bash 在 full-access 下运行。
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, writeCokoHome, type LaunchedApp } from './harness.ts'

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
  it('trajectory ledger, exact Inspect navigation, live append, export, light/dark and 390px', { timeout: 180_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-trace-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'AGENTS.md'), '# Workspace instructions\nTRAJECTORY_WORKSPACE_CONTEXT\n')
    await writeCokoHome(
      root,
      'skills/trajectory-qa/SKILL.md',
      '---\nname: trajectory-qa\ndescription: A skill catalog entry for trajectory verification.\n---\nRead the workspace before editing.\n',
    )
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
    await win.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await createProjectDraft(app, workspace)
    await win.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await win.locator('[data-permission-mode]').click()
    await win.locator('[role="menuitemradio"][data-mode="full-access"]').click()
    await win.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
    await expect.poll(() => win.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    const send = async (text: string) => {
      await composer.click()
      await composer.fill(text)
      await composer.press('Enter')
    }
    const lastReply = () => win.locator('[data-slot="assistant-message-body"]').last().textContent()
    await send('run something')
    await waitConnected(win)
    await expect.poll(lastReply, { timeout: 30_000 }).toBe('First done.')

    await win.getByRole('tab', { name: /^(Trajectory|轨迹)$/, exact: true }).click()
    const ledger = win.locator('[data-slot="trajectory-panel"]')
    const tools = ledger.locator('tr[data-tool-call-id]')
    await expect.poll(() => tools.count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => ledger.locator('[data-timeline-span]').count()).toBeGreaterThan(0)
    expect(await tools.first().textContent()).toContain('traced')
    const system = ledger.locator('tr[data-kind="system"][data-request-purpose="turn"]').first()
    await system.click()
    await ledger.getByRole('tab', { name: /^(System Prompt|系统提示词)$/ }).click()
    const systemPanel = ledger.getByRole('tabpanel', { name: /^(System Prompt|系统提示词)$/ })
    await systemPanel.waitFor()
    expect(await systemPanel.textContent()).toContain('You are Coko')
    expect(await systemPanel.textContent()).not.toContain('<environment>')
    expect(await systemPanel.textContent()).not.toContain('TRAJECTORY_WORKSPACE_CONTEXT')
    await mkdir('.impeccable/review', { recursive: true })
    await win.screenshot({ path: '.impeccable/review/trajectory-system-snapshot.png' })
    await ledger.getByRole('tab', { name: /^(Tools|工具)$/ }).click()
    await ledger
      .getByRole('tabpanel', { name: /^(Tools|工具)$/ })
      .getByText('bash', { exact: true })
      .waitFor()
    await ledger.getByRole('button', { name: /^(Close details|关闭详情)$/ }).click()
    const environment = ledger.locator('tr[data-context-section="environment"]').first()
    await environment.click()
    expect(await ledger.locator('aside').textContent()).toContain('<environment>')
    const user = ledger.locator('tr[data-kind="user"]').first()
    const indexInTable = (row: Locator) => row.evaluate((el) => [...el.parentElement!.children].indexOf(el))
    expect(await indexInTable(environment)).toBeGreaterThan(await indexInTable(user))
    await ledger.locator('tr[data-context-section="instructions"]').first().click()
    expect(await ledger.locator('aside').textContent()).toContain('TRAJECTORY_WORKSPACE_CONTEXT')
    expect(await ledger.locator('tr[data-context-section="skills"]').first().textContent()).toContain('trajectory-qa')
    await ledger.locator('tr[data-context-section="date"]').first().click()
    expect(await ledger.locator('aside').textContent()).toContain('<state_update name="date">')
    await ledger.getByRole('button', { name: /^(Close details|关闭详情)$/ }).click()
    await win.screenshot({ path: '.impeccable/review/trajectory-separated-context.png' })
    const assistant = ledger.locator('tr[data-kind="message"][data-request-purpose="turn"]:not([data-request-only])').first()
    await assistant.click()
    await ledger.locator('aside').getByRole('button', { name: 'bash', exact: true }).waitFor()
    await assistant.locator('button[aria-pressed]').click()
    await ledger.locator('aside[data-inspector="request"]').waitFor()
    await ledger.getByRole('tab', { name: /^(Options|选项)$/ }).click()
    expect(await ledger.getByRole('tabpanel', { name: /^(Options|选项)$/ }).textContent()).toContain('messages:')
    expect(await ledger.getByRole('tabpanel', { name: /^(Options|选项)$/ }).textContent()).toContain('<environment>')
    await win.screenshot({ path: '.impeccable/review/trajectory-request-inspector.png' })
    await ledger.getByRole('button', { name: /^(Close details|关闭详情)$/ }).click()
    await assistant.dblclick()
    await expect.poll(() => tools.count()).toBe(0)
    const callSummary = ledger.locator('tr[data-collapsed-summary="assistant"]')
    expect(Math.round((await callSummary.boundingBox())!.height)).toBe(20)
    await win.screenshot({ path: '.impeccable/review/trajectory-assistant-folded.png' })
    await callSummary.click()
    await expect.poll(() => tools.count()).toBe(1)
    await ledger.locator('tr[data-turn-start="true"]').first().dblclick()
    const turnSummary = ledger.locator('tr[data-collapsed-summary="turn"]')
    await turnSummary.waitFor()
    await expect.poll(() => tools.count()).toBe(0)
    await win.screenshot({ path: '.impeccable/review/trajectory-turn-folded.png' })
    await turnSummary.focus()
    await win.keyboard.press('Enter')
    await expect.poll(() => tools.count()).toBe(1)
    await tools.first().focus()
    await win.keyboard.press('Enter')
    const details = ledger.locator('aside')
    await details.waitFor()
    await details.getByRole('tab', { name: /^(Payload|参数)$/ }).click()
    expect(await details.textContent()).toContain('echo traced')
    await details.getByRole('tab', { name: 'Schema', exact: true }).click()
    expect(await details.textContent()).toContain('"bash"')
    expect(await details.textContent()).toContain('parameters:')
    await details.getByRole('tab', { name: /^(Payload|参数)$/ }).click()

    // A completed Run appends records without losing the selected call.
    await send('again')
    await expect.poll(lastReply, { timeout: 30_000 }).toBe('Second done.')
    await expect.poll(() => ledger.locator('tr[data-kind="user"]').count()).toBe(2)
    expect(await ledger.locator('[data-selected="true"]').getAttribute('data-tool-call-id')).toBe('b1')

    // Inspect through the main timeline opens the same record after folds and search.
    await details.getByRole('button', { name: /^(Close details|关闭详情)$/ }).click()
    await ledger.getByRole('searchbox').fill('missing record')
    await ledger.getByRole('button', { name: /^(Collapse turns|收起所有轮次)$/ }).click()
    await win.getByRole('tab', { name: /^(Conversation|对话)$/, exact: true }).click()
    const process = win.getByRole('button', { name: /^(Work steps|工作步骤)$/ })
    if (await process.count()) await process.first().click()
    const group = win.getByRole('button', { name: /^(Ran commands|已运行命令)$/ })
    if (await group.count()) await group.first().click()
    await win.locator('[data-slot="tool-card"][data-tool="bash"]').first().getByRole('button').first().click()
    await win.getByRole('button', { name: /^(Inspect|查看)$/, exact: true }).click()
    await expect.poll(() => ledger.locator('[data-selected="true"]').getAttribute('data-tool-call-id')).toBe('b1')
    expect(await ledger.getByRole('searchbox').inputValue()).toBe('')

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

    // Theme/readability captures from the actual Electron renderer.
    await mkdir('.impeccable/review', { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(win, theme)
      await win.locator('[role="tab"][data-tab="trajectory"]').click()
      expect(await contrast(details.locator('header span').last())).toBeGreaterThanOrEqual(4.5)
      await win.screenshot({ path: `.impeccable/review/trajectory-${theme}.png` })
    }

    // 390 px：导出按钮在窗口内，没有整页横向滚动。
    await app.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setMinimumSize(390, 400)
      w.setContentSize(390, 820)
    })
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(390)
    await expect.poll(() => win.locator('[data-slot="app-frame-main"]').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(390)
    const box = await exportButton.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await win.screenshot({ path: '.impeccable/review/trajectory-narrow.png' })
  })
})

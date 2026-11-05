// 子代理（docs/subsystems/subagents.md#界面）：真实 Electron + 真实 Sidecar（faux，回复按 match 分给父 Session 与各子 Session）。
// 前台 explore：卡片进度 → 结果，标题栏按钮的 running 数，Agents tab 的只读子时间线；general 子代理的写入审批在父会话输入区中允许后继续；
// 后台子代理在 Agents tab 中用键盘停止（agent_end cancelled）；390 px 窗口与明暗主题；设置 → Agents 列出内置、COKO_HOME 与项目定义及诊断。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, writeCokoHome, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const pad = (n: number) => ' detail'.repeat(n)

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

async function resize(app: LaunchedApp, width: number, height: number) {
  await app.app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setMinimumSize(Math.min(w!, 520), 400)
      win.setContentSize(w!, h!)
    },
    [width, height],
  )
  await expect.poll(() => app.window.evaluate(() => globalThis.innerWidth)).toBe(width)
}

const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement)

describe('子代理界面', () => {
  it(
    '前台 explore 的进度与结果、Agents tab 的只读子时间线、写入审批在父会话中允许、后台子代理用键盘停止；390 px 与明暗主题；设置 → Agents',
    { timeout: 240_000 },
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-subagents-e2e-')))
      onTestFinished(() => rm(root, { recursive: true, force: true }))
      const workspace = join(root, 'workspace')
      await mkdir(join(workspace, '.coko', 'agents'), { recursive: true })
      await writeFile(join(workspace, 'notes.txt'), 'NOTES-CONTENT\n')
      await writeFile(
        join(workspace, '.coko', 'agents', 'writer.md'),
        '---\nname: writer\ndescription: Writes docs in this project\ntools: write, read\nmax-turns: 5\n---\nYou write files.\n',
      )
      await writeFile(join(workspace, '.coko', 'agents', 'broken.md'), '---\ndescription: missing name\n---\nBody\n')
      const shots = process.env.COKO_E2E_SCREENSHOT_DIR
      await writeFile(
        join(root, 'faux.json'),
        JSON.stringify({
          tokensPerSecond: 50,
          responses: [
            // 1. 前台 explore：读文件，然后慢慢写出结论（期间卡片显示进度）。
            {
              match: 'PARENT-1',
              content: [call('agent', 'a1', { description: 'read the notes', prompt: 'CHILD-E read notes.txt', subagent_type: 'explore' })],
            },
            { match: 'CHILD-E', content: [call('read', 'r1', { path: 'notes.txt' })] },
            { match: 'CHILD-E', content: 'FOUND NOTES-CONTENT at notes.txt:1.' + pad(90) },
            { match: 'PARENT-1', content: 'Explored.' },
            // 2. general 写文件：子 Session 中询问，父会话输入区接管。
            { match: 'PARENT-2', content: [call('agent', 'a2', { description: 'write the file', prompt: 'CHILD-W write out.txt', subagent_type: 'general' })] },
            { match: 'CHILD-W', content: [call('write', 'w1', { path: 'out.txt', content: 'from child\n' })] },
            { match: 'CHILD-W', content: 'Wrote out.txt.' },
            { match: 'PARENT-2', content: 'Written.' },
            // 3. 后台：子代理长时间写出文本，直到被停止。
            {
              match: 'PARENT-3',
              content: [
                call('agent', 'a3', { description: 'long survey', prompt: 'CHILD-B survey everything', subagent_type: 'general', run_in_background: true }),
              ],
            },
            { match: 'CHILD-B', content: 'Surveying.' + pad(2500) },
            { match: 'PARENT-3', content: 'Started in background.' },
          ],
        }),
      )
      const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
      apps.push(app)
      await writeCokoHome(root, 'agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews diffs for the user\nmax-turns: 20\n---\nReview.\n')
      const win = app.window
      await win.getByRole('button', { name: /^(Settings|设置)$/ }).waitFor()
      await createProjectDraft(app, workspace)
      await win.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
      const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
      const send = async (text: string) => {
        await composer.click()
        await composer.fill(text)
        await composer.press('Enter')
      }
      const agentCards = win.locator('[data-slot="tool-card"][data-tool="agent"]')
      const headerButton = win.locator('header [data-action="open-agents"]')

      // 1. 前台 explore：运行中显示进度（最近一次工具调用）与标题栏的 running 数；结束后显示用量与结果。
      await send('PARENT-1 explore the notes')
      await waitConnected(win)
      const first = agentCards.nth(0)
      await first.locator(':scope > button').click()
      await expect.poll(() => first.locator('[data-slot="agent-progress"]').textContent(), { timeout: 30_000 }).toBe('read · {"path":"notes.txt"}')
      expect(await first.getAttribute('data-status')).toBe('running')
      expect(await first.textContent()).toMatch(/(Subagent|子代理) explore/)
      expect(await first.textContent()).toContain('read the notes')
      expect(await headerButton.getAttribute('data-running')).toBe('1')
      await expect.poll(() => first.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
      expect(await first.locator('[data-slot="agent-usage"]').textContent()).toMatch(/^(Turns: 2 · Tool calls: 1|轮次 2 · 工具调用 1) · /)
      expect(await first.locator('[data-slot="agent-result"]').textContent()).toContain('FOUND NOTES-CONTENT at notes.txt:1.')
      await expect.poll(() => headerButton.getAttribute('data-running')).toBe('0')
      await win.locator('[data-action="send"]').waitFor({ timeout: 30_000 })

      // Agents tab：标题栏按钮打开；子时间线有子代理的工具卡与结论，没有输入区。
      await headerButton.click()
      const panel = win.locator('#right-panel-tabpanel')
      await panel.locator('[data-slot="agents-tab"]').waitFor()
      const timeline = panel.locator('[data-slot="agent-timeline"]')
      await expect.poll(() => timeline.textContent(), { timeout: 15_000 }).toContain('FOUND NOTES-CONTENT')
      expect(await timeline.locator('[data-slot="tool-card"][data-tool="read"]').count()).toBe(1)
      expect(await panel.getByRole('textbox').count()).toBe(0)
      await win
        .locator('[data-slot="app-frame-right"]')
        .getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ })
        .click()

      // 2. 子代理的写入审批：父会话输入区接管，标出来源；允许后子代理继续并写入文件。
      await send('PARENT-2 write a file')
      const card = win.locator('[data-slot="approval-card"]')
      await card.waitFor({ timeout: 30_000 })
      expect(await card.textContent()).toMatch(/(From subagent|来自子代理) general · write the file/)
      expect(await composer.isVisible()).toBe(false)
      await card.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
      await expect.poll(() => agentCards.nth(1).getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
      expect(await readFile(join(workspace, 'out.txt'), 'utf8')).toBe('from child\n')
      await win.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
      expect(await card.count()).toBe(0)

      // 3. 后台子代理：父 Run 结束后仍在运行；Agents tab 中键盘停止。
      await send('PARENT-3 survey in the background')
      const third = agentCards.nth(2)
      await third.waitFor({ state: 'attached' })
      for (const control of await win.locator('main [data-slot="run-process-control"]').all())
        if ((await control.getAttribute('aria-expanded')) === 'false') await control.click()
      const thirdGroup = third.locator('xpath=ancestor::*[@data-slot="process-group"]')
      const thirdHeader = thirdGroup.locator('[data-slot="process-group-header"]')
      if ((await thirdHeader.getAttribute('aria-expanded')) === 'false') await thirdHeader.click()
      await third.locator(':scope > button').click()
      await expect.poll(() => third.locator('[data-slot="agent-background"]').count(), { timeout: 30_000 }).toBe(1)
      await win.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
      await expect.poll(() => headerButton.getAttribute('data-running'), { timeout: 15_000 }).toBe('1')
      await headerButton.click()
      // 之前打开 tab 时选中的是第一个子代理（选中项固定）：选中运行中的那一个。
      await panel.locator('li button[data-status="running"]').click()
      const detail = panel.locator('[data-slot="agent-detail"]')
      await expect.poll(() => detail.getAttribute('data-status'), { timeout: 15_000 }).toBe('running')
      await expect.poll(() => timeline.textContent(), { timeout: 15_000 }).toContain('CHILD-B survey everything')

      // 明暗主题：卡片的进度行与 Agents tab 的列表次行对比度 ≥ 4.5；390 px 窗口中停止按钮可达、没有整页横向滚动。
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(win, theme)
        if (!(await panel.isVisible())) await headerButton.click()
        expect(await contrast(third.locator('[data-slot="agent-progress"]'))).toBeGreaterThanOrEqual(4.5)
        expect(await contrast(panel.locator('li [data-status] span.text-muted-foreground').first())).toBeGreaterThanOrEqual(4.5)
        if (shots) await win.screenshot({ path: join(shots, `subagents-${theme}.png`) })
        await resize(app, 390, 820)
        if (!(await panel.isVisible())) await headerButton.click()
        const stop = panel.locator('[data-action="stop-agent"]')
        await stop.waitFor()
        await expect.poll(() => win.locator('[data-slot="app-frame"]').getAttribute('data-right')).toBe('fullscreen')
        await expect
          .poll(() =>
            panel.evaluate((el) => {
              const box = el.getBoundingClientRect()
              return [box.x, box.width]
            }),
          )
          .toEqual([0, 390])
        const box = (await stop.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(390)
        expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        if (shots) await win.screenshot({ path: join(shots, `subagents-390-${theme}.png`) })
        await resize(app, 1280, 800)
      }

      // 键盘：从列表项 Tab 到停止按钮，Enter 停止 → agent_end cancelled（卡片、tab 与标题栏都更新）。
      if (!(await panel.isVisible())) await headerButton.click()
      const item = panel.locator('li button[data-status="running"]')
      await item.focus()
      await win.keyboard.press('Enter')
      const stop = panel.locator('[data-action="stop-agent"]')
      await win.keyboard.press('Tab')
      await expect.poll(() => isFocused(stop)).toBe(true)
      await win.keyboard.press('Enter')
      await expect.poll(() => detail.getAttribute('data-status'), { timeout: 15_000 }).toBe('cancelled')
      await expect.poll(() => third.locator('[data-slot="agent-card"]').getAttribute('data-agent-status'), { timeout: 15_000 }).toBe('cancelled')
      await expect.poll(() => headerButton.getAttribute('data-running')).toBe('0')
      expect(await stop.count()).toBe(0)

      // 设置 → Agents：内置、COKO_HOME 与项目定义；诊断可展开；注明在文件中编辑。
      await win.getByRole('button', { name: /^(Settings|设置)$/ }).click()
      await win.locator('[data-settings-page] [data-section="agents"]').click()
      const section = win.locator('[data-agents-section]')
      await expect.poll(() => section.locator('[data-agent-definition]').count(), { timeout: 15_000 }).toBe(4)
      const listed = await section
        .locator('[data-agent-definition]')
        .evaluateAll((els) => els.map((e) => [e.getAttribute('data-agent-definition'), e.getAttribute('data-source')]))
      expect(listed).toEqual([
        ['explore', 'builtin'],
        ['general', 'builtin'],
        ['reviewer', 'user'],
        ['writer', 'project'],
      ])
      expect(await section.locator('[data-agent-definition="reviewer"]').textContent()).toContain(join(root, 'coko-home', 'agents', 'reviewer.md'))
      expect(await section.locator('[data-slot="agents-edit-hint"]').textContent()).toContain('.coko/agents/*.md')
      const diagnostics = section.locator('details[data-agents-diagnostics]')
      await diagnostics.locator('summary').focus()
      await win.keyboard.press('Enter')
      await expect.poll(() => diagnostics.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true)
      expect(await diagnostics.locator('[data-diagnostic="invalid-frontmatter"]').textContent()).toContain('broken.md')
      if (shots) await win.screenshot({ path: join(shots, 'subagents-settings.png') })
    },
  )
})

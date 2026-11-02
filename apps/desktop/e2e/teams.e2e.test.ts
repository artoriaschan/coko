// Agent Teams 界面（docs/subsystems/teams.md#界面）：真实 Electron + 真实 Sidecar（faux：lead 的回复按顺序，teammate 的回复按 match）。
// lead 创建 alice、bob 两个 teammate、建两个任务并分别发消息；两人各自认领（Team tab 实时显示 in_progress 与 owner），写文件时的审批在
// 父会话输入区出现并允许，之后完成任务；标题栏团队按钮的 running 数随之变化；点成员看到其只读时间线（团队消息行，没有 <team-message>
// 原文）；lead 时间线的任务行；明暗主题下名册与任务行的对比度；键盘选中成员与关闭。
// match 只出现在 teammate 的输入中：任务标题会进入 teammate 的 <team> section，teammate 的结果会进入 lead 的通知，二者都不含 match 文本。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

/** 文字与其所在元素背景的对比度（与 subagents.e2e 相同的计算）。 */
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

const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement)

describe('团队界面', () => {
  it(
    'lead 创建两个 teammate 与任务、各自认领与完成：Team tab 实时显示，标题栏 running 数，teammate 的审批在父会话中回答；成员只读时间线；明暗主题与键盘',
    { timeout: 240_000 },
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-teams-e2e-')))
      onTestFinished(() => rm(root, { recursive: true, force: true }))
      const workspace = join(root, 'workspace')
      await mkdir(workspace, { recursive: true })
      const shots = process.env.COKO_E2E_SCREENSHOT_DIR
      const teammate = (id: string, name: string, prompt: string) => call('agent', id, { description: name, prompt, subagent_type: 'general', name })
      await writeFile(
        join(root, 'faux.json'),
        JSON.stringify({
          tokensPerSecond: 200,
          responses: [
            // lead（没有 match，按顺序）：创建两个 teammate → 建两个任务 → 分别发消息 → 结束。之后的空闲通知可能让它多走一轮。
            { content: [teammate('a1', 'alice', 'MATE-ALICE stand by'), teammate('a2', 'bob', 'MATE-BOB stand by')] },
            {
              content: [
                call('task_create', 'c1', { subject: 'Build the API', write_scopes: ['api.txt'] }),
                call('task_create', 'c2', { subject: 'Write the docs' }),
              ],
            },
            {
              content: [
                call('send_message', 'm1', { to: 'alice', message: 'ALICE-GO take t1', summary: 'take t1' }),
                call('send_message', 'm2', { to: 'bob', message: 'BOB-GO take t2', summary: 'take t2' }),
              ],
            },
            { content: 'The team is on it.' },
            { content: 'Noted.' },
            { content: 'Noted.' },
            { content: 'Noted.' },
            // teammate：先待命；收到消息后认领、写文件（询问）、完成。
            { match: 'MATE-ALICE', content: 'Standing by.' },
            { match: 'MATE-BOB', content: 'Standing by.' },
            { match: 'ALICE-GO', content: [call('task_update', 'ua1', { id: 't1', expected_revision: 1, status: 'in_progress' })] },
            { match: 'ALICE-GO', content: [call('write', 'wa', { path: 'api.txt', content: 'api\n' })] },
            { match: 'ALICE-GO', content: [call('task_update', 'ua2', { id: 't1', expected_revision: 2, status: 'completed' })] },
            { match: 'ALICE-GO', content: 'Finished the first task.' },
            { match: 'BOB-GO', content: [call('task_update', 'ub1', { id: 't2', expected_revision: 1, status: 'in_progress' })] },
            { match: 'BOB-GO', content: [call('write', 'wb', { path: 'docs.txt', content: 'docs\n' })] },
            { match: 'BOB-GO', content: [call('task_update', 'ub2', { id: 't2', expected_revision: 2, status: 'completed' })] },
            { match: 'BOB-GO', content: 'Finished the second task.' },
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
      const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
      await composer.click()
      await composer.fill('Split the work between two teammates')
      await composer.press('Enter')

      // 标题栏团队按钮在有 teammate 后出现；打开 Team tab。两人先各跑一轮"待命"（running 会短暂为 2 再回到 0），所以 running 数在
      // 两人都认领了任务、停在写入审批上之后再断言（审批回答之前它们一直 running）。
      const headerButton = win.locator('header [data-action="open-team"]')
      await headerButton.waitFor({ timeout: 60_000 })
      await headerButton.click()
      const panel = win.locator('#right-panel-tabpanel')
      await panel.locator('[data-slot="team-tab"]').waitFor()
      const member = (name: string) => panel.locator(`[data-slot="team-roster"] [data-member="${name}"]`)
      const task = (id: string) => panel.locator(`[data-slot="team-board"] [data-task-id="${id}"]`)
      // Team tab 实时显示：两个任务先为 pending，各自认领后为 in_progress，owner 各自。
      await expect.poll(() => task('t1').getAttribute('data-task-status'), { timeout: 60_000 }).toBe('in_progress')
      await expect.poll(() => task('t2').getAttribute('data-task-status'), { timeout: 60_000 }).toBe('in_progress')
      expect(await task('t1').locator('[data-slot="task-owner"]').textContent()).toMatch(/alice$/)
      expect(await task('t2').locator('[data-slot="task-owner"]').textContent()).toMatch(/bob$/)
      const card = win.locator('[data-slot="approval-card"]')
      await card.waitFor({ timeout: 30_000 })
      await expect.poll(() => member('alice').getAttribute('data-status'), { timeout: 15_000 }).toBe('running')
      await expect.poll(() => member('bob').getAttribute('data-status'), { timeout: 15_000 }).toBe('running')
      await expect.poll(() => headerButton.getAttribute('data-running'), { timeout: 15_000 }).toBe('2')
      expect(await headerButton.getAttribute('aria-label')).toMatch(/^(Team \(2 running\)|团队（2 个运行中）)$/)
      if (shots) await win.screenshot({ path: join(shots, 'teams-running.png') })

      // teammate 的写入审批：父会话输入区接管（M5 的冒泡），标出来源；逐个允许。
      const source = /(From subagent|来自子代理) general · (alice|bob)/
      const allow = () => card.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
      await card.waitFor({ timeout: 30_000 })
      const first = source.exec((await card.textContent()) ?? '')?.[2]
      expect(first).toMatch(/^(alice|bob)$/)
      await allow()
      // 第一个允许后它完成并空闲（running 1），卡片换成另一个成员的请求。
      await expect.poll(() => headerButton.getAttribute('data-running'), { timeout: 30_000 }).toBe('1')
      await expect.poll(async () => source.exec((await card.textContent()) ?? '')?.[2], { timeout: 30_000 }).toBe(first === 'alice' ? 'bob' : 'alice')
      await allow()

      // 两人完成任务并空闲：任务板为 completed，running 0；文件已写入。
      await expect.poll(() => task('t1').getAttribute('data-task-status'), { timeout: 30_000 }).toBe('completed')
      await expect.poll(() => task('t2').getAttribute('data-task-status'), { timeout: 30_000 }).toBe('completed')
      await expect.poll(() => member('alice').getAttribute('data-status'), { timeout: 30_000 }).toBe('idle')
      await expect.poll(() => member('bob').getAttribute('data-status'), { timeout: 30_000 }).toBe('idle')
      await expect.poll(() => headerButton.getAttribute('data-running'), { timeout: 15_000 }).toBe('0')
      expect(await readFile(join(workspace, 'api.txt'), 'utf8')).toBe('api\n')
      expect(await readFile(join(workspace, 'docs.txt'), 'utf8')).toBe('docs\n')
      expect(await card.count()).toBe(0)

      // 点成员：只读时间线中有 lead → alice 的消息行（summary），没有 <team-message> 原文；有写入工具卡；没有输入框。
      await member('alice').click()
      const detail = panel.locator('[data-slot="team-member-detail"]')
      await expect.poll(() => detail.getAttribute('data-status')).toBe('idle')
      expect(
        await panel.locator('[data-slot="team-roster"] [aria-current="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-member'))),
      ).toEqual(['alice'])
      const timeline = panel.locator('[data-slot="team-member-timeline"]')
      await expect.poll(() => timeline.locator('[data-slot="team-message"]').count(), { timeout: 15_000 }).toBe(1)
      expect(await timeline.locator('[data-slot="team-message"]').getAttribute('data-from')).toBe('lead')
      expect(await timeline.locator('[data-slot="team-message-summary"]').textContent()).toBe('take t1')
      await expect.poll(() => timeline.locator('[data-slot="tool-card"][data-tool="write"]').count(), { timeout: 15_000 }).toBe(1)
      expect(await timeline.textContent()).toContain('MATE-ALICE stand by')
      expect(await timeline.textContent()).not.toContain('ALICE-GO')
      expect(await timeline.textContent()).not.toContain('<team-message')
      expect(await panel.getByRole('textbox').count()).toBe(0)

      // lead 的时间线：任务行（创建、认领、完成）与 send_message 工具卡。
      const changes = await win
        .locator('main [data-slot="team-task"]')
        .evaluateAll((els) => els.map((e) => [e.getAttribute('data-task-id'), e.getAttribute('data-task-change')]))
      expect(changes).toEqual(
        expect.arrayContaining([
          ['t1', 'created'],
          ['t2', 'created'],
          ['t1', 'claimed'],
          ['t2', 'claimed'],
          ['t1', 'completed'],
          ['t2', 'completed'],
        ]),
      )
      expect(await win.locator('main [data-slot="tool-card"][data-tool="send_message"]').count()).toBe(2)

      // 明暗主题：名册次行与任务编号对比度 ≥ 4.5。
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(win, theme)
        if (!(await panel.isVisible())) await headerButton.click()
        expect(await contrast(member('bob').locator('[data-slot="member-summary"]'))).toBeGreaterThanOrEqual(4.5)
        expect(await contrast(task('t1').locator('span.font-mono'))).toBeGreaterThanOrEqual(4.5)
        expect(await contrast(win.locator('main [data-slot="team-task"]').first())).toBeGreaterThanOrEqual(4.5)
        if (shots) await win.screenshot({ path: join(shots, `teams-${theme}.png`) })
      }

      // 键盘：焦点在名册最后一个成员（两个 teammate 并行派发，名册按 agent_start 的提交顺序，谁在后不固定），Enter 选中 → 它的时间线；
      // Tab 到成员视图的关闭按钮（任务板没有溢出时不是停点），Enter 关闭。
      if (!(await panel.isVisible())) await headerButton.click()
      const last = panel.locator('[data-slot="team-roster"] [data-member]').last()
      const lastName = (await last.getAttribute('data-member'))!
      await last.focus()
      await win.keyboard.press('Enter')
      await expect.poll(() => detail.getAttribute('data-agent-id')).toBe(await last.getAttribute('data-agent-id'))
      await expect.poll(() => timeline.textContent(), { timeout: 15_000 }).toContain(`MATE-${lastName.toUpperCase()} stand by`)
      const close = panel.locator('[data-action="close-member"]')
      await win.keyboard.press('Tab')
      await expect.poll(() => isFocused(close)).toBe(true)
      await win.keyboard.press('Enter')
      await expect.poll(() => detail.count()).toBe(0)
      expect(await panel.locator('[data-slot="team-board"]').count()).toBe(1)
    },
  )
})

// 后台任务视图（docs/subsystems/jobs.md#界面）：真实 Electron + 真实 Sidecar（faux）。Agent 启动后台 Job → 标题栏徽标 → Jobs tab 中的实时输出
// （ANSI 颜色）→ 停止 → killed、徽标消失；Job chip 打开对应 Job；完成通知为时间线紧凑行；窄窗口（390 px）下右栏为浮层且可用；
// 重启应用后重新打开会话，列表与输出从接口恢复（不依赖已收到的 WS 帧）。bash 在 full-access 下运行（不经审批）。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function launch(root: string) {
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  return app
}

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-jobs-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launch(root)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  return { app, root, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function type(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const lastReply = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' }).last().textContent()
const jobsButton = (app: LaunchedApp) => app.window.locator('[data-action="open-jobs"]')
const badge = (app: LaunchedApp) => app.window.locator('[data-slot="jobs-badge"]')
const detail = (app: LaunchedApp) => app.window.locator('[data-slot="job-detail"]')
const output = (app: LaunchedApp) => app.window.locator('[data-slot="job-output"]')
const jobsTab = (app: LaunchedApp) => app.window.locator('[role="tab"][data-tab="jobs"]')

/** 后台 bash：命令首行即 label；每 0.2 秒输出一行红色的 tick。 */
const ticker = (id: string, name: string) => ({
  type: 'toolCall',
  name: 'bash',
  id,
  arguments: {
    command: `: ${name}; i=0; while true; do i=$((i+1)); printf '\\033[31m${name} tick %d\\033[0m\\n' "$i"; sleep 0.2; done`,
    run_in_background: true,
  },
})

describe('后台任务视图', { timeout: 180_000 }, () => {
  it('徽标 → Jobs tab 实时输出 → 停止后 killed、徽标消失；Job chip 打开对应 Job；通知行；390 px 窗口下可用', async () => {
    const { app } = await setup({
      responses: [{ content: [ticker('b1', 'alpha'), ticker('b2', 'beta')] }, { content: 'Started.' }, { content: 'Both were stopped.' }],
    })
    await type(app, 'start two watchers')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Started.')
    await expect.poll(() => badge(app).textContent(), { timeout: 15_000 }).toBe('2')

    // 标题栏按钮打开右栏的 Jobs tab：缺省选中最近启动的运行中 Job（beta），输出实时追加。
    await jobsButton(app).click()
    await expect.poll(() => jobsTab(app).getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => app.window.locator('[data-slot="jobs-tab"] li').count()).toBe(2)
    await expect.poll(() => detail(app).textContent()).toContain(': beta')
    const ticks = async () => Number(/beta tick (\d+)\s*$/.exec((await output(app).textContent()) ?? '')?.[1] ?? 0)
    await expect.poll(ticks, { timeout: 15_000 }).toBeGreaterThan(2)
    const seen = await ticks()
    await expect.poll(ticks, { timeout: 15_000 }).toBeGreaterThan(seen)
    // SGR 红色映射到终端语义色 terminal-red；控制序列不显示。
    const colors = await output(app).evaluate((el) => {
      const ref = document.createElement('span')
      ref.className = 'text-terminal-red'
      document.body.append(ref)
      const expected = getComputedStyle(ref).color
      ref.remove()
      const span = [...el.querySelectorAll('span')].find((s) => s.textContent?.includes('beta tick'))
      return { actual: span ? getComputedStyle(span).color : null, expected, raw: el.textContent?.includes('\u001b') }
    })
    expect(colors.actual).toBe(colors.expected)
    expect(colors.raw).toBe(false)

    // 停止（键盘）：状态变为 killed，徽标减一。
    const stop = detail(app).locator('[data-action="stop-job"]')
    await stop.focus()
    await app.window.keyboard.press('Enter')
    await expect.poll(() => detail(app).getAttribute('data-status'), { timeout: 15_000 }).toBe('killed')
    // 详情仍是被停止的 Job（缺省选中项不跳到另一个运行中的 Job）。
    expect(await detail(app).textContent()).toContain(': beta')
    await expect.poll(() => badge(app).textContent(), { timeout: 15_000 }).toBe('1')
    const stopped = await ticks()

    // 工具卡上的 Job chip 打开对应 Job（alpha）。
    const alphaChip = app.window.locator('[data-slot="tool-card"][data-tool="bash"] [data-slot="job-chip"]').first()
    expect(await alphaChip.textContent()).toContain(': alpha')
    await app.window
      .getByRole('button', { name: /^(Close right panel|关闭右栏)$/ })
      .first()
      .click()
    await alphaChip.click()
    await expect.poll(() => detail(app).textContent(), { timeout: 10_000 }).toContain(': alpha')
    expect(await jobsTab(app).getAttribute('aria-selected')).toBe('true')
    expect(await detail(app).getAttribute('data-status')).toBe('running')

    // 窄窗口：内容区验收下限 390 px（窗口的 minWidth 为 520，只在本用例中放开）。右栏为浮层，停止按钮可达、输出不撑出整页横向滚动。
    await app.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setMinimumSize(390, 400)
      win.setContentSize(390, 820)
    })
    await expect.poll(() => app.window.evaluate(() => window.innerWidth)).toBe(390)
    const box = await detail(app).locator('[data-action="stop-job"]').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await app.window.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await detail(app).locator('[data-action="stop-job"]').click()
    await expect.poll(() => detail(app).getAttribute('data-status'), { timeout: 15_000 }).toBe('killed')
    await expect.poll(() => badge(app).count(), { timeout: 15_000 }).toBe(0)
    // 已停止的 Job 不再追加输出。
    await app.window.locator('[data-slot="jobs-tab"] li [data-job-id]').last().click()
    expect(await ticks()).toBe(stopped)

    // 空闲时结束的 Job：通知合并到下一条消息开头，时间线显示紧凑行，用户气泡只有用户文本。
    await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820))
    await type(app, 'what happened?')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Both were stopped.')
    const rows = app.window.locator('[data-slot="job-notification"]')
    await expect.poll(() => rows.count()).toBeGreaterThan(0)
    // 两个 Job 在同一个空闲期内结束：一条 job_notification，列出两者。
    expect(await rows.count()).toBe(1)
    const row = (await rows.first().textContent())!
    expect(row).toMatch(/: alpha/)
    expect(row).toMatch(/: beta/)
    expect(row).toMatch(/Stopped|已停止/)
    const bubbles = await app.window.getByRole('article', { name: /^(You|你)$/ }).allTextContents()
    expect(bubbles).toEqual(['start two watchers', 'what happened?'])
  })

  it('重启后重新打开会话：列表与输出从接口恢复', async () => {
    const command = `: build; for i in 1 2 3; do printf '\\033[32mstep %d\\033[0m\\n' "$i"; done; echo build-done`
    const { app, root } = await setup({
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command, run_in_background: true } }] }, { content: 'Building.' }],
    })
    await type(app, 'build in background')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Building.')
    const chipStatus = app.window.locator('[data-slot="job-chip"] [data-job-status]')
    await expect.poll(() => chipStatus.getAttribute('data-job-status'), { timeout: 15_000 }).toBe('completed')
    await apps.splice(apps.indexOf(app), 1)[0]!.dispose()

    const second = await launch(root)
    await second.window.locator('[data-session-id]').first().click()
    await second.window.getByRole('heading', { level: 1, name: 'build in background' }).waitFor({ timeout: 15_000 })
    await jobsButton(second).click()
    await expect.poll(() => jobsTab(second).getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => detail(second).getAttribute('data-status'), { timeout: 15_000 }).toBe('completed')
    await expect.poll(() => output(second).textContent(), { timeout: 15_000 }).toBe('step 1\nstep 2\nstep 3\nbuild-done\n')
    expect(await second.window.locator('[data-slot="jobs-tab"] li').textContent()).toMatch(/exit code 0|退出码 0/)
    expect(await badge(second).count()).toBe(0)
  })
})

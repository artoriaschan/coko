// Plan Mode：真实 Electron + 真实 Sidecar（faux）。模式菜单选"规划"、Plan chip 出现且 × 退出；提交计划后审阅接管输入区、右栏自动打开一次；
// "继续规划"带反馈后模型提交新修订；在右栏编辑后"批准并执行"，模式恢复且时间线有计划卡。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const exit = (id: string, plan: string) => ({ content: [{ type: 'toolCall', name: 'exit_plan_mode', id, arguments: { plan } }] })

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-plan-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
  return { app }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const modeButton = (app: LaunchedApp) => app.window.locator('[data-permission-mode]')
const chip = (app: LaunchedApp) => app.window.locator('[data-slot="plan-chip"]')
const review = (app: LaunchedApp) => app.window.locator('[data-slot="plan-review"]')
const planTab = (app: LaunchedApp) => app.window.locator('[data-slot="plan-tab"]')
/** 打开模式菜单并选"规划"：菜单在 30 秒内没有出现时（高负载下点击可能落在上一次关闭的过程中）关闭后重试。 */
async function choosePlan(app: LaunchedApp) {
  const item = app.window.getByRole('menuitemradio', { name: /^(Plan|规划)/ })
  const deadline = Date.now() + 30_000
  for (;;) {
    await expect.poll(() => modeButton(app).getAttribute('aria-expanded')).not.toBe('true')
    await modeButton(app).click()
    try {
      await item.waitFor({ timeout: 5_000 })
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
      await app.window.keyboard.press('Escape')
    }
  }
  await item.click()
  await chip(app).waitFor()
}

describe('Plan Mode', () => {
  it('规划 → chip × 退出 → 提交计划、右栏自动打开 → 继续规划 → 右栏编辑后批准并执行：模式恢复、计划卡', { timeout: 120_000 }, async () => {
    const { app } = await setup({
      responses: [exit('e1', '# Plan A\n\n- read the code'), exit('e2', '# Plan B\n\n- add tests\n- fix it'), { content: 'Implementing the plan.' }],
    })
    await expect.poll(() => modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    await choosePlan(app)
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('plan')
    // chip 的 × 回到进入前的模式。
    await chip(app).click()
    await expect.poll(() => chip(app).count()).toBe(0)
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('default')

    await choosePlan(app)
    await composer(app).click()
    await composer(app).fill('plan the fix')
    await composer(app).press('Enter')

    // 审阅接管输入区；右栏自动打开到 Plan tab。
    await review(app).waitFor({ timeout: 30_000 })
    expect(await composer(app).isVisible()).toBe(false)
    await planTab(app).waitFor({ timeout: 10_000 })
    expect(await app.window.getByRole('tab', { name: /^(Plan|计划)$/ }).getAttribute('aria-selected')).toBe('true')
    expect(await planTab(app).getAttribute('data-revision')).toBe('1')
    expect(
      await review(app)
        .getByRole('button', { name: /(Approve and run|批准并执行)/ })
        .getAttribute('data-restores'),
    ).toBe('default')

    // 继续规划（反馈）。
    await review(app)
      .getByRole('button', { name: /^(Keep planning|继续规划)$/ })
      .click()
    await review(app)
      .getByRole('textbox', { name: /(Tell the agent what to change|告诉 Agent 需要修改什么)/ })
      .fill('add tests first')
    await review(app)
      .getByRole('button', { name: /^(Send feedback|发送反馈)$/ })
      .click()
    await expect.poll(() => review(app).getAttribute('data-revision'), { timeout: 30_000 }).toBe('2')
    await expect.poll(() => planTab(app).getAttribute('data-revision')).toBe('2')

    // 在右栏编辑后批准并执行。
    await planTab(app)
      .getByRole('button', { name: /^(Edit|编辑)$/ })
      .click()
    await planTab(app)
      .getByRole('textbox', { name: /^(Edit plan|编辑计划)$/ })
      .fill('# Plan B (edited)\n\n- add tests\n- fix it\n- run the suite')
    await review(app).locator('[data-slot="plan-edited"]').waitFor()
    await review(app)
      .getByRole('button', { name: /(Approve and run|批准并执行)/ })
      .click()

    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Implementing the plan.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    expect(await chip(app).count()).toBe(0)
    const approved = app.window.locator('[data-slot="plan-card"][data-status="approved"]')
    await approved.waitFor()
    expect(await approved.getAttribute('data-revision')).toBe('3')
    expect(await approved.textContent()).toContain('Plan B (edited)')
    expect(await app.window.locator('[data-slot="plan-card"][data-status="rejected"]').textContent()).toContain('add tests first')
    await expect.poll(() => planTab(app).getAttribute('data-status')).toBe('approved')
  })
})

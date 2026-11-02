// Plan Mode：真实 Electron + 真实 Sidecar（faux）。/plan 进入、Plan chip 出现且关闭后恢复 prior；提交计划后审阅接管输入区、右栏自动打开一次；
// "继续规划"带反馈后模型提交新修订；在右栏编辑后"批准并执行"，模式恢复且时间线有计划卡。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

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
  await writeFile(join(workspace, 'notes.txt'), 'keep this attachment')
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await createProjectDraft(app, workspace)
  // Plan commands act on an existing Session; draft creation intentionally creates none.
  const session = await app.window.evaluate(async () => {
    const { projects } = await (await fetch('/api/projects')).json()
    const response = await fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: projects[0].primaryWorkspaceId, title: 'Example plan conversation' }),
    })
    if (!response.ok) throw new Error(`Plan fixture failed: ${response.status}`)
    return response.json()
  })
  await app.window.reload()
  await waitConnected(app.window)
  await app.window.locator(`[data-session-id="${session.id}"]`).click()
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const modeButton = (app: LaunchedApp) => app.window.locator('[data-permission-mode]')
const chip = (app: LaunchedApp) => app.window.locator('[data-slot="plan-chip"]')
const review = (app: LaunchedApp) => app.window.locator('[data-slot="plan-review"]')
const planTab = (app: LaunchedApp) => app.window.locator('[data-slot="plan-tab"]')
/**
 * /plan 进入。输入前等上一次的菜单完全关闭：Radix 在退出动画结束前保留 [role=menu]，body 的 pointer-events 仍为 none，
 * 这时的点击会被吞掉（与 goal.e2e 等命令菜单 detached 相同）。
 */
async function choosePlan(app: LaunchedApp) {
  await app.window.locator('[role="menu"]').waitFor({ state: 'detached' })
  await expect.poll(() => app.window.evaluate(() => document.body.style.pointerEvents)).not.toBe('none')
  await composer(app).fill('/plan ')
  await composer(app).press('Enter')
  await chip(app).waitFor()
}

describe('Plan Mode', () => {
  it('规划 → chip × 退出 → 提交计划、右栏自动打开 → 继续规划 → 右栏编辑后批准并执行：模式恢复、计划卡', { timeout: 120_000 }, async () => {
    const { app, workspace } = await setup({
      responses: [exit('e1', '# Plan A\n\n- read the code'), exit('e2', '# Plan B\n\n- add tests\n- fix it'), { content: 'Implementing the plan.' }],
    })
    await expect.poll(() => modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    await choosePlan(app)
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('plan')
    await composer(app).fill('keep this draft ')
    await stubDirectoryPicker(app.app, [join(workspace, 'notes.txt')])
    await app.window.locator('[data-action="attach"]').click()
    await composer(app).locator('[data-file-reference="notes.txt"]').waitFor()
    const selectedModel = await app.window.locator('[data-model-picker]').textContent()
    // chip 的 × 回到进入前的模式。
    await chip(app).click()
    await expect.poll(() => chip(app).count()).toBe(0)
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    expect(await composer(app).evaluate((element) => document.activeElement === element)).toBe(true)
    expect(await composer(app).textContent()).toContain('keep this draft @notes.txt')
    expect(await app.window.locator('[data-model-picker]').textContent()).toBe(selectedModel)
    expect(
      await app.window.evaluate(async () => {
        const { sessions } = (await (await fetch('/api/sessions')).json()) as { sessions: { id: string }[] }
        return ((await (await fetch(`/api/sessions/${sessions[0]!.id}/permission-rules`)).json()) as { mode: string }).mode
      }),
    ).toBe('default')

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

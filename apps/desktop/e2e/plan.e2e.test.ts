// Plan Mode：真实 Electron + 真实 Sidecar（faux）。/plan 进入、Plan chip 出现且关闭后退出规划（Permission Mode 始终不变，ADR 0028）；提交计划后审阅
// 接管输入区、右栏自动打开一次；"继续规划"带反馈后模型提交新修订；在右栏编辑后"批准并执行"，模式不变且时间线有计划卡。
// 完全访问权限下规划：模式菜单仍勾选该模式；chip × 退出与审阅卡上切换权限后批准，都从协议读回计划阶段与模式。
// 执行与结束：批准后 chip 为执行中，模型拆待办并提交完成报告后计划卡与 Plan tab 为已完成且显示报告、chip 消失；执行中点 chip × 放弃，
// 计划卡与 Plan tab 为已放弃，协议读回没有活动的 Plan，已写入的文件仍在。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const call = (name: string, id: string, args: Record<string, unknown>) => ({ content: [{ type: 'toolCall', name, id, arguments: args }] })
const exit = (id: string, plan: string) => call('exit_plan_mode', id, { plan })

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-plan-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'keep this attachment')
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await app.window
    .getByRole('button', { name: /^(Add project|创建项目)$/ })
    .first()
    .waitFor()
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
  await app.window.locator(`[data-session-id="${session.id}"]`).click()
  await waitConnected(app.window)
  return { app, workspace, sessionId: session.id as string }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const modeButton = (app: LaunchedApp) => app.window.locator('[data-permission-mode]')
const chip = (app: LaunchedApp) => app.window.locator('[data-slot="plan-chip"]')
const review = (app: LaunchedApp) => app.window.locator('[data-slot="plan-review"]')
const planTab = (app: LaunchedApp) => app.window.locator('[data-slot="plan-tab"]')
const lastReply = (app: LaunchedApp) => app.window.locator('[data-slot="assistant-message-body"]').last().textContent()
/** 协议读回：计划阶段与活动 Plan 的状态。 */
const readPlan = (app: LaunchedApp, sessionId: string) =>
  app.window.evaluate(async (id) => {
    const plan = (await (await fetch(`/api/sessions/${id}/plan`)).json()) as { phase: string; plan: { status: string } | null }
    return { phase: plan.phase, plan: plan.plan?.status ?? null }
  }, sessionId)
/** 进入规划、发出任务、等到审阅卡后批准并执行，等批准所在的 Run 结束（最后一条回复为 reply）。 */
async function planAndApprove(app: LaunchedApp, reply: string) {
  await choosePlan(app)
  await composer(app).click()
  await composer(app).fill('plan the work')
  await composer(app).press('Enter')
  await review(app).waitFor({ timeout: 30_000 })
  await review(app)
    .getByRole('button', { name: /(Approve and run|批准并执行)/ })
    .click()
  await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe(reply)
  await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
}
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
  it('规划 → chip × 退出 → 提交计划、右栏自动打开 → 继续规划 → 右栏编辑后批准并执行：模式不变、计划卡', { timeout: 120_000 }, async () => {
    const { app, workspace } = await setup({
      responses: [exit('e1', '# Plan A\n\n- read the code'), exit('e2', '# Plan B\n\n- add tests\n- fix it'), { content: 'Implementing the plan.' }],
    })
    await expect.poll(() => modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    await choosePlan(app)
    // ADR 0028 起进入规划不改变模式（原先断言为 plan）。
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('default')
    await composer(app).fill('keep this draft ')
    await stubDirectoryPicker(app.app, [await realpath(join(workspace, 'notes.txt'))])
    await app.window.locator('[data-action="attach"]').click()
    await composer(app).locator('[data-file-reference="notes.txt"]').waitFor()
    const selectedModel = await app.window.locator('[data-model-picker]').textContent()
    // chip 的 × 退出规划，模式不变。
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
    // ADR 0028 起审阅卡不再标出将恢复的模式（原先断言 data-restores 为 default）。
    expect(
      await review(app)
        .getByRole('button', { name: /(Approve and run|批准并执行)/ })
        .getAttribute('data-restores'),
    ).toBeNull()

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
    // 批准后计划为执行中：chip 显示执行中，计划卡与 Plan tab 同为执行中。
    expect(await chip(app).textContent()).toMatch(/Executing|执行中/)
    const approved = app.window.locator('[data-slot="plan-card"][data-status="executing"]')
    await approved.waitFor()
    expect(await approved.getAttribute('data-revision')).toBe('3')
    expect(await approved.textContent()).toContain('Plan B (edited)')
    expect(await app.window.locator('[data-slot="plan-card"][data-status="rejected"]').textContent()).toContain('add tests first')
    await expect.poll(() => planTab(app).getAttribute('data-status')).toBe('executing')
  })
  it(
    '完全访问权限下规划：模式菜单仍勾选该模式；chip × 退出后读回不在规划中、模式不变；审阅卡上改为 accept-edits 后批准：读回执行中与改后的模式，chip 与计划卡为执行中',
    { timeout: 120_000 },
    async () => {
      const { app, sessionId } = await setup({ responses: [exit('e1', '# Plan C\n\n- inspect the code'), { content: 'Running with accept-edits.' }] })
      const read = () =>
        app.window.evaluate(async (id) => {
          const plan = (await (await fetch(`/api/sessions/${id}/plan`)).json()) as { phase: string; plan: { status: string } | null }
          const { mode } = (await (await fetch(`/api/sessions/${id}/permission-rules`)).json()) as { mode: string }
          return { phase: plan.phase, plan: plan.plan?.status ?? null, mode }
        }, sessionId)
      await modeButton(app).click()
      await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
      await app.window.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
      await expect.poll(() => modeButton(app).getAttribute('data-permission-mode')).toBe('full-access')

      await choosePlan(app)
      expect(await read()).toEqual({ phase: 'planning', plan: null, mode: 'full-access' })
      // 规划中模式菜单照常显示并勾选当前模式。
      expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('full-access')
      await modeButton(app).click()
      expect(await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').getAttribute('aria-checked')).toBe('true')
      await app.window.keyboard.press('Escape')

      // chip 的 × 退出规划：协议读回不在规划中，模式不变。
      await app.window.locator('[role="menu"]').waitFor({ state: 'detached' })
      await chip(app).click()
      await expect.poll(() => chip(app).count()).toBe(0)
      expect(await read()).toEqual({ phase: 'none', plan: null, mode: 'full-access' })

      await choosePlan(app)
      await composer(app).click()
      await composer(app).fill('plan the change')
      await composer(app).press('Enter')
      await review(app).waitFor({ timeout: 30_000 })
      await planTab(app).waitFor({ timeout: 10_000 })
      expect(await app.window.getByRole('tab', { name: /^(Plan|计划)$/ }).getAttribute('aria-selected')).toBe('true')
      expect(await read()).toEqual({ phase: 'planning', plan: 'proposed', mode: 'full-access' })

      // 审阅卡上标出执行权限，并用同一个模式菜单改为 accept-edits。
      const cardMode = review(app).locator('[data-slot="plan-review-permission"] [data-permission-mode]')
      expect(await cardMode.getAttribute('data-permission-mode')).toBe('full-access')
      await cardMode.click()
      await app.window.locator('[role="menuitemradio"][data-mode="accept-edits"]').click()
      await expect.poll(() => cardMode.getAttribute('data-permission-mode')).toBe('accept-edits')
      await app.window.locator('[role="menu"]').waitFor({ state: 'detached' })
      await expect.poll(async () => (await read()).mode).toBe('accept-edits')
      expect(await review(app).isVisible()).toBe(true)

      await review(app)
        .getByRole('button', { name: /(Approve and run|批准并执行)/ })
        .click()
      await expect
        .poll(() => app.window.locator('[data-slot="assistant-message-body"]').last().textContent(), { timeout: 30_000 })
        .toBe('Running with accept-edits.')
      await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
      expect(await read()).toEqual({ phase: 'executing', plan: 'approved', mode: 'accept-edits' })
      expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('accept-edits')
      expect(await chip(app).textContent()).toMatch(/Executing|执行中/)
      await app.window.locator('[data-slot="plan-card"][data-status="executing"]').waitFor()
      await expect.poll(() => planTab(app).getAttribute('data-status')).toBe('executing')
    },
  )

  it('批准后执行中 → 下一个 Run 拆待办并提交完成报告：chip 消失，计划卡与 Plan tab 为已完成且显示报告，读回没有活动的 Plan', { timeout: 120_000 }, async () => {
    const report = '## 1. Read the code\nDone.\n\n## 2. Run the checks\nNot done: no checks are configured.'
    const { app, sessionId } = await setup({
      responses: [
        exit('e1', '# Plan D\n\n- read the code\n- run the checks'),
        { content: 'Starting on the plan.' },
        call('todo_write', 't1', {
          items: [
            { content: 'Read the code', status: 'completed', result: 'read' },
            { content: 'Run the checks', status: 'pending' },
          ],
        }),
        call('complete_plan', 'c1', { report }),
        { content: 'Plan complete.' },
      ],
    })
    await planAndApprove(app, 'Starting on the plan.')
    expect(await readPlan(app, sessionId)).toEqual({ phase: 'executing', plan: 'approved' })
    expect(await chip(app).textContent()).toMatch(/Executing|执行中/)
    await app.window.locator('[data-slot="plan-card"][data-status="executing"]').waitFor()

    await composer(app).click()
    await composer(app).fill('go on')
    await composer(app).press('Enter')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Plan complete.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    // 模型写入的 Todo List 显示在待办卡上（一项完成、一项未做）。
    await expect.poll(() => app.window.locator('[data-slot="todo-card"] [data-todo-count]').textContent()).toMatch(/1\/2/)
    expect(await readPlan(app, sessionId)).toEqual({ phase: 'none', plan: null })
    await expect.poll(() => chip(app).count()).toBe(0)
    await app.window.locator('[data-slot="plan-card"][data-status="completed"]').waitFor()
    await expect.poll(() => planTab(app).getAttribute('data-status')).toBe('completed')
    expect(await planTab(app).locator('[data-slot="plan-report"]').textContent()).toContain('Not done: no checks are configured.')
  })

  it('执行中点 Plan chip 的 × 放弃：计划卡与 Plan tab 为已放弃，读回没有活动的 Plan，已写入的文件仍在', { timeout: 120_000 }, async () => {
    const { app, workspace, sessionId } = await setup({
      responses: [
        exit('e1', '# Plan E\n\n- write the draft\n- polish it'),
        call('write', 'w1', { path: 'draft.md', content: 'first draft' }),
        { content: 'Draft written.' },
      ],
    })
    // 自动接受编辑：执行中的写入不询问。
    await modeButton(app).click()
    await app.window.locator('[role="menuitemradio"][data-mode="accept-edits"]').click()
    await expect.poll(() => modeButton(app).getAttribute('data-permission-mode')).toBe('accept-edits')
    await planAndApprove(app, 'Draft written.')
    expect(await readFile(join(workspace, 'draft.md'), 'utf8')).toBe('first draft')
    expect(await readPlan(app, sessionId)).toEqual({ phase: 'executing', plan: 'approved' })

    // chip 的 × 在执行中的可访问名称为“放弃计划”，点击即放弃、不弹确认。
    expect(await chip(app).getAttribute('aria-label')).toMatch(/^(Abandon plan|放弃计划)$/)
    await chip(app).click()
    await expect.poll(() => chip(app).count()).toBe(0)
    expect(await readPlan(app, sessionId)).toEqual({ phase: 'none', plan: null })
    await app.window.locator('[data-slot="plan-card"][data-status="abandoned"]').waitFor()
    await expect.poll(() => planTab(app).getAttribute('data-status')).toBe('abandoned')
    expect(await readFile(join(workspace, 'draft.md'), 'utf8')).toBe('first draft')
    expect(await modeButton(app).getAttribute('data-permission-mode')).toBe('accept-edits')
  })
})

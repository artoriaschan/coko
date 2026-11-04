// Goal 卡、Run 用量与 Session 费用：真实 Electron + 真实 Sidecar（faux 多轮脚本，每次回复给出 usage，faux 模型有价格）。
// 建立 Goal → Goal 卡出现在 Todo 与 Queue 之间 → 轮次随 Goal Round 增长 → 暂停后不再推进、恢复后继续 → 工具调用上限耗尽为 budget-exhausted、
// 恢复不可用 → 编辑预算后恢复 → 完成后显示证据。Run 用量行与标题栏累计费用与 GET …/goal 及条目中的 usage 一致；明暗主题、390 px 窗口与
// 键盘操作下 Goal 卡可用。设 COKO_E2E_SCREENSHOT_DIR 时保存截图（人工检查用，缺省不保存）。
// bash 在 full-access 下运行（不经审批）；命令先写标记文件，标记出现即表示命令正在执行。
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const usage = { usage: { input: 1000, output: 200 } }
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const bash = (id: string, command: string) => call('bash', id, { command })
const evidence = [
  { criterion_id: 'c1', text: 'echo printed one', tool_call_ids: ['b1'] },
  { criterion_id: 'c2', text: 'summary given' },
]
const script = {
  // 每百万 token：输入 1、输出 2 → 每次回复 0.001 + 0.0004。
  price: { input: 1, output: 2 },
  responses: [
    { match: 'COKO_SESSION_TITLE', content: 'Fix the tests', usage: { input: 10, output: 5 } },
    // 用户提交的 Run：待办与 Goal（工具调用上限 3）。
    {
      content: [
        call('todo_write', 'td1', {
          items: [
            { content: 'fix the tests', status: 'in_progress' },
            { content: 'write the summary', status: 'pending' },
          ],
        }),
        call('create_goal', 'cg', {
          objective: 'make the tests pass',
          criteria: ['tests pass', 'summary given'],
          budget: { max_rounds: 10, max_tool_calls: 3 },
        }),
      ],
      ...usage,
    },
    { content: 'goal set', ...usage },
    // Goal Round 1：命令运行中发出追加指令（Queue 卡）。
    { content: [bash('b1', 'touch r1-started && sleep 5 && echo one')], ...usage },
    { content: 'round 1 done, noted the README', ...usage },
    // Goal Round 2：命令运行中暂停；本批完成后停下，不再请求模型。
    { content: [bash('b2', 'touch r2-started && sleep 6 && echo two')], ...usage },
    // Goal Round 3（恢复后）：第 3 次工具调用；之后轮次开始前的检查发现调用数用尽 → budget-exhausted，不开始第 4 轮。
    { content: [bash('b3', 'echo three')], ...usage },
    { content: 'round 3 done', ...usage },
    // Goal Round 4（编辑预算并恢复后）：完整证据。
    { content: [call('update_goal', 'u1', { goal_id: 'goal-1', revision: 6, action: 'complete', evidence })], ...usage },
    { content: 'all done', ...usage },
  ],
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'coko-goal-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await app.window
    .getByRole('button', { name: /^(Add project|创建项目)$/ })
    .first()
    .waitFor()
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await app.window.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  return { app, workspace }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

type Entry = { kind: string; runId: string | null; payload: Record<string, unknown> }
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } }

describe('Goal 卡与用量', { timeout: 240_000 }, () => {
  it('建立 → 轮次增长 → 暂停 / 恢复 → 预算耗尽 → 编辑预算后恢复 → 完成显示证据；用量与接口一致；主题、窄窗口与键盘', async () => {
    const { app, workspace } = await setup()
    const win = app.window
    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    const type = async (text: string) => {
      await composer.click()
      await composer.fill(text)
      await composer.press('Enter')
    }
    const card = win.locator('[data-slot="goal-card"]')
    const phase = () => card.getAttribute('data-phase')
    const rounds = () => card.locator('[data-goal-rounds]').getAttribute('data-goal-rounds')
    const toggle = card.locator('[data-action="toggle-goal"]')
    const expand = async () => {
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
      await card.locator('[data-slot="goal-details"]').waitFor()
    }
    const shots = process.env.COKO_E2E_SCREENSHOT_DIR
    const shot = async (name: string) => {
      if (shots) await card.screenshot({ path: join(shots, `goal-${name}.png`) })
    }

    await type('make the tests pass')
    await card.waitFor({ timeout: 30_000 })

    // Goal Round 1：命令运行中发出追加指令，dock 顺序 Todo → Goal → Queue。
    await expect.poll(() => exists(join(workspace, 'r1-started')), { timeout: 30_000 }).toBe(true)
    await type('also check the README')
    await win.locator('[data-slot="queue-card"]').waitFor({ timeout: 10_000 })
    expect(await win.locator('[data-slot="dock"] > section').evaluateAll((s) => s.map((e) => e.getAttribute('data-slot')))).toEqual([
      'todo-card',
      'goal-card',
      'queue-card',
    ])
    expect(await rounds()).toBe('1')

    // Goal Round 2 开始：轮次增长；命令运行中暂停，本批完成后停下。
    await expect.poll(() => exists(join(workspace, 'r2-started')), { timeout: 30_000 }).toBe(true)
    await expect.poll(rounds).toBe('2')
    await expand()
    await card.locator('[data-action="pause-goal"]').click()
    await expect.poll(phase, { timeout: 30_000 }).toBe('paused')
    await win.locator('[data-run-status="paused"]').last().waitFor({ timeout: 30_000 })
    // 暂停期间不推进：Session 空闲（没有进行中的 Run），轮次仍为 2。
    const sessionId = await win.evaluate(async () => ((await fetch('/api/sessions').then((r) => r.json())) as { sessions: { id: string }[] }).sessions[0]!.id)
    const detail = () =>
      win.evaluate(async (id) => (await fetch(`/api/sessions/${id}`).then((r) => r.json())) as { session: { running: boolean }; entries: Entry[] }, sessionId)
    await expect.poll(async () => (await detail()).session.running, { timeout: 10_000 }).toBe(false)
    const startsWhilePaused = (await detail()).entries.filter((e) => e.kind === 'run_start').length
    expect(await rounds()).toBe('2')
    expect((await detail()).entries.filter((e) => e.kind === 'run_start').length).toBe(startsWhilePaused)

    // 恢复：Goal Round 3 开始并完成；工具调用达到上限 3 → budget-exhausted，恢复不可用。
    await card.locator('[data-action="resume-goal"]').click()
    await expect.poll(phase, { timeout: 30_000 }).toBe('budget-exhausted')
    expect(await rounds()).toBe('3')
    expect(await card.locator('[data-slot="goal-reason"]').textContent()).toMatch(/No tool calls left|工具调用次数已用尽/)
    // 预算条与恢复按钮取自 GET …/goal 的已用量：goal 条目到达后下一帧才重新读取，阶段先于用量更新，所以轮询到用量读回。
    await expect.poll(() => card.locator('[data-budget="tool-calls"]').getAttribute('data-level'), { timeout: 10_000 }).toBe('exhausted')
    await expect.poll(() => card.locator('[data-action="resume-goal"]').isDisabled(), { timeout: 10_000 }).toBe(true)
    await shot('exhausted-light-1280')

    // 明暗主题与 390 px 窗口：卡片在视口内、操作可达、没有整页横向滚动。
    await win.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await win.locator('[data-settings-page] [data-theme-option="dark"]').click()
    await expect.poll(() => win.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await win.keyboard.press('Escape')
    await win.locator('[data-settings-page]').waitFor({ state: 'detached' })
    await shot('exhausted-dark-1280')
    await app.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setMinimumSize(390, 400)
      w.setContentSize(390, 820)
    })
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(390)
    // 缩窄后布局重排是异步的：轮询几何直到稳定，不只读一次。
    const inViewport = async (locator: ReturnType<typeof card.locator> | typeof card) => {
      const box = await locator.boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390
    }
    for (const action of ['edit-goal', 'complete-goal', 'cancel-goal'])
      await expect.poll(() => inViewport(card.locator(`[data-action="${action}"]`)), { timeout: 10_000 }).toBe(true)
    await expect.poll(() => inViewport(card), { timeout: 10_000 }).toBe(true)
    await expect.poll(() => win.evaluate(() => document.documentElement.scrollWidth), { timeout: 10_000 }).toBeLessThanOrEqual(390)
    await shot('exhausted-dark-390')
    // 390 px 时侧栏收起，设置入口不可见：回到宽窗口切换主题，再检查亮色的 390 px。
    const resize = async (width: number) => {
      await app.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 820), width)
      await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(width)
    }
    await resize(1280)
    await win.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await win.locator('[data-settings-page] [data-theme-option="light"]').click()
    await expect.poll(() => win.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
    await win.keyboard.press('Escape')
    await win.locator('[data-settings-page]').waitFor({ state: 'detached' })
    await resize(390)
    await expect.poll(() => win.evaluate(() => document.documentElement.scrollWidth), { timeout: 10_000 }).toBeLessThanOrEqual(390)
    await expect.poll(() => inViewport(card.locator('[data-action="cancel-goal"]')), { timeout: 10_000 }).toBe(true)
    await shot('exhausted-light-390')
    await resize(1280)

    // 键盘：Enter 收起与展开；Tab 到"编辑"，在对话框中改工具调用上限并以 Enter 保存。
    await toggle.focus()
    await win.keyboard.press('Enter')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false')
    await win.keyboard.press('Enter')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
    const edit = card.locator('[data-action="edit-goal"]')
    for (let i = 0; i < 20 && !(await edit.evaluate((el) => el === document.activeElement)); i++) await win.keyboard.press('Tab')
    expect(await edit.evaluate((el) => el === document.activeElement)).toBe(true)
    await win.keyboard.press('Enter')
    const dialog = win.locator('[data-slot="goal-edit-dialog"]')
    await dialog.waitFor()
    const limit = dialog.locator('[data-field="maxToolCalls"]')
    for (let i = 0; i < 20 && !(await limit.evaluate((el) => el === document.activeElement)); i++) await win.keyboard.press('Tab')
    await win.keyboard.press('ControlOrMeta+A')
    await win.keyboard.type('6')
    await win.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached', timeout: 10_000 })
    await expect.poll(() => card.locator('[data-action="resume-goal"]').isDisabled()).toBe(false)

    // 恢复：Goal Round 4 给出完整证据 → complete，卡片显示证据。
    await card.locator('[data-action="resume-goal"]').click()
    await expect.poll(phase, { timeout: 30_000 }).toBe('complete')
    await expect
      .poll(() => card.locator('[data-slot="goal-evidence"]').allTextContents())
      .toEqual([expect.stringContaining('echo printed one'), expect.stringContaining('summary given')])
    expect(await card.locator('[data-criterion][data-done]').count()).toBe(2)
    await win.getByRole('article', { name: 'Coko' }).filter({ hasText: 'all done' }).waitFor({ timeout: 30_000 })
    await expect.poll(async () => (await detail()).session.running, { timeout: 10_000 }).toBe(false)
    await shot('complete-light-1280')

    // 用量：结束底栏与条目中的 usage 一致；底栏不显示费用，标题栏累计和 Goal 预算仍保留费用。
    const { entries } = await detail()
    const perRun = new Map<string, { tokens: number; cost: number }>()
    for (const e of entries) {
      const u = (e.kind === 'message' && e.payload.role === 'assistant' ? e.payload.usage : undefined) as Usage | undefined
      if (!u || !e.runId) continue
      const sum = perRun.get(e.runId) ?? { tokens: 0, cost: 0 }
      perRun.set(e.runId, { tokens: sum.tokens + u.input + u.output + u.cacheRead + u.cacheWrite, cost: sum.cost + u.cost.total })
    }
    const rows = await win.locator('[data-slot="assistant-footer"], [data-slot="run-usage"]').evaluateAll((els) =>
      els.map((el) => ({
        runId: el.getAttribute('data-run-id')!,
        tokens: Number(el.getAttribute('data-tokens')),
        slot: el.getAttribute('data-slot'),
        text: el.textContent,
      })),
    )
    expect(rows.map((r) => r.runId)).toEqual([...perRun.keys()])
    for (const row of rows.filter((row) => row.slot === 'run-usage')) expect(row.tokens).toBe(perRun.get(row.runId)!.tokens)
    for (const row of rows.filter((row) => row.slot === 'assistant-footer')) {
      // Faux numeric fallback has no provider-report evidence; retain fees/budgets below without claiming reported tokens.
      expect(row.tokens).toBe(0)
      expect(row.text).toMatch(/Usage unavailable|未取得用量/)
      expect(row.text).not.toMatch(/0 tok/)
    }
    for (const footer of await win.locator('[data-slot="assistant-footer"]').all()) {
      expect(await footer.textContent()).not.toMatch(/\$|Unpriced/)
      expect(await footer.locator('[data-run-cost]').count()).toBe(0)
    }
    const header = win.locator('[data-slot="session-cost"]')
    const titles = entries.filter((entry) => entry.kind === 'model_request' && entry.payload.purpose === 'title')
    expect(titles).toHaveLength(1)
    expect(titles[0]!.runId).toBeNull()
    expect(titles[0]!.payload.usage).toMatchObject({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 })
    expect(titles[0]!.payload.cost).toBeCloseTo(0.00002, 9)
    const total = [...perRun.values()].reduce((a, b) => ({ tokens: a.tokens + b.tokens, cost: a.cost + b.cost }), { tokens: 15, cost: 0.00002 })
    expect(Number(await header.getAttribute('data-tokens'))).toBe(total.tokens)
    expect(Number(await header.getAttribute('data-cost'))).toBeCloseTo(total.cost, 9)
    const goal = (await win.evaluate(async (id) => fetch(`/api/sessions/${id}/goal`).then((r) => r.json()), sessionId)) as {
      usage: { rounds: number; tokens: number; cost: number; costUnpriced: boolean }
    }
    const firstRun = entries.find((e) => e.kind === 'run_start')!.runId!
    const afterCreate = [...perRun.entries()].filter(([runId]) => runId !== firstRun).map(([, v]) => v)
    expect(goal.usage).toMatchObject({ rounds: 4, costUnpriced: false, tokens: afterCreate.reduce((a, b) => a + b.tokens, 0) })
    expect(goal.usage.cost).toBeCloseTo(
      afterCreate.reduce((a, b) => a + b.cost, 0),
      9,
    )
    await expect
      .poll(async () => Number(await card.locator('[data-goal-cost]').getAttribute('data-goal-cost')), { timeout: 10_000 })
      .toBeCloseTo(goal.usage.cost, 9)
    // HoverCard 分项：键盘聚焦打开。
    await header.focus()
    await win.locator('[data-slot="session-cost-detail"]').waitFor()
    expect(await win.locator('[data-slot="session-cost-detail"] [data-usage-part="total"]').textContent()).toContain(
      String(total.tokens.toLocaleString('en-US')),
    )

    // /goal 无参数：重新展开卡片，不发送消息。
    const users = await win.locator('article[data-seq]').count()
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false')
    await composer.click()
    await composer.fill('/goal')
    // 命令菜单打开后再按 Esc，关闭后再按 Enter：高负载下菜单晚于 Esc 出现时，Enter 会选中菜单项而不是提交 /goal。
    const commandMenu = win.locator('[role="listbox"]:not([aria-hidden="true"]) [role="option"]').first()
    await commandMenu.waitFor()
    await win.keyboard.press('Escape')
    await commandMenu.waitFor({ state: 'detached' })
    await composer.press('Enter')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
    expect(await win.locator('article[data-seq]').count()).toBe(users)
  })
})

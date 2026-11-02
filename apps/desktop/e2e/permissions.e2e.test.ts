// 权限模式与规则：真实 Electron + 真实 Sidecar（faux）。Shift+Tab 循环三档、full-access 警示、Permissions 分区增删规则、
// 审批卡的"总是允许"下拉（越界写入不显示）。
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-permissions-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function send(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const idle = (app: LaunchedApp) => app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
const card = (app: LaunchedApp) => app.window.locator('[data-slot="approval-card"]')
const modePicker = (app: LaunchedApp) => app.window.locator('[data-permission-mode]')
const dialog = (app: LaunchedApp) => app.window.locator('[data-settings-page]')
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const bash = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })

async function openPermissions(app: LaunchedApp) {
  await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  await dialog(app).locator('[data-section="permissions"]').click()
  await dialog(app).locator('[data-rule-list="global"]').waitFor()
}

describe('权限模式选择', () => {
  it('Shift+Tab 在只读、默认、自动接受编辑之间循环且不进入 full-access；菜单选 full-access 后有警示样式并免审批', async () => {
    const { app, workspace } = await setup({ responses: [{ content: 'hello' }, { content: [bash('b1', 'printf hi > full.txt')] }, { content: 'done' }] })
    await send(app, 'start')
    // 首次发送接受并渲染真实 Session 后再测试会话模式，发送按钮在新对话中也已存在。
    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).textContent()).toBe('hello')
    await idle(app)
    expect(await modePicker(app).getAttribute('data-permission-mode')).toBe('default')

    await composer(app).click()
    const seen: (string | null)[] = []
    for (const mode of ['accept-edits', 'read-only', 'default', 'accept-edits']) {
      await composer(app).press('Shift+Tab')
      await expect.poll(() => modePicker(app).getAttribute('data-permission-mode')).toBe(mode)
      seen.push(await modePicker(app).getAttribute('data-permission-mode'))
    }
    expect(seen).toEqual(['accept-edits', 'read-only', 'default', 'accept-edits'])
    // 焦点留在编辑区。
    expect(await composer(app).evaluate((el) => el === document.activeElement)).toBe(true)
    await app.window.mouse.move(0, 0)
    const normalColor = await modePicker(app).evaluate((el) => getComputedStyle(el).color)
    expect(await modePicker(app).getAttribute('data-warning')).toBeNull()

    await modePicker(app).click()
    await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
    await expect.poll(() => modePicker(app).getAttribute('data-permission-mode')).toBe('full-access')
    // 按真实协议读回，不以乐观按钮状态替代服务端保存的事实。
    await expect
      .poll(() =>
        app.window.evaluate(async () => {
          const { sessions } = (await (await fetch('/api/sessions')).json()) as { sessions: { id: string }[] }
          return ((await (await fetch(`/api/sessions/${sessions[0]!.id}/permission-rules`)).json()) as { mode: string }).mode
        }),
      )
      .toBe('full-access')
    expect(await modePicker(app).getAttribute('data-warning')).toBe('true')
    // 按钮有颜色过渡：等过渡结束后的计算值。
    await expect.poll(() => modePicker(app).evaluate((el) => getComputedStyle(el).color)).not.toBe(normalColor)

    // full-access：bash 不经审批。
    await send(app, 'write it')
    await expect.poll(() => exists(join(workspace, 'full.txt')), { timeout: 30_000 }).toBe(true)
    await idle(app)
    expect(await card(app).count()).toBe(0)

    // 从 full-access 按 Shift+Tab 回到第一档，不停留在 full-access。
    await composer(app).click()
    await composer(app).press('Shift+Tab')
    expect(await modePicker(app).getAttribute('data-permission-mode')).toBe('read-only')
  })
})

describe('Permissions 设置与总是允许', () => {
  it('Permissions 分区增删全局规则，下一次调用即按新规则判定', async () => {
    const { app, workspace } = await setup({
      responses: [{ content: [bash('b1', 'printf hi > out.txt')] }, { content: 'done' }, { content: [bash('b2', 'printf hi > out.txt')] }],
    })
    await openPermissions(app)
    const global = dialog(app).locator('[data-rule-list="global"]')
    await global.getByRole('textbox', { name: /^(Rule|规则)$/ }).fill('Bash(printf hi')
    await global.getByRole('button', { name: /^(Add|添加)$/ }).click()
    await global.getByRole('alert').waitFor()
    // 未知工具名：行内提示，不保存。
    await global.getByRole('textbox', { name: /^(Rule|规则)$/ }).fill('deploy')
    await global.getByRole('button', { name: /^(Add|添加)$/ }).click()
    await expect.poll(() => global.getByRole('alert').textContent()).toMatch(/deploy/)
    expect(await global.locator('[data-rule]').count()).toBe(0)
    // 小写的内置工具名保存后显示为规范名。
    await global.getByRole('textbox', { name: /^(Rule|规则)$/ }).fill('bash(printf hi > out.txt)')
    await global.getByRole('button', { name: /^(Add|添加)$/ }).click()
    await global.locator('[data-rule="Bash(printf hi > out.txt)"][data-behavior="allow"]').waitFor()
    await app.window.keyboard.press('Escape')
    await dialog(app).waitFor({ state: 'detached' })

    await send(app, 'write it')
    await expect.poll(() => exists(join(workspace, 'out.txt')), { timeout: 30_000 }).toBe(true)
    await idle(app)
    expect(await card(app).count()).toBe(0)

    await openPermissions(app)
    await dialog(app)
      .locator('[data-rule="Bash(printf hi > out.txt)"]')
      .getByRole('button', { name: /^(Remove rule|删除规则)/ })
      .click()
    await expect.poll(() => dialog(app).locator('[data-rule-list="global"] [data-rule]').count()).toBe(0)
    await app.window.keyboard.press('Escape')
    await dialog(app).waitFor({ state: 'detached' })

    await send(app, 'again')
    await card(app).waitFor({ timeout: 30_000 })
    await card(app)
      .getByRole('button', { name: /^(Reject|拒绝)$/ })
      .click()
    await idle(app)
  })

  it('"总是允许"下拉：越界写入不显示；选"本工作区"后工具卡显示决定，同类调用不再询问', async () => {
    const outside = join(homedir(), `.coko-e2e-outside-${randomBytes(6).toString('hex')}`, 'x.txt')
    onTestFinished(() => rm(join(outside, '..'), { recursive: true, force: true }))
    const { app, workspace } = await setup({
      responses: [
        { content: [{ type: 'toolCall', name: 'write', id: 'w1', arguments: { path: outside, content: 'x' } }] },
        { content: [bash('b1', 'printf hi > a.txt')] },
        { content: 'ok' },
        { content: [bash('b2', 'printf hi > a.txt')] },
        { content: 'ok again' },
      ],
    })
    await send(app, 'write outside')
    await card(app).waitFor({ timeout: 30_000 })
    expect(await card(app).locator('[data-action="allow-once"]').count()).toBe(1)
    expect(await card(app).locator('[data-action="allow-always"]').count()).toBe(0)
    await card(app)
      .getByRole('button', { name: /^(Reject|拒绝)$/ })
      .click()
    await idle(app)
    expect(await exists(outside)).toBe(false)

    await send(app, 'write inside')
    await card(app).locator('[data-action="allow-always"]').waitFor({ timeout: 30_000 })
    await card(app).locator('[data-action="allow-always"]').click()
    expect(await app.window.getByRole('menu').textContent()).toContain('Bash(printf hi > a.txt)')
    await app.window.locator('[role="menuitem"][data-scope="workspace"]').click()
    await idle(app)
    expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('hi')
    const decided = app.window.locator('[data-slot="tool-card"][data-tool="bash"] [data-approval-outcome="allowed"]').last()
    expect(await decided.textContent()).toMatch(/^(Always allowed in this workspace|本工作区总是允许)$/)

    await send(app, 'again')
    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('ok again')
    expect(await card(app).count()).toBe(0)
  })
})

// 审批闭环：真实 Electron + 真实 Sidecar（faux），审批卡接管输入区、允许一次、带反馈拒绝、侧栏徽标与上浮。
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-approval-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  // The initial empty workbench has no ConnectionStatus; assert actual connection after sending.
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function send(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
  await waitConnected(app.window)
}
const card = (app: LaunchedApp) => app.window.locator('[data-slot="approval-card"]')
const toolCard = (app: LaunchedApp, tool: string) => app.window.locator(`[data-slot="tool-card"][data-tool="${tool}"]`)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const bashWrite = (id: string, file: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command: `printf hi > ${file}` } })

describe('审批卡', () => {
  it('出现在输入区位置并接管它；允许一次后工具卡完成并显示决定，输入区恢复', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [bashWrite('b1', 'out.txt')] }, { content: 'Wrote the file.' }] })
    await send(app, 'write a file')

    await card(app).waitFor({ timeout: 30_000 })
    expect(await card(app).textContent()).toContain('printf hi > out.txt')
    expect(await composer(app).isVisible()).toBe(false)
    expect(await toolCard(app, 'bash').getAttribute('data-status')).toBe('awaiting')
    expect(await exists(join(workspace, 'out.txt'))).toBe(false)
    // 位置：卡片在聊天区之下、窗口底部（与输入区同一位置）。
    const box = (await card(app).boundingBox())!
    const viewport = app.window.viewportSize() ?? (await app.window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(24)

    await card(app)
      .getByRole('button', { name: /^(Allow once|允许一次)$/ })
      .click()
    await expect.poll(() => toolCard(app, 'bash').getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    expect(await toolCard(app, 'bash').locator('[data-approval-outcome]').textContent()).toMatch(/^(Allowed once|已允许一次)$/)
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await card(app).count()).toBe(0)
    expect(await composer(app).isVisible()).toBe(true)
    expect(await readFile(join(workspace, 'out.txt'), 'utf8')).toBe('hi')
  })

  it('拒绝并说明原因后 Agent 继续；工具卡显示拒绝与原因，文件不存在', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [bashWrite('b1', 'out.txt')] }, { content: 'Understood, I will use notes/ instead.' }] })
    await send(app, 'write a file')
    await card(app).waitFor({ timeout: 30_000 })
    await card(app)
      .getByRole('button', { name: /^(Reject with a reason|拒绝并说明原因)$/ })
      .click()
    const reason = card(app).getByRole('textbox', { name: /^(Reason for rejecting|拒绝原因)$/ })
    await reason.fill('put it under notes/')
    await reason.press('Enter')

    await expect
      .poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 })
      .toBe('Understood, I will use notes/ instead.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await toolCard(app, 'bash').getAttribute('data-status')).toBe('error')
    expect(await toolCard(app, 'bash').locator('[data-approval-outcome="denied"]').textContent()).toContain('put it under notes/')
    expect(await exists(join(workspace, 'out.txt'))).toBe(false)
  })

  it('等待审批的会话不改变最后记录排序，侧栏不显示状态徽标', async () => {
    const { app } = await setup({ responses: [{ content: [bashWrite('b1', 'a.txt')] }, { content: 'Second session reply.' }, { content: 'done' }] })
    await send(app, 'first session')
    await card(app).waitFor({ timeout: 30_000 })
    const first = await app.window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')

    // 第二个会话更新更晚，按更新时间本应排在前面。
    await app.window
      .getByRole('button', { name: /^(New chat|新对话)$/ })
      .first()
      .click()
    await send(app, 'second session')
    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Second session reply.')
    await expect.poll(() => app.window.locator('[data-session-id]').count()).toBe(2)

    const rows = app.window.locator('[data-session-id]')
    expect(await rows.last().getAttribute('data-session-id')).toBe(first)
    expect(await rows.locator('[data-activity="awaiting-approval"]').count()).toBe(0)

    await rows.last().click()
    await card(app)
      .getByRole('button', { name: /^(Allow once|允许一次)$/ })
      .click()
    await expect.poll(() => app.window.locator('[data-activity="awaiting-approval"]').count(), { timeout: 30_000 }).toBe(0)
  })
})

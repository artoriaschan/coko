// 运行控制：真实 Electron + 真实 Sidecar（faux）。Run 中追加指令、暂停与继续、停止后未送达文本回到输入区。
// bash 在 full-access 下运行（不经审批）；命令先写标记文件，标记出现即表示命令正在执行。
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-run-control-'))
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
  // 草稿中选 full-access：命令不经审批。
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function type(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const sleepCall = (id: string, seconds: number) => ({
  type: 'toolCall',
  name: 'bash',
  id,
  arguments: { command: 'touch started && sleep ' + seconds + ' && echo slept' },
})
const lastReply = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' }).last().textContent()
const pendingSteering = (app: LaunchedApp) => app.window.locator('[data-steering="pending"]')
const userBubbles = (app: LaunchedApp) => app.window.locator('article[aria-label="You"]:not([data-steering]), article[aria-label="你"]:not([data-steering])')

describe('运行控制', () => {
  it('Run 中输入并回车 → 待送达气泡，送达后变为普通消息，Agent 据此继续', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [sleepCall('b1', 3)] }, { content: 'Noted the README request.' }] })
    await type(app, 'run the command')
    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)
    // Run 中输入区可用，暂停与停止并列。
    expect(await app.window.locator('[data-action="pause"]').isVisible()).toBe(true)
    expect(await app.window.locator('[data-action="stop"]').isVisible()).toBe(true)

    await type(app, 'also check the README')
    await pendingSteering(app).waitFor({ timeout: 10_000 })
    expect(await pendingSteering(app).textContent()).toContain('also check the README')
    // 待送达气泡先乐观显示；请求被接受后编辑区才清空。
    await expect.poll(() => composer(app).textContent(), { timeout: 10_000 }).toBe('')

    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Noted the README request.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await pendingSteering(app).count()).toBe(0)
    expect(await userBubbles(app).allTextContents()).toEqual(['run the command', 'also check the README'])
  })

  it('暂停 → 当前命令完成后停下，横幅出现；点继续 → Run 继续到完成', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [sleepCall('b1', 2)] }, { content: 'Finished after continue.' }] })
    await type(app, 'run the command')
    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)
    await app.window.locator('[data-action="pause"]').click()

    const banner = app.window.locator('[data-slot="run-banner"][data-activity="paused"]')
    await banner.waitFor({ timeout: 30_000 })
    expect(await app.window.locator('[data-slot="tool-card"][data-tool="bash"]').getAttribute('data-status')).toBe('done')
    expect(await app.window.locator('[data-run-status="paused"]').count()).toBe(1)
    expect(await app.window.getByRole('article', { name: 'Coko' }).count()).toBe(0)

    await banner.locator('[data-action="continue"]').click()
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Finished after continue.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await banner.count()).toBe(0)
  })

  it('停止后未送达的追加指令回到输入区', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [sleepCall('b1', 30)] }, { content: 'should not be used' }] })
    await type(app, 'run the command')
    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)
    await type(app, 'not delivered yet')
    await pendingSteering(app).waitFor({ timeout: 10_000 })

    await app.window.locator('[data-action="stop"]').click()
    await app.window.locator('[data-run-status="aborted"]').waitFor({ timeout: 30_000 })
    await expect.poll(() => composer(app).textContent(), { timeout: 10_000 }).toBe('not delivered yet')
    expect(await pendingSteering(app).count()).toBe(0)
    expect(await userBubbles(app).allTextContents()).toEqual(['run the command'])
  })
})
